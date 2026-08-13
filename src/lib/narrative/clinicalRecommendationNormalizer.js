const MONTH_NAMES = [
  "",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const NUMBER_WORDS = new Map([
  [1, "un"],
  [2, "dos"],
  [3, "tres"],
  [4, "cuatro"],
  [5, "cinco"],
  [6, "seis"],
  [7, "siete"],
  [8, "ocho"],
  [9, "nueve"],
  [10, "diez"],
  [11, "once"],
  [12, "doce"],
  [13, "trece"],
  [14, "catorce"],
  [15, "quince"],
  [16, "dieciseis"],
  [17, "diecisiete"],
  [18, "dieciocho"],
  [19, "diecinueve"],
  [20, "veinte"],
  [21, "veintiun"],
  [22, "veintidos"],
  [23, "veintitres"],
  [24, "veinticuatro"],
  [25, "veinticinco"],
  [26, "veintiseis"],
  [27, "veintisiete"],
  [28, "veintiocho"],
  [29, "veintinueve"],
  [30, "treinta"],
  [31, "treinta y un"],
]);

const ACCENT_REPLACEMENTS = [
  [/\bendocrinologia\b/gi, "endocrinología"],
  [/\botorrinolaringologia\b/gi, "otorrinolaringología"],
  [/\boftalmologia\b/gi, "oftalmología"],
  [/\bdermatologia\b/gi, "dermatología"],
  [/\bcardiologia\b/gi, "cardiología"],
  [/\bgastroenterologia\b/gi, "gastroenterología"],
  [/\bginecologia\b/gi, "ginecología"],
  [/\bneumologia\b/gi, "neumología"],
  [/\btraumatologia\b/gi, "traumatología"],
  [/\bnutricion\b/gi, "nutrición"],
  [/\bevaluacion\b/gi, "evaluación"],
  [/\bfisica\b/gi, "física"],
  [/\bmedico\b/gi, "médico"],
  [/\bproximo\b/gi, "próximo"],
  [/\bcalorias\b/gi, "calorías"],
  [/\bproteccion\b/gi, "protección"],
  [/\bexposicion\b/gi, "exposición"],
  [/\blimites\b/gi, "límites"],
  [/\bmaximos\b/gi, "máximos"],
  [/\bareas\b/gi, "áreas"],
  [/\balergeno\b/gi, "alérgeno"],
];

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeClinicalComparable(value) {
  return stripAccents(value).replace(/\s+/g, " ").trim().toUpperCase();
}

function cleanupSpaces(value) {
  return String(value || "")
    .replace(/([,.;:])(?=[^\s\d])/g, "$1 ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value) {
  const text = cleanupSpaces(value).toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function applyAccents(value) {
  let text = cleanupSpaces(value);

  ACCENT_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return text;
}

export function normalizeClinicalRecommendationText(value) {
  let text = cleanupSpaces(value)
    .replace(/(^|\s)\d+(?:\s*[,Y]\s*\d+)+\.?(?=\s+[A-ZÁÉÍÓÚÑ])/gi, "$1")
    .replace(/(^|\s)\[\d+(?:,\d+)*(?:\s*y\s*\d+)?\]\s*/gi, "$1")
    .replace(/(^|\s)\d+(?:,\d+)*(?:\s*y\s*\d+)?\.(?=\s+[A-ZÁÉÍÓÚÑ])/gi, "$1")
    .replace(/\bcontrol\s+control\b/gi, "control")
    .replace(/\bfisica,\s*dieta\b/gi, "física, dieta")
    .replace(/\b1\.80\s*metros\b/gi, "un metro ochenta")
    .replace(/\b0?1\s+mes\b/gi, "un mes")
    .replace(/\b0?3\s+meses\b/gi, "tres meses")
    .replace(/\b0?6\s+meses\b/gi, "seis meses")
    .replace(/\b12\s+meses\b/gi, "doce meses");

  text = applyAccents(text).toLowerCase();
  return cleanupSpaces(text).replace(/[.]+$/g, "");
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function pushUnique(items, value) {
  const normalized = normalizeClinicalRecommendationText(value);
  if (!normalized) return;

  const key = normalizeClinicalComparable(normalized);
  if (!items.some((item) => normalizeClinicalComparable(item) === key)) {
    items.push(normalized);
  }
}

function getGroupText(group) {
  return [
    ...(group?.recomendaciones || []).flatMap((item) => [
      item.texto_original,
      item.texto_normalizado,
    ]),
    ...(group?.hallazgos || []).map((item) => item.resultado),
  ]
    .filter(Boolean)
    .join(". ");
}

function hasTreatment(text) {
  return text.includes("EN TRATAMIENTO") || text.includes("CONTINUAR CON TRATAMIENTO");
}

function getNextControl(text) {
  const monthMatch = text.match(/PROXIMO CONTROL(?:\s+EN)?\s+(\d{1,2})\s+MESES?/);
  if (monthMatch) {
    const months = Number(monthMatch[1]);
    const word = NUMBER_WORDS.get(months) || String(months);
    return `su próximo control está indicado en ${word} ${months === 1 ? "mes" : "meses"}`;
  }

  if (/PROXIMO CONTROL ANUAL/.test(text)) {
    return "su próximo control está indicado de forma anual";
  }

  const dateMatch = text.match(/PROXIMO CONTROL(?:\s+EL)?\s+(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!dateMatch) return "";

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const dayWord = NUMBER_WORDS.get(day) || String(day);
  const monthName = MONTH_NAMES[month] || "";
  const yearText = year === 2026 ? "dos mil veintiséis" : String(year);

  return monthName ? `su próximo control está indicado para el ${dayWord} de ${monthName} de ${yearText}` : "";
}

function normalizeMetabolic(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];
  const hasEndocrineNutrition = text.includes("ENDOCRINOLOGIA") && text.includes("NUTRICION");
  const hasDiet = hasAny(text, ["DIETA", "GRASAS", "CALORIAS"]);
  const hasActivity = text.includes("ACTIVIDAD FISICA");
  const hasWeightControl = text.includes("CONTROL MENSUAL DE PESO");
  const hasEndocrinology = text.includes("ENDOCRINOLOGIA");
  const hasNutrition = text.includes("NUTRICION");
  const hasVigilance = text.includes("VIGILANCIA MEDICA OCUPACIONAL") || text.includes("MEDICO DE EMPRESA");

  if (hasActivity) pushUnique(items, "aumentar la actividad física");
  if (hasDiet) pushUnique(items, "seguir una dieta baja en grasas y calorías");
  if (hasWeightControl) pushUnique(items, "realizar control mensual de peso");

  if (hasEndocrineNutrition) {
    pushUnique(items, "acudir a control por endocrinología y nutrición");
  } else {
    if (hasEndocrinology) pushUnique(items, "evaluación por endocrinología");
    if (hasNutrition) pushUnique(items, "control por nutrición");
  }

  if (hasTreatment(text)) {
    pushUnique(items, "continuar el tratamiento indicado");
    if (hasEndocrinology && !hasEndocrineNutrition) {
      pushUnique(items, "mantener seguimiento por endocrinología");
    }
  }

  const nextControl = getNextControl(text);
  if (nextControl) pushUnique(items, nextControl.replace("su próximo control", "el próximo control"));
  if (hasVigilance) pushUnique(items, "ingresar a vigilancia médica ocupacional por el médico de la empresa");

  return items;
}

function normalizeOphthalmology(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];
  const permanent = text.includes("PERMANENTE");
  const asNeeded = text.includes("SEGUN NECESIDAD");

  if (text.includes("CORRECTORES OCULARES") || text.includes("LENTES")) {
    if (permanent) {
      pushUnique(items, "uso permanente de correctores oculares");
    } else if (asNeeded) {
      pushUnique(items, "usar correctores oculares según necesidad");
    } else {
      pushUnique(items, "usar correctores oculares");
    }
  }

  if (text.includes("RENOVACION")) pushUnique(items, "renovar la medida si corresponde");
  if (text.includes("HIDRATANTES OCULARES")) pushUnique(items, "usar hidratantes oculares si fueron indicados");
  if (text.includes("CONTROL ANUAL")) {
    pushUnique(items, "control oftalmológico anual");
  } else if (text.includes("OFTALMOLOGIA")) {
    pushUnique(items, "acudir a control por oftalmología");
  }

  return items;
}

function normalizeAudiometry(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];

  if (text.includes("PROTECTORES AUDITIVOS")) {
    pushUnique(items, text.includes("ESTRICTO") ? "el uso estricto de protectores auditivos en zonas de ruido" : "el uso de protectores auditivos en zonas de ruido");
  }

  const hasFollowup = hasTreatment(text) || text.includes("SEGUIMIENTO Y CONTROL");

  if (text.includes("INTERCONSULTA") && text.includes("OTORRINOLARINGOLOGIA")) {
    pushUnique(items, "interconsulta por otorrinolaringología");
  } else if (!hasFollowup && (text.includes("OTORRINOLARINGOLOGIA") || text.includes("OTORRINO"))) {
    pushUnique(items, "control por otorrinolaringología");
  }

  if (hasFollowup) {
    pushUnique(items, "continuar seguimiento por otorrinolaringología");
  }

  if (text.includes("INDICACIONES DE MEDICO ESPECIALISTA")) {
    pushUnique(items, "seguir las indicaciones del especialista");
  }

  const nextControl = getNextControl(text);
  if (nextControl) pushUnique(items, nextControl.replace("su próximo control", "el próximo control"));

  return items;
}

function normalizeDermatology(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];

  if (hasTreatment(text)) {
    pushUnique(items, "continuar el tratamiento indicado");
    pushUnique(items, "mantener control regular por dermatología");
    return items;
  }

  if (text.includes("DERMATOLOGIA")) {
    pushUnique(items, "evaluación por dermatología");
  }

  return items;
}

function normalizeSimpleSpecialty(group, specialty, options = {}) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];
  const specialtyComparable = normalizeClinicalComparable(specialty);
  const nextControl = getNextControl(text);

  if (hasTreatment(text)) pushUnique(items, "continuar el tratamiento indicado");

  if (text.includes("SEGUIMIENTO") || text.includes("CONTROL")) {
    pushUnique(items, `mantener control por ${specialty}`);
  } else if (text.includes("EVALUACION") || text.includes("INTERCONSULTA")) {
    pushUnique(items, `evaluación por ${specialty}`);
  } else if (text.includes(specialtyComparable)) {
    pushUnique(items, options.defaultText || `control por ${specialty}`);
  }

  if (text.includes("INDICACIONES DE MEDICO ESPECIALISTA")) {
    pushUnique(items, "seguir las indicaciones del especialista");
  }

  if (nextControl) pushUnique(items, nextControl.replace("su próximo control", "el próximo control"));
  return items;
}

function normalizeOccupational(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];

  if (text.includes("USO OBLIGATORIO DE CORRECTORES OCULARES")) {
    pushUnique(items, "no debe realizar actividades sin el uso obligatorio de correctores oculares");
  }

  if (text.includes("ALTURA MAYOR A 1.80 METROS") || text.includes("ALTURA MAYOR A UN METRO OCHENTA")) {
    pushUnique(items, "no debe trabajar en altura mayor a un metro ochenta");
  }

  if (text.includes("DIFERENCIACION DE COLORES") || text.includes("DISCRIMINAR COLORES")) {
    pushUnique(
      items,
      "por alteración en la discriminación de colores, no debe realizar actividades donde diferenciar colores sea importante para la seguridad, como conducción, labores eléctricas, operación de maquinaria pesada o manipulación de explosivos",
    );
  }

  if (text.includes("RUIDO POR ENCIMA DE LOS LIMITES MAXIMOS PERMITIDOS")) {
    pushUnique(items, "no debe exponerse a ruido por encima de los límites máximos permitidos sin protección auditiva");
  }

  if (text.includes("VIGILANCIA") && text.includes("MEDICO OCUPACIONAL")) {
    pushUnique(items, "seguimiento por el médico ocupacional de la empresa");
  }

  return items;
}

function normalizeVascular(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];
  if (text.includes("BIPEDESTACION PROLONGADA")) {
    pushUnique(items, "evitar permanecer de pie por periodos prolongados");
    pushUnique(items, "realizar pausas pasivas durante la jornada");
  }
  return items;
}

function normalizeAllergy(group) {
  const text = normalizeClinicalComparable(getGroupText(group));
  const items = [];
  if (text.includes("MEDICAMENTO ALERGENO")) {
    pushUnique(items, "evitar el uso del medicamento alérgeno registrado");
    pushUnique(items, "informar este antecedente antes de recibir atención médica o tratamiento");
  }
  return items;
}

export function normalizeRecommendationsForArea(area, group) {
  const text = normalizeClinicalComparable(getGroupText(group));

  switch (area) {
    case "metabolico":
      return normalizeMetabolic(group);
    case "oftalmologia":
      return normalizeOphthalmology(group);
    case "audiometria":
      return normalizeAudiometry(group);
    case "dermatologia":
      return normalizeDermatology(group);
    case "ocupacional":
      return normalizeOccupational(group);
    case "cardiologia":
      return normalizeSimpleSpecialty(group, "cardiología");
    case "medicina_interna":
      return normalizeSimpleSpecialty(group, "medicina interna");
    case "traumatologia":
      return normalizeSimpleSpecialty(group, "traumatología", {
        defaultText: "evaluación o control por traumatología",
      });
    case "neumologia":
      return normalizeSimpleSpecialty(group, "neumología");
    case "gastroenterologia":
      return normalizeSimpleSpecialty(group, "gastroenterología");
    case "ginecologia":
      return normalizeSimpleSpecialty(group, "ginecología", {
        defaultText: "evaluación o control por ginecología",
      });
    case "psicologia":
      if (text.includes("PSICOLOGIA CLINICA")) {
        return ["control por psicología clínica", "seguimiento por el médico ocupacional de la empresa"];
      }
      return normalizeSimpleSpecialty(group, "psicología clínica");
    case "alergias":
      return normalizeAllergy(group);
    case "vascular":
      return normalizeVascular(group);
    default:
      return [];
  }
}

export function normalizeRestrictionItems(value) {
  const text = normalizeClinicalRecommendationText(value)
    .replace(/\s*;\s*/g, ". ")
    .replace(/^-+\s*/g, "");

  return text
    .split(/\.\s+-\s+|\.\s+|(?:\s+-\s+)/g)
    .map((item) => item.replace(/^-+\s*/g, "").replace(/^restricción\s*:?\s*/i, "").trim())
    .filter(Boolean)
    .map((item) => sentenceCase(item));
}
