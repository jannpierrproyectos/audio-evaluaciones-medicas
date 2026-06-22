function cleanText(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function cleanNumber(value) {
  if (value === null || value === undefined) return null;

  let text = String(value).trim();

  if (!text) return null;

  text = text.replace(/[^\d.,-]/g, "");

  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && !hasDot) {
    const commaGroups = text.split(",");

    const looksLikeThousands =
      commaGroups.length > 1 &&
      commaGroups.slice(1).every((group) => group.length === 3);

    if (looksLikeThousands) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  } else if (hasComma && hasDot) {
    text = text.replace(/,/g, "");
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

function cleanInteger(value) {
  const number = cleanNumber(value);
  return number === null ? null : Math.round(number);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLabelEndIndex(normalizedText, label) {
  const normalizedLabel = normalizeSearchText(label);
  const pattern = new RegExp(`${escapeRegExp(normalizedLabel)}\\s*:?\\s*`, "i");
  const match = normalizedText.match(pattern);

  if (!match) return -1;

  return match.index + match[0].length;
}

function findNextLabelIndex(normalizedText, labels, startIndex) {
  const indexes = labels
    .map((label) => {
      const normalizedLabel = normalizeSearchText(label);
      const pattern = new RegExp(`\\s${escapeRegExp(normalizedLabel)}\\s*:?`, "i");
      const segment = normalizedText.slice(startIndex);
      const match = segment.match(pattern);

      if (!match) return -1;

      return startIndex + match.index;
    })
    .filter((index) => index >= 0);

  if (indexes.length === 0) return -1;

  return Math.min(...indexes);
}

function extractBetweenLabels(text, startLabels, endLabels = []) {
  const original = cleanText(text);
  const normalized = normalizeSearchText(original);

  for (const startLabel of startLabels) {
    const valueStart = findLabelEndIndex(normalized, startLabel);

    if (valueStart < 0) continue;

    const valueEnd =
      endLabels.length > 0
        ? findNextLabelIndex(normalized, endLabels, valueStart)
        : -1;

    const rawValue =
      valueEnd >= 0
        ? original.slice(valueStart, valueEnd)
        : original.slice(valueStart);

    const cleaned = cleanText(rawValue);

    if (cleaned) return cleaned;
  }

  return "";
}

function matchFirst(text, regex) {
  const match = cleanText(text).match(regex);
  return cleanText(match?.[1] || "");
}

function matchNumber(text, regex) {
  return cleanNumber(matchFirst(text, regex));
}

function matchInteger(text, regex) {
  return cleanInteger(matchFirst(text, regex));
}

function matchIntegerFromNormalizedText(text, regex) {
  const normalized = normalizeSearchText(text);
  const match = normalized.match(regex);
  return cleanInteger(match?.[1] || "");
}

const DOCUMENT_LABELS = [
  "DNI",
  "Carnet de Extranjeria",
  "Carnet de Extranjería",
  "CE",
];

function extractDocument(text) {
  const cleaned = cleanText(text);
  const patterns = [
    { type: "DNI", regex: /\bDNI\s*:\s*([A-Z0-9-]+)/i },
    {
      type: "CARNET DE EXTRANJERIA",
      regex: /\bCarnet de Extranjer[ií]a\s*:\s*([A-Z0-9-]+)/i,
    },
    { type: "CE", regex: /\bCE\s*:\s*([A-Z0-9-]+)/i },
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern.regex);
    if (match?.[1]) {
      return {
        tipo_documento: pattern.type,
        numero_documento: cleanText(match[1]),
      };
    }
  }

  return {
    tipo_documento: "",
    numero_documento: "",
  };
}

const COMMON_GIVEN_NAMES = new Set([
  "ALCIBIADES",
  "ALCIDES",
  "ALEJANDRO",
  "CARLOS",
  "DANIEL",
  "DAVID",
  "EDGAR",
  "EDUARDO",
  "ENRIQUE",
  "FRANCISCO",
  "GUILLERMO",
  "JORGE",
  "JOSE",
  "JUAN",
  "LUIS",
  "MARIO",
  "MIGUEL",
  "NELSON",
  "OSCAR",
  "PEDRO",
  "RAUL",
  "ROBERTO",
  "VICTOR",
]);

function isLikelyGivenName(value) {
  return COMMON_GIVEN_NAMES.has(normalizeSearchText(value));
}

function splitApellidosNombres(fullName) {
  const cleaned = cleanText(fullName);

  if (!cleaned) {
    return {
      nombre_completo_original: "",
      nombres: "",
      apellidos: "",
      needs_name_review: true,
    };
  }

  const parts = cleaned.split(" ").filter(Boolean);

  if (parts.length <= 2) {
    return {
      nombre_completo_original: cleaned,
      nombres: cleaned,
      apellidos: "",
      needs_name_review: true,
    };
  }

  if (
    parts.length === 3 &&
    isLikelyGivenName(parts[1]) &&
    isLikelyGivenName(parts[2])
  ) {
    return {
      nombre_completo_original: cleaned,
      apellidos: parts[0],
      nombres: parts.slice(1).join(" "),
      needs_name_review: true,
    };
  }

  return {
    nombre_completo_original: cleaned,
    apellidos: parts.slice(0, 2).join(" "),
    nombres: parts.slice(2).join(" "),
    needs_name_review: true,
  };
}

function detectTipoExamen(text) {
  const normalized = normalizeSearchText(text);

  if (/PRE OCUPACIONAL\s*X/.test(normalized)) return "PRE OCUPACIONAL";
  if (/PERIODICO\s*X/.test(normalized)) return "PERI\u00d3DICO";
  if (/RETIRO\s*X/.test(normalized)) return "RETIRO";
  if (/OTROS\s*X/.test(normalized)) return "OTROS";

  return "";
}

function detectAptitud(text) {
  const normalized = normalizeSearchText(text);

  const aptitudSection = normalized.match(
    /APTITUD\s+(.+?)\s+RECOMENDACIONES/
  )?.[1] || "";

  if (!aptitudSection) return "";

  if (/X\s*PENDIENTE/.test(aptitudSection)) {
    return "PENDIENTE";
  }

  if (/X\s*APTO\s*-/.test(aptitudSection)) {
    return "APTO";
  }

  if (/X\s*APTO CON RESTRICCIONES/.test(aptitudSection)) {
    return "APTO CON RESTRICCIONES";
  }

  if (/X\s*NO APTO/.test(aptitudSection)) {
    return "NO APTO";
  }

  if (/APTO\s*-\s*X\s*APTO CON RESTRICCIONES/.test(aptitudSection)) {
    return "APTO CON RESTRICCIONES";
  }

  if (/APTO CON RESTRICCIONES\s*-\s*X\s*NO APTO/.test(aptitudSection)) {
    return "NO APTO";
  }

  return "";
}

function extractRecommendations(text) {
  return extractBetweenLabels(
    text,
    ["RECOMENDACIONES"],
    ["Fecha de Emision", "Firma y Sello del Medico"]
  );
}

function getMissingRequiredFields(record) {
  const missing = [];

  const required = [
    ["identificacion.nombres", record.identificacion.nombres],
    ["identificacion.apellidos", record.identificacion.apellidos],
    ["identificacion.dni", record.identificacion.dni],
    ["identificacion.empresa", record.identificacion.empresa],
    ["identificacion.fecha_evaluacion", record.identificacion.fecha_evaluacion],
    ["aptitud_y_recomendaciones.aptitud_final", record.aptitud_y_recomendaciones.aptitud_final],
  ];

  for (const [field, value] of required) {
    if (!value) missing.push(field);
  }

  return missing;
}

function getLowConfidenceFields(record) {
  const fields = [];

  fields.push("identificacion.nombres");
  fields.push("identificacion.apellidos");

  const aptitud = normalizeSearchText(
    record.aptitud_y_recomendaciones?.aptitud_final || ""
  );

  if (!aptitud || aptitud === "PENDIENTE") {
    fields.push("aptitud_y_recomendaciones.aptitud_final");
  }

  const dosajeCocaina = normalizeSearchText(
    record.evaluaciones_cualitativas?.dosaje_cocaina_resultado || ""
  );

  const dosajeMarihuana = normalizeSearchText(
    record.evaluaciones_cualitativas?.dosaje_marihuana_resultado || ""
  );

  if (shouldReviewDosaje(dosajeCocaina)) {
    fields.push("evaluaciones_cualitativas.dosaje_cocaina_resultado");
  }

  if (shouldReviewDosaje(dosajeMarihuana)) {
    fields.push("evaluaciones_cualitativas.dosaje_marihuana_resultado");
  }

  return fields;
}

function shouldReviewDosaje(value) {
  if (!value) return true;

  const safeValues = ["NO PROCEDE", "NEGATIVO"];

  if (safeValues.includes(value)) return false;

  return true;
}
export function parseInnomedicMedicalResult(group) {
  const text = cleanText(group.pages.map((page) => page.text).join(" "));

  const fullName = extractBetweenLabels(
    text,
    ["Apellidos y Nombres"],
    [...DOCUMENT_LABELS, "Edad", "Sexo", "Empresa"]
  );

  const nameParts = splitApellidosNombres(fullName);
  const document = extractDocument(text);

  const paRaw = matchFirst(text, /PA:\s*([\d.,]+\s*\/\s*[\d.,]+)\s*mmHg/i);
  const [paSistolica, paDiastolica] = paRaw
    .split("/")
    .map((value) => cleanInteger(value));

  const result = {
    source_type: "pdf_text",
    template_id: "innomedic_resultado_evaluacion_medica_v1",

    identificacion: {
      empresa: extractBetweenLabels(text, ["Empresa"], ["Area", "Área"]),
      sede_proyecto: extractBetweenLabels(
        text,
        ["Proyecto / Sede", "Proyecto/Sede"],
        ["RESUMEN DE RESULTADOS"]
      ),
      area: extractBetweenLabels(text, ["Area", "Área"], ["Puesto de Trabajo"]),
      puesto_trabajo: extractBetweenLabels(
        text,
        ["Puesto de Trabajo"],
        ["Grupo Sanguineo", "Grupo Sanguíneo"]
      ),
      n_ficha: matchFirst(text, /N.?\s*FICHA:\s*(\d+)/i),
      fecha_evaluacion: matchFirst(text, /FECHA DE EVALUACION:\s*([\d/-]+)/i),
      fecha_emision: extractBetweenLabels(
        text,
        ["Fecha de Emision", "Fecha de Emisión"],
        ["Firma y Sello del Medico", "Firma y Sello del Médico"]
      ),
      nombre_completo_original: nameParts.nombre_completo_original,
      nombres: nameParts.nombres,
      apellidos: nameParts.apellidos,
      dni: document.numero_documento,
      tipo_documento: document.tipo_documento,
      numero_documento: document.numero_documento,
      edad: matchInteger(text, /Edad:\s*(\d+)/i),
      sexo: extractBetweenLabels(text, ["Sexo"], ["Empresa"]),
      tipo_examen: detectTipoExamen(text),
    },

    datos_generales_narrables: {
      grupo_sanguineo: extractBetweenLabels(
        text,
        ["Grupo Sanguineo", "Grupo Sanguíneo"],
        ["Proyecto / Sede", "Proyecto/Sede"]
      ),
      peso_kg: matchNumber(text, /Peso:\s*([\d.,]+)/i),
      talla_cm: matchInteger(text, /Talla:\s*([\d.,]+)/i),
      pab_cm: matchInteger(text, /P\.?\s*Ab:\s*([\d.,]+)/i),
      imc: matchNumber(text, /IMC:\s*([\d.,]+)/i),
      pa_sistolica: paSistolica || null,
      pa_diastolica: paDiastolica || null,
      fc: matchInteger(text, /FC:\s*([\d.,]+)/i),
      fr: matchInteger(text, /FR:\s*([\d.,]+)/i),
      perimetro_cervical_cm: matchInteger(text, /P\.?\s*Cervical:\s*([\d.,]+)/i),
    },

    laboratorio_numerico: {
      hemoglobina_valor: matchNumber(text, /Hemoglobina\s+([\d.,]+)/i),
      glucosa_valor: matchNumber(text, /Glucosa\s+([\d.,]+)/i),
      trigliceridos_valor: matchNumber(text, /Trigliceridos\s+([\d.,]+)/i),
      colesterol_valor: matchNumber(text, /Colesterol\s+([\d.,]+)/i),
      globulos_rojos_valor: matchIntegerFromNormalizedText(
        text,
        /GLOBULOS ROJOS\s+([\d.,]+)/i
      ),
      hematocrito_valor: matchNumber(text, /Hematocrito\s+([\d.,]+)/i),
      leucocitos_valor: matchInteger(text, /Leucocitos\s+([\d.,]+)/i),
      plaquetas_valor: matchInteger(text, /Recuento de Plaquetas\s+([\d.,]+)/i),
    },

    evaluaciones_cualitativas: {
      examen_orina_resultado: extractBetweenLabels(
        text,
        ["Examen Orina"],
        ["Dosaje de cocaina", "Dosaje de cocaína"]
      ),
      dosaje_cocaina_resultado: extractBetweenLabels(
        text,
        ["Dosaje de cocaina", "Dosaje de cocaína"],
        ["Dosaje de marihuana"]
      ),
      dosaje_marihuana_resultado: extractBetweenLabels(
        text,
        ["Dosaje de marihuana"],
        ["Informe Psicologico", "Informe Psicológico"]
      ),
      informe_psicologico_resultado: extractBetweenLabels(
        text,
        ["Informe Psicologico", "Informe Psicológico"],
        ["Valoracion IMC", "Valoración IMC"]
      ),
      valoracion_imc_resultado: extractBetweenLabels(
        text,
        ["Valoracion IMC", "Valoración IMC"],
        ["Valoracion Musculo Esqueletica", "Valoración Musculo Esquelética"]
      ),
      musculoesqueletico_resultado: extractBetweenLabels(
        text,
        ["Valoracion Musculo Esqueletica", "Valoración Musculo Esquelética"],
        ["Evaluacion de Electrocardiograma"]
      ),
      ecg_resultado: extractBetweenLabels(
        text,
        ["Evaluacion de Electrocardiograma"],
        ["Evaluacion de Audiometria"]
      ),
      audiometria_resultado: extractBetweenLabels(
        text,
        ["Evaluacion de Audiometria"],
        ["Evaluacion Oftamologica", "Evaluación Oftamológica", "Evaluacion Oftalmologica", "Evaluación Oftalmológica"]
      ),
      oftalmologia_resultado: extractBetweenLabels(
        text,
        ["Evaluacion Oftamologica", "Evaluación Oftamológica", "Evaluacion Oftalmologica", "Evaluación Oftalmológica"],
        ["Evaluacion Espirometrica", "Evaluación Espirométrica"]
      ),
      espirometria_resultado: extractBetweenLabels(
        text,
        ["Evaluacion Espirometrica", "Evaluación Espirométrica"],
        ["Radiograma de Torax", "Radiograma de Tórax"]
      ),
      radiografia_torax_resultado: extractBetweenLabels(
        text,
        ["Radiograma de Torax", "Radiograma de Tórax"],
        ["Ficha Odontograma"]
      ),
      odontograma_resultado: extractBetweenLabels(
        text,
        ["Ficha Odontograma"],
        ["Otros"]
      ),
      otros_hallazgos_resultado: matchFirst(
        text,
        /Ficha Odontograma:\s*.*?\s+Otros:\s*(.+?)\s+RESTRICCIONES/i
      ),
    },

    aptitud_y_recomendaciones: {
      aptitud_final: detectAptitud(text),
      restricciones_texto: matchFirst(
        text,
        /RESTRICCIONES\s*(.*?)\s+APTITUD/i
      ),
      recomendaciones_generales_texto: extractRecommendations(text),
      recomendacion_imc: "",
      recomendacion_oftalmologia: "",
      recomendacion_audiometria: "",
      recomendacion_espirometria: "",
      recomendacion_metabolica: "",
    },

    app_fields: {
      texto_borrador: "",
      texto_final: "",
      audio_status: "pendiente",
      audio_filename: "",
      audio_url: "",
      needs_review: true,
      last_edited_at: "",
      last_generated_at: "",
    },

    derived_states: {
      source_type: "pdf_text",
      template_id: "innomedic_resultado_evaluacion_medica_v1",
      template_confidence: group.template_confidence,
      start_page: group.start_page,
      end_page: group.end_page,
      needs_review: true,
low_confidence_fields: [],
      missing_required_fields: [],
      invalid_numeric_fields: [],
    },
  };

result.derived_states.missing_required_fields = getMissingRequiredFields(result);
result.derived_states.low_confidence_fields = getLowConfidenceFields(result);

result.derived_states.needs_review =
  result.derived_states.missing_required_fields.length > 0 ||
  result.derived_states.low_confidence_fields.length > 0;

result.app_fields.needs_review = result.derived_states.needs_review;

return result;
}
