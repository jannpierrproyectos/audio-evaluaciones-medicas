const EMPTY_LIKE_VALUES = new Set([
  "",
  "-",
  "NO APLICA",
  "N/A",
  "NA",
  "S/D",
  "SD",
  "NO PROCEDE",
  "NO APLICA.",
  "NO PROCEDE.",
]);

const NORMAL_RESULT_TERMS = [
  "NORMAL",
  "SIN ALTERACIONES",
  "SIN HALLAZGOS",
  "NO PATOLOGICO",
  "NO PATOLOGICA",
  "NORMOACUSIA",
  "EMETROPE",
];

const RECOMMENDATION_AREAS = [
  {
    area: "dermatologia",
    keywords: ["DERMATOLOGIA", "ONICOMICOSIS"],
  },
  {
    area: "oftalmologia",
    keywords: ["CORRECTORES", "OCULARES", "LENTES", "OFTALMOLOGIA", "HIDRATANTES OCULARES"],
  },
  {
    area: "metabolico",
    keywords: ["ENDOCRINOLOGIA", "NUTRICION", "DIETA", "PESO", "ACTIVIDAD FISICA", "GRASAS", "CALORIAS"],
  },
  {
    area: "medicina_interna",
    keywords: ["MEDICINA INTERNA"],
  },
  {
    area: "cardiologia",
    keywords: ["CARDIOLOGIA", "CARDIOLOGO", "CARDIOLOGICA", "CARDIOLOGICO"],
  },
  {
    area: "neumologia",
    keywords: ["NEUMOLOGIA"],
  },
  {
    area: "gastroenterologia",
    keywords: ["GASTROENTEROLOGIA"],
  },
  {
    area: "ginecologia",
    keywords: ["GINECOLOGIA"],
  },
  {
    area: "traumatologia",
    keywords: ["TRAUMATOLOGIA"],
  },
  {
    area: "psicologia",
    keywords: ["PSICOLOGIA CLINICA", "ESTADO EMOCIONAL"],
  },
  {
    area: "alergias",
    keywords: ["MEDICAMENTO ALERGENO", "ALERGENO"],
  },
  {
    area: "vascular",
    keywords: ["BIPEDESTACION", "PAUSAS PASIVAS", "INSUFICIENCIA VENOSA"],
  },
  {
    area: "audiometria",
    keywords: ["AUDIOMETRIA", "REPOSO AUDITIVO", "OTORRINO", "OTORRINOLARINGOLOGIA", "PROTECTORES AUDITIVOS", "RUIDO"],
  },
  {
    area: "ocupacional",
    keywords: ["NO DEBE TRABAJAR", "ALTURA", "USO OBLIGATORIO", "DIFERENCIACION DE COLORES", "DISCRIMINAR COLORES"],
  },
  {
    area: "musculoesqueletico",
    keywords: ["MUSCULOESQUELETICO", "MUSCULO ESQUELETICO", "TERAPIA FISICA", "ERGONOMIA"],
  },
];

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeComparable(value) {
  return stripAccents(value).replace(/\s+/g, " ").trim().toUpperCase();
}

function hasNarrableValue(value) {
  const comparable = normalizeComparable(value);
  return !EMPTY_LIKE_VALUES.has(comparable);
}

function getString(value) {
  return hasNarrableValue(value) ? String(value).trim().replace(/\s+/g, " ") : "";
}

function normalizeBloodType(value) {
  const rawValue = getString(value);
  if (!rawValue) {
    return "";
  }

  const comparable = normalizeComparable(rawValue);
  const match = comparable.match(/^(A|B|AB|O)\s+(POSITIVO|NEGATIVO)$/);

  if (!match) {
    return rawValue;
  }

  return `${match[1]} ${match[2].toLowerCase()}`;
}

function toNumberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!hasNarrableValue(value)) {
    return null;
  }

  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isNormalResult(value) {
  if (!hasNarrableValue(value)) {
    return false;
  }

  const comparable = normalizeComparable(value);
  return NORMAL_RESULT_TERMS.some((term) => comparable.includes(term));
}

function hasCardiologyRecommendation(recommendations = []) {
  return recommendations.some((item) => item.area === "cardiologia");
}

function classifyImc(imc) {
  if (imc === null) return "";
  if (imc < 18.5) return "bajo peso";
  if (imc < 25) return "normal";
  if (imc < 30) return "sobrepeso";
  if (imc < 35) return "obesidad tipo I";
  if (imc < 40) return "obesidad tipo II";
  return "obesidad tipo III";
}

function isMetabolicImc(classification) {
  return ["sobrepeso", "obesidad tipo I", "obesidad tipo II", "obesidad tipo III"].includes(
    classification,
  );
}

function createFinding({
  area,
  tipo = "alteracion",
  resultado,
  severidad = "warning",
  narrar = true,
  field = "",
  source = "",
  sources = [],
}) {
  return {
    area,
    tipo,
    resultado,
    severidad,
    narrar,
    field,
    source,
    sources: sources.length ? sources : [source].filter(Boolean),
  };
}

function createLabItem({ field, label, value, tipo, status, severidad, area = "metabolico" }) {
  return {
    area,
    field,
    label,
    value,
    tipo,
    status,
    severidad,
    narrar: true,
  };
}

function addLabFinding(laboratorioRelevante, hallazgosRelevantes, item) {
  laboratorioRelevante.push(item);
}

function deriveLaboratory(laboratorio = {}) {
  const laboratorioRelevante = [];
  const hallazgosRelevantes = [];

  const glucosa = toNumberOrNull(laboratorio.glucosa_valor);
  if (glucosa !== null && glucosa > 100) {
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        field: "laboratorio_numerico.glucosa_valor",
        label: "Glucosa",
        value: glucosa,
        tipo: glucosa >= 126 ? "alteracion" : "limite_alto",
        status: "elevada",
        severidad: glucosa >= 126 ? "warning" : "info",
      }),
    );
  }

  const trigliceridos = toNumberOrNull(laboratorio.trigliceridos_valor);
  if (trigliceridos !== null && trigliceridos >= 150) {
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        field: "laboratorio_numerico.trigliceridos_valor",
        label: "Trigliceridos",
        value: trigliceridos,
        tipo: trigliceridos >= 200 ? "alteracion" : "limite_alto",
        status: trigliceridos >= 200 ? "elevados" : "limite alto",
        severidad: trigliceridos >= 200 ? "warning" : "info",
      }),
    );
  }

  const colesterol = toNumberOrNull(laboratorio.colesterol_valor);
  if (colesterol !== null && colesterol >= 200) {
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        field: "laboratorio_numerico.colesterol_valor",
        label: "Colesterol",
        value: colesterol,
        tipo: colesterol >= 240 ? "alteracion" : "limite_alto",
        status: colesterol >= 240 ? "elevado" : "limite alto",
        severidad: colesterol >= 240 ? "warning" : "info",
      }),
    );
  }

  const leucocitos = toNumberOrNull(laboratorio.leucocitos_valor);
  if (leucocitos !== null && leucocitos > 10000) {
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        area: "hemograma",
        field: "laboratorio_numerico.leucocitos_valor",
        label: "Leucocitos",
        value: leucocitos,
        tipo: "alteracion",
        status: "ligeramente elevados",
        severidad: "info",
      }),
    );
  }

  const plaquetas = toNumberOrNull(laboratorio.plaquetas_valor);
  if (plaquetas !== null && (plaquetas < 150000 || plaquetas > 450000)) {
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        area: "hemograma",
        field: "laboratorio_numerico.plaquetas_valor",
        label: "Plaquetas",
        value: plaquetas,
        tipo: "alteracion",
        status: plaquetas < 150000 ? "disminuidas" : "elevadas",
        severidad: "info",
      }),
    );
  }

  return {
    laboratorioRelevante,
    hallazgosRelevantes,
  };
}

function addFindingIfRelevant(findings, value, area, field, options = {}) {
  const result = getString(value);
  if (!result) {
    return;
  }

  const comparable = normalizeComparable(result);
  if (options.matches && !options.matches(comparable)) {
    return;
  }

  if (isNormalResult(result) && !options.matches) {
    return;
  }

  findings.push(
    createFinding({
      area,
      field: `evaluaciones_cualitativas.${field}`,
      resultado: result,
      tipo: options.tipo ? options.tipo(comparable) : "alteracion",
      severidad: options.severidad ? options.severidad(comparable) : "warning",
      source: "evaluaciones_cualitativas",
    }),
  );
}

function pickOnychomycosisFindings(value) {
  const result = getString(value);
  const matches = [
    ...result.matchAll(
      /(?:DESCARTAR\s+)?ONICOMICOSIS\s+PEDIA\s+(BILATERAL|IZQUIERDA|DERECHA)/gi,
    ),
  ];

  if (!matches.length && !normalizeComparable(result).includes("ONICOMICOSIS")) {
    return [];
  }

  const sides = matches.length
    ? matches.map((match) => normalizeComparable(match[1]))
    : ["BILATERAL"];

  return Array.from(new Set(sides)).map((side) => {
    if (side.includes("IZQUIERDA")) {
      return "descartar onicomicosis en el pie izquierdo";
    }

    if (side.includes("DERECHA")) {
      return "descartar onicomicosis en el pie derecho";
    }

    return "descartar onicomicosis en ambos pies";
  });
}

function pickRecognizedOtherSegments(result, comparable, options = {}) {
  const findings = [];

  pickOnychomycosisFindings(result).forEach((onychomycosisFinding) => {
    findings.push(
      createFinding({
        area: "dermatologia",
        tipo: "alteracion",
        resultado: onychomycosisFinding,
        severidad: "warning",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  });

  if (comparable.includes("HIPERTRIGLICERIDEMIA")) {
    findings.push(
      createFinding({
        area: "metabolico",
        tipo: "alteracion",
        resultado: "hipertrigliceridemia",
        severidad: "warning",
        narrar: !options.hasTriglyceridesLabFinding,
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  }

  if (comparable.includes("HIPERGLICEMIA")) {
    const treatmentSuffix = comparable.includes("EN TRATAMIENTO")
      ? " en tratamiento"
      : "";
    findings.push(
      createFinding({
        area: "metabolico",
        tipo: "alteracion",
        resultado: `hiperglicemia${treatmentSuffix}`,
        severidad: "warning",
        narrar: !options.hasGlucoseLabFinding,
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  }

  if (comparable.includes("HIPERLIPIDEMIA MIXTA")) {
    const treatmentSuffix = comparable.includes("EN TRATAMIENTO")
      ? " en tratamiento"
      : "";
    findings.push(
      createFinding({
        area: "metabolico",
        tipo: "alteracion",
        resultado: `hiperlipidemia mixta${treatmentSuffix}`,
        severidad: "warning",
        narrar: !options.hasTriglyceridesLabFinding && !options.hasCholesterolLabFinding,
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  }

  const unrecognizedText = getString(
    result
      .replace(/DESCARTAR\s+ONICOMICOSIS\s+PEDIA\s+(BILATERAL|IZQUIERDA|DERECHA)/gi, "")
      .replace(/ONICOMICOSIS\s+PEDIA\s+(BILATERAL|IZQUIERDA|DERECHA)/gi, "")
      .replace(/[;,.]\s*(?=[;,.]|$)/g, "")
      .replace(/HIPERTRIGLICERIDEMIA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
      .replace(/HIPERGLICEMIA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
      .replace(/HIPERLIPIDEMIA\s+MIXTA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
      .replace(/[\s;,.]+/g, " ")
      .trim(),
  );

  if (unrecognizedText) {
    findings.push(
      createFinding({
        area: "otros",
        tipo: "otro",
        resultado: unrecognizedText,
        severidad: "info",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  }

  return findings;
}

function deriveOtherFindings(value, options = {}) {
  const result = getString(value);
  if (!result || isNormalResult(result)) {
    return [];
  }

  const comparable = normalizeComparable(result);
  const findings = pickRecognizedOtherSegments(result, comparable, options);

  if (findings.length === 0) {
    findings.push(
      createFinding({
        area: "otros",
        tipo: "otro",
        resultado: result,
        severidad: "info",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
      }),
    );
  }

  return findings;
}

function deriveQualitativeFindings(evaluaciones = {}, options = {}) {
  const findings = [];
  const normales = [];

  addFindingIfRelevant(findings, evaluaciones.oftalmologia_resultado, "oftalmologia", "oftalmologia_resultado", {
    matches: (value) =>
      !isNormalResult(value) &&
      (value.includes("PRESBICIA") ||
        value.includes("AMETROPIA") ||
        value.includes("PTERIGION") ||
        value.includes("VISION") ||
        value.includes("DISCROMATOPSIA") ||
        value.includes("PTOSIS")),
  });

  addFindingIfRelevant(findings, evaluaciones.audiometria_resultado, "audiometria", "audiometria_resultado", {
    matches: (value) =>
      value.includes("PENDIENTE") ||
      value.includes("HIPOACUSIA") ||
      value.includes("INFRANORMAL") ||
      value.includes("ALTERACIONES NO DEBIDAS A RUIDO"),
    tipo: (value) => (value.includes("PENDIENTE") ? "pendiente" : "alteracion"),
    severidad: (value) => (value.includes("PENDIENTE") ? "info" : "warning"),
  });

  if (
    hasNarrableValue(evaluaciones.ecg_resultado) &&
    !isNormalResult(evaluaciones.ecg_resultado) &&
    options.hasCardiologyRecommendation
  ) {
    addFindingIfRelevant(findings, evaluaciones.ecg_resultado, "cardiologia", "ecg_resultado");
  }

  addFindingIfRelevant(findings, evaluaciones.espirometria_resultado, "espirometria", "espirometria_resultado");
  addFindingIfRelevant(
    findings,
    evaluaciones.radiografia_torax_resultado,
    "radiografia_torax",
    "radiografia_torax_resultado",
  );
  addFindingIfRelevant(
    findings,
    evaluaciones.musculoesqueletico_resultado,
    "musculoesqueletico",
    "musculoesqueletico_resultado",
    {
      matches: (value) =>
        value.includes("REGULAR") ||
        value.includes("ALTERADO") ||
        value.includes("IMC") ||
        value.includes("MASA CORPORAL"),
    },
  );

  findings.push(...deriveOtherFindings(evaluaciones.otros_hallazgos_resultado, options));

  [
    ["ecg_resultado", "ecg"],
    ["examen_orina_resultado", "orina"],
    ["informe_psicologico_resultado", "psicologico"],
    ["espirometria_resultado", "espirometria"],
    ["radiografia_torax_resultado", "radiografia_torax"],
    ["audiometria_resultado", "audiometria"],
    ["oftalmologia_resultado", "oftalmologia"],
  ].forEach(([field, area]) => {
    const value = getString(evaluaciones[field]);
    if (value && isNormalResult(value)) {
      normales.push({
        area,
        field: `evaluaciones_cualitativas.${field}`,
        value,
      });
    }
  });

  return {
    hallazgosRelevantes: findings,
    examenesNormalesResumibles: normales,
  };
}

function cleanDerivedRecommendation(value) {
  return getString(value)
    .replace(/\bCONTROL\s+CONTROL\b/gi, "CONTROL")
    .replace(/(^|\s)\[(\d+(?:,\d+)*(?:\s*Y\s*\d+)?)\]\s*/gi, "$1")
    .replace(/(^|\s)\d+(?:,\d+)*(?:\s*Y\s*\d+)?\.(?=\s+[A-ZÁÉÍÓÚÑ])/gi, "$1")
    .replace(/^\.+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactNumbering(value) {
  return String(value || "")
    .replace(/\[(\d+(?:,\d+)*(?:\s*Y\s*\d+)?)\]/gi, " $1.")
    .replace(/(\d+(?:,\d+)*)(?:\s*Y\s*(\d+))+\.?/gi, (match) => {
      const marker = match.replace(/\s+/g, "").replace(/\.+$/g, "");
      return `${marker}.`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function splitRecommendationItems(value) {
  const text = normalizeCompactNumbering(getString(value));
  if (!text) {
    return [];
  }

  const matches = [
    ...text.matchAll(/(?:^|\s)(\[\d+(?:,\d+)*(?:Y\d+)?\]|\d+(?:,\d+)*(?:Y\d+)?\.)(?=\s+[A-ZÁÉÍÓÚÑ])/gi),
  ];
  if (matches.length === 0) {
    return [{ marker: "", text }];
  }

  return matches
    .map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      return {
        marker: match[1].replace(/^\[|\]$/g, "").replace(/\.$/, ""),
        text: text.slice(start, end).trim(),
      };
    })
    .filter((item) => item.text);
}

function classifyRecommendations(value) {
  const items = splitRecommendationItems(value);
  const recommendations = [];

  for (const item of items) {
    const normalizedText = normalizeComparable(item.text);
    const warningMessages = [];
    if (normalizedText.includes("CONTROL CONTROL")) {
      warningMessages.push("Posible duplicidad CONTROL CONTROL normalizada en objeto derivado.");
    }

    const areas = RECOMMENDATION_AREAS.filter((areaConfig) =>
      areaConfig.keywords.some((keyword) => normalizedText.includes(keyword)),
    );

    if (areas.length === 0) {
      recommendations.push({
        area: "general",
        item: item.marker,
        texto_original: item.text,
        texto_normalizado: cleanDerivedRecommendation(item.text),
        matched_keywords: [],
        warnings: warningMessages,
      });
      continue;
    }

    areas.forEach((areaConfig) => {
      recommendations.push({
        area: areaConfig.area,
        item: item.marker,
        texto_original: item.text,
        texto_normalizado: cleanDerivedRecommendation(item.text),
        matched_keywords: areaConfig.keywords.filter((keyword) =>
          normalizedText.includes(keyword),
        ),
        warnings: warningMessages,
      });
    });
  }

  return recommendations;
}

function deriveReviewStatus(worker, aptitudFinal) {
  const reviewedByUser = Boolean(worker.derived_states?.reviewed_by_user);
  const rawPendingFields = [
    ...(worker.derived_states?.low_confidence_fields || []),
    ...(worker.derived_states?.missing_required_fields || []),
  ];
  const reviewedFields = [];
  const pendingFields = [];
  const aptitudIsResolved =
    Boolean(getString(aptitudFinal)) && normalizeComparable(aptitudFinal) !== "PENDIENTE";

  rawPendingFields.forEach((field) => {
    const isNameField =
      field === "identificacion.nombres" || field === "identificacion.apellidos";
    const isAptitudeField = field === "aptitud_y_recomendaciones.aptitud_final";

    if (reviewedByUser && (isNameField || (isAptitudeField && aptitudIsResolved))) {
      reviewedFields.push(field);
      return;
    }

    if (!pendingFields.includes(field)) {
      pendingFields.push(field);
    }
  });

  if (reviewedByUser) {
    ["identificacion.nombres", "identificacion.apellidos"].forEach((field) => {
      if (!reviewedFields.includes(field)) {
        reviewedFields.push(field);
      }
    });

    if (aptitudIsResolved && !reviewedFields.includes("aptitud_y_recomendaciones.aptitud_final")) {
      reviewedFields.push("aptitud_y_recomendaciones.aptitud_final");
    }
  }

  return {
    reviewed_by_user: reviewedByUser,
    has_pending_review_fields: pendingFields.length > 0,
    pending_review_fields: pendingFields,
    reviewed_fields: reviewedFields,
  };
}

function getFindingKey(finding) {
  return [
    finding.area,
    finding.tipo,
    normalizeComparable(finding.resultado),
  ].join("|");
}

function dedupeFindings(findings) {
  const byKey = new Map();

  findings.forEach((finding) => {
    const key = getFindingKey(finding);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, finding);
      return;
    }

    byKey.set(key, {
      ...existing,
      sources: Array.from(new Set([...(existing.sources || []), ...(finding.sources || [])])),
    });
  });

  return Array.from(byKey.values());
}

function createEmptyNarrativeGroups() {
  return {
    metabolico: { narrar: false, hallazgos: [], recomendaciones: [] },
    oftalmologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    audiometria: { narrar: false, hallazgos: [], recomendaciones: [] },
    dermatologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    medicina_interna: { narrar: false, hallazgos: [], recomendaciones: [] },
    musculoesqueletico: { narrar: false, hallazgos: [], recomendaciones: [] },
    espirometria: { narrar: false, hallazgos: [], recomendaciones: [] },
    neumologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    radiografia_torax: { narrar: false, hallazgos: [], recomendaciones: [] },
    cardiologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    traumatologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    gastroenterologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    ginecologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    psicologia: { narrar: false, hallazgos: [], recomendaciones: [] },
    alergias: { narrar: false, hallazgos: [], recomendaciones: [] },
    vascular: { narrar: false, hallazgos: [], recomendaciones: [] },
    hemograma: { narrar: false, hallazgos: [], recomendaciones: [] },
    ocupacional: { narrar: false, hallazgos: [], recomendaciones: [] },
    otros: { narrar: false, hallazgos: [], recomendaciones: [] },
  };
}

function addGroupFinding(groups, finding) {
  const area = groups[finding.area] ? finding.area : "otros";
  groups[area].hallazgos.push(finding);
  groups[area].narrar = groups[area].narrar || Boolean(finding.narrar);
}

function buildNarrativeGroups({ hallazgosRelevantes, laboratorioRelevante, recomendacionesPorArea }) {
  const groups = createEmptyNarrativeGroups();

  laboratorioRelevante.forEach((item) => {
    addGroupFinding(
      groups,
      createFinding({
        area: item.area,
        tipo: item.tipo,
        resultado: `${item.label}: ${item.value} (${item.status})`,
        severidad: item.severidad,
        narrar: item.narrar,
        field: item.field,
        source: "laboratorio_numerico",
      }),
    );
  });

  hallazgosRelevantes.forEach((finding) => addGroupFinding(groups, finding));

  recomendacionesPorArea.forEach((recommendation) => {
    const area = groups[recommendation.area] ? recommendation.area : "otros";
    groups[area].recomendaciones.push(recommendation);
    groups[area].narrar = true;
  });

  return groups;
}

export function deriveNarrativeFindings(worker = {}) {
  const identificacion = worker.identificacion || {};
  const generales = worker.datos_generales_narrables || {};
  const laboratorio = worker.laboratorio_numerico || {};
  const evaluaciones = worker.evaluaciones_cualitativas || {};
  const aptitudData = worker.aptitud_y_recomendaciones || {};
  const validation = worker.validation || {};
  const blockingReasons = [];

  const aptitudFinal = getString(aptitudData.aptitud_final);
  const normalizedAptitud = normalizeComparable(aptitudFinal);
  const reviewStatus = deriveReviewStatus(worker, aptitudFinal);

  if (!reviewStatus.reviewed_by_user) {
    blockingReasons.push("Falta revision humana del trabajador.");
  }

  if (!aptitudFinal || normalizedAptitud === "PENDIENTE") {
    blockingReasons.push("Aptitud final vacia o pendiente.");
  }

  if (validation.has_errors) {
    blockingReasons.push("La validacion automatica tiene errores.");
  }

  const imc = toNumberOrNull(generales.imc);
  const clasificacionImc = classifyImc(imc);
  const pesoKg = toNumberOrNull(generales.peso_kg);
  const tallaCm = toNumberOrNull(generales.talla_cm);
  const hasFullAnthropometry = pesoKg !== null && tallaCm !== null && imc !== null;
  const anthropometryIsRelevant = isMetabolicImc(clasificacionImc);
  const grupoSanguineo = normalizeBloodType(generales.grupo_sanguineo);
  const hemoglobinaValor = toNumberOrNull(laboratorio.hemoglobina_valor);
  const glucosaValor = toNumberOrNull(laboratorio.glucosa_valor);
  const trigliceridosValor = toNumberOrNull(laboratorio.trigliceridos_valor);
  const colesterolValor = toNumberOrNull(laboratorio.colesterol_valor);
  const leucocitosValor = toNumberOrNull(laboratorio.leucocitos_valor);
  const plaquetasValor = toNumberOrNull(laboratorio.plaquetas_valor);

  const laboratory = deriveLaboratory(laboratorio);
  const hasTriglyceridesLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.trigliceridos_valor",
  );
  const hasCholesterolLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.colesterol_valor",
  );
  const hasGlucoseLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.glucosa_valor",
  );
  const recomendacionesPorArea = classifyRecommendations(
    aptitudData.recomendaciones_generales_texto,
  );
  const hasCardiologyRecommendationValue = hasCardiologyRecommendation(
    recomendacionesPorArea,
  );
  const qualitative = deriveQualitativeFindings(evaluaciones, {
    hasTriglyceridesLabFinding,
    hasCholesterolLabFinding,
    hasGlucoseLabFinding,
    hasCardiologyRecommendation: hasCardiologyRecommendationValue,
  });
  const metabolicRecommendations = recomendacionesPorArea
    .filter((item) => item.area === "metabolico")
    .map((item) => item.texto_normalizado || item.texto_original)
    .filter(Boolean);
  const hallazgosRelevantes = dedupeFindings(qualitative.hallazgosRelevantes);
  const narrativeGroups = buildNarrativeGroups({
    hallazgosRelevantes,
    laboratorioRelevante: laboratory.laboratorioRelevante,
    recomendacionesPorArea,
  });
  const hasOmittedEcgFinding =
    hasNarrableValue(evaluaciones.ecg_resultado) &&
    !isNormalResult(evaluaciones.ecg_resultado) &&
    !hasCardiologyRecommendationValue;

  return {
    can_generate_narrative: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    review_status: reviewStatus,
    saludo: {
      nombres: getString(identificacion.nombres),
      apellidos: getString(identificacion.apellidos),
      nombre_para_saludo:
        getString(identificacion.nombre_completo_original) ||
        [getString(identificacion.nombres), getString(identificacion.apellidos)]
          .filter(Boolean)
          .join(" "),
      sexo: getString(identificacion.sexo),
      empresa: getString(identificacion.empresa),
    },
    laboratorio_basico: {
      narrar: Boolean(
        grupoSanguineo ||
          hemoglobinaValor !== null ||
          glucosaValor !== null ||
          trigliceridosValor !== null ||
          colesterolValor !== null ||
          leucocitosValor !== null ||
          plaquetasValor !== null,
      ),
      grupo_sanguineo: grupoSanguineo,
      hemoglobina_valor: hemoglobinaValor,
      glucosa_valor: glucosaValor,
      trigliceridos_valor: trigliceridosValor,
      colesterol_valor: colesterolValor,
      leucocitos_valor: leucocitosValor,
      plaquetas_valor: plaquetasValor,
      alteraciones: laboratory.laboratorioRelevante.map((item) => ({
        area: item.area,
        field: item.field,
        label: item.label,
        value: item.value,
        tipo: item.tipo,
        status: item.status,
        severidad: item.severidad,
      })),
    },
    antropometria: {
      narrar: hasFullAnthropometry,
      peso_kg: pesoKg,
      talla_cm: tallaCm,
      imc,
      clasificacion_imc: clasificacionImc,
      tipo: anthropometryIsRelevant ? "alteracion" : "normal_relevante",
      recomendacion: anthropometryIsRelevant ? metabolicRecommendations.join(". ") : "",
    },
    signos_vitales: {
      narrar:
        toNumberOrNull(generales.pa_sistolica) !== null ||
        toNumberOrNull(generales.pa_diastolica) !== null ||
        toNumberOrNull(generales.fc) !== null ||
        toNumberOrNull(generales.fr) !== null,
      pa_sistolica: toNumberOrNull(generales.pa_sistolica),
      pa_diastolica: toNumberOrNull(generales.pa_diastolica),
      fc: toNumberOrNull(generales.fc),
      fr: toNumberOrNull(generales.fr),
      observaciones: [],
    },
    laboratorio_relevante: laboratory.laboratorioRelevante,
    hallazgos_relevantes: hallazgosRelevantes,
    examenes_normales_resumibles: qualitative.examenesNormalesResumibles,
    has_omitted_findings: hasOmittedEcgFinding,
    recomendaciones_por_area: recomendacionesPorArea,
    narrative_groups: narrativeGroups,
    aptitud: {
      resultado: aptitudFinal,
      narrar: Boolean(aptitudFinal && normalizedAptitud !== "PENDIENTE"),
    },
    restricciones: {
      texto: getString(aptitudData.restricciones_texto),
      narrar: hasNarrableValue(aptitudData.restricciones_texto),
    },
    source_trace: {
      reviewed_by_user: "derived_states.reviewed_by_user",
      reviewed_at: "derived_states.reviewed_at",
      aptitud: "aptitud_y_recomendaciones.aptitud_final",
      antropometria: [
        "datos_generales_narrables.peso_kg",
        "datos_generales_narrables.talla_cm",
        "datos_generales_narrables.imc",
      ],
      laboratorio: [
        "datos_generales_narrables.grupo_sanguineo",
        "laboratorio_numerico.hemoglobina_valor",
        "laboratorio_numerico.glucosa_valor",
        "laboratorio_numerico.trigliceridos_valor",
        "laboratorio_numerico.colesterol_valor",
        "laboratorio_numerico.leucocitos_valor",
        "laboratorio_numerico.plaquetas_valor",
      ],
      otros_hallazgos: "evaluaciones_cualitativas.otros_hallazgos_resultado",
      recomendaciones: "aptitud_y_recomendaciones.recomendaciones_generales_texto",
      metabolico: {
        laboratorio: laboratory.laboratorioRelevante
          .filter((item) => item.area === "metabolico")
          .map((item) => item.field),
        otros_hallazgos: normalizeComparable(evaluaciones.otros_hallazgos_resultado).includes(
          "HIPERTRIGLICERIDEMIA",
        )
          ? "evaluaciones_cualitativas.otros_hallazgos_resultado"
          : "",
        recomendaciones: recomendacionesPorArea
          .filter((item) => item.area === "metabolico")
          .map((item) => item.item || item.texto_original),
      },
    },
  };
}
