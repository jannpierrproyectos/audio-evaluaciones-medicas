import {
  classifyMetabolicAnalyte,
  evaluateMetabolicSourceStatement,
} from "../data/metabolicReference.js";

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

function classifyHemoglobinFromSource(laboratorio = {}, sexValue = "") {
  const value = toNumberOrNull(laboratorio.hemoglobina_valor);
  const sex = normalizeComparable(sexValue);
  const male = ["M", "MASCULINO", "HOMBRE"].includes(sex);
  const female = ["F", "FEMENINO", "MUJER"].includes(sex);
  const selectedSex = male ? "masculino" : female ? "femenino" : "";
  const min = selectedSex
    ? toNumberOrNull(laboratorio[`hemoglobina_rango_${selectedSex}_min`])
    : null;
  const max = selectedSex
    ? toNumberOrNull(laboratorio[`hemoglobina_rango_${selectedSex}_max`])
    : null;
  const ambiguous = Boolean(laboratorio.hemoglobina_rango_ambiguo) || (!selectedSex && value !== null);
  const hasRange = min !== null && max !== null && min <= max;
  let status = "";

  if (value !== null && hasRange && !ambiguous) {
    status = value < min ? "LOW" : value > max ? "HIGH" : "NORMAL";
  }

  return {
    value,
    unit: getString(laboratorio.hemoglobina_unidad),
    sex: selectedSex,
    range: hasRange ? { min, max } : null,
    status,
    ambiguous,
    missingRange: value !== null && !ambiguous && !hasRange,
    sourceFields: selectedSex
      ? [
          "laboratorio_numerico.hemoglobina_valor",
          "laboratorio_numerico.hemoglobina_unidad",
          `laboratorio_numerico.hemoglobina_rango_${selectedSex}_min`,
          `laboratorio_numerico.hemoglobina_rango_${selectedSex}_max`,
          "identificacion.sexo",
        ]
      : ["laboratorio_numerico.hemoglobina_valor", "identificacion.sexo"],
  };
}

function uniqueRecommendationSources(recommendations = []) {
  const bySource = new Map();
  recommendations.forEach((item) => {
    const key = `${item.item}|${normalizeComparable(item.texto_original)}`;
    if (!bySource.has(key)) bySource.set(key, item);
  });
  return [...bySource.values()];
}

function deriveEcgPolicy(evaluaciones = {}, recommendations = []) {
  const value = getString(evaluaciones.ecg_resultado);
  const cardiologyRecommendations = uniqueRecommendationSources(
    recommendations.filter((item) => item.area === "cardiologia"),
  );
  const other = normalizeComparable(evaluaciones.otros_hallazgos_resultado);
  const competingCardiacFinding = /HIPERTENSION|CARDIOPAT|ARRITM|TAQUICARD/.test(other);
  const present = Boolean(value);
  const safeAssociation = present && cardiologyRecommendations.length === 1 && !competingCardiacFinding;
  const ambiguousAssociation = present && cardiologyRecommendations.length > 0 && !safeAssociation;

  return {
    present,
    value,
    recommendationCount: cardiologyRecommendations.length,
    cardiologyRecommendations,
    safeAssociation,
    ambiguousAssociation,
    deliberatelyNotNarrated: present && cardiologyRecommendations.length === 0,
    competingCardiacFinding,
  };
}

function hasAmbiguousOtherStructure(value) {
  return /(?:RINITIS ALERGICA.*EOSINOFILIA|INSUFICIENCIA VENOSA.*(?:EOSINOFILIA|HIPERCOLESTEROLEMIA|HIPERTENSION|ANEMIA)|ALERGIA A LA CEFTRIAXONA.*INSUFICIENCIA VENOSA|MIGRANA.*INSUFICIENCIA VENOSA|MICOSIS.*ANEMIA|HIPERCOLESTEROLEMIA DEFINIDA.*LEUCOPENIA|FARINGITIS AGUDA.*HIPERQUERATOSIS.*LEUCOCITOSIS|DESCARTAR ONICOMICOSIS.*INSUFICIENCIA VENOSA)/.test(normalizeComparable(value));
}

function hasExplicitOphthalmologyFinding(value) {
  return /(?:PRESBICIA|AMETROPIA|PTERIGION|VISION|DISCROMATOPSIA|PTOSIS)/.test(
    normalizeComparable(value),
  );
}

function getStructuredOtherFindingItems(evaluaciones = {}) {
  return Array.isArray(evaluaciones.otros_hallazgos_items)
    ? evaluaciones.otros_hallazgos_items.filter((item) => getString(item?.text))
    : [];
}

function hasStructuredOtherSeparation(evaluaciones = {}) {
  return getStructuredOtherFindingItems(evaluaciones).length > 1;
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
  ruleId = "",
  recommendationAreas = [],
  recommendationCandidate = true,
  sourceItem = null,
  sourceClassificationStatus = "",
  sourceClassificationReason = "",
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
    rule_id: ruleId,
    recommendation_areas: recommendationAreas,
    recommendation_candidate: recommendationCandidate,
    source_page: sourceItem?.page ?? null,
    source_position: sourceItem
      ? { x: sourceItem.x, y: sourceItem.y, width: sourceItem.width, height: sourceItem.height }
      : null,
    source_line: sourceItem?.text || "",
    source_items: sourceItem?.textItems || [],
    source_classification_status: sourceClassificationStatus,
    source_classification_reason: sourceClassificationReason,
  };
}

function createLabItem({
  field,
  label,
  value,
  tipo,
  status,
  severidad,
  area = "metabolico",
  classification = null,
  unit = "",
  reference = null,
  sourceValue = "",
  recommendationCandidate = true,
  ruleId = "",
}) {
  return {
    area,
    field,
    label,
    value,
    tipo,
    status,
    severidad,
    narrar: true,
    classification,
    unit,
    reference,
    sourceValue,
    recommendation_candidate: recommendationCandidate,
    rule_id: ruleId,
  };
}

function addLabFinding(laboratorioRelevante, hallazgosRelevantes, item) {
  laboratorioRelevante.push(item);
}

function deriveLaboratory(laboratorio = {}) {
  const laboratorioRelevante = [];
  const hallazgosRelevantes = [];

  const classificationText = {
    glucosa: { LOW: "por debajo del rango", NORMAL: "dentro del rango", HIGH: "por encima del rango" },
    colesterol: { NORMAL: "normal", BORDERLINE_HIGH: "limite alto", HIGH: "alto" },
    trigliceridos: { NORMAL: "normales", BORDERLINE_HIGH: "limite alto", HIGH: "altos", VERY_HIGH: "muy altos" },
  };
  [
    ["glucosa", "Glucosa"],
    ["trigliceridos", "Trigliceridos"],
    ["colesterol", "Colesterol"],
  ].forEach(([analyte, label]) => {
    const classified = classifyMetabolicAnalyte(analyte, laboratorio);
    if (!classified.resolved) return;
    const status = classificationText[analyte]?.[classified.classification];
    if (!status) return;
    addLabFinding(
      laboratorioRelevante,
      hallazgosRelevantes,
      createLabItem({
        field: `laboratorio_numerico.${analyte}_valor`,
        label,
        value: classified.value,
        tipo: classified.classification === "NORMAL" ? "normal_relevante" : "alteracion",
        status,
        severidad: classified.classification === "NORMAL" ? "info" : "warning",
        classification: classified.classification,
        unit: classified.unit,
        reference: classified.reference,
        sourceValue: classified.sourceValue,
        recommendationCandidate: classified.classification !== "NORMAL",
        ruleId: `${analyte}_source_reference_classification`,
      }),
    );
  });

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
      ruleId: options.ruleId || "",
      recommendationAreas: options.recommendationAreas || [],
    }),
  );
}

function pickOnychomycosisFindings(value) {
  const result = getString(value);
  const matches = [
    ...result.matchAll(
      /(?:(DESCARTAR|SOSPECHA\s+DE|COMPATIBLE\s+CON)\s+)?ONICOMICOSIS(?:\s+(PEDIA|MANO))?(?:\s+(BILATERAL|IZQUIERDA|DERECHA))?/gi,
    ),
  ];

  return Array.from(new Set(matches.map((match) => {
    const certainty = normalizeComparable(match[1]);
    const anatomy = normalizeComparable(match[2]);
    const side = normalizeComparable(match[3]);
    const location = anatomy === "PEDIA"
      ? side === "IZQUIERDA"
        ? "en el pie izquierdo"
        : side === "DERECHA"
          ? "en el pie derecho"
          : side === "BILATERAL"
            ? "en ambos pies"
            : "en los pies"
      : anatomy === "MANO"
        ? side === "IZQUIERDA"
          ? "en la mano izquierda"
          : side === "DERECHA"
            ? "en la mano derecha"
            : side === "BILATERAL"
              ? "en ambas manos"
              : "en la mano"
        : "";
    const prefix = certainty === "DESCARTAR"
      ? "descartar "
      : certainty === "SOSPECHA DE"
        ? "sospecha de "
        : certainty === "COMPATIBLE CON"
          ? "compatible con "
          : "";
    return `${prefix}onicomicosis${location ? ` ${location}` : ""}`;
  })));
}

function pickRecognizedOtherSegments(result, comparable, options = {}) {
  const findings = [];
  const metabolicSource = options.metabolicSourceEvaluation || null;

  if (metabolicSource) {
    findings.push(createFinding({
      area: "metabolico",
      tipo: "source_statement",
      resultado: result,
      severidad: metabolicSource.status === "DISCREPANT" ? "warning" : "info",
      narrar: metabolicSource.status !== "EXACT_EQUIVALENT",
      field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
      source: "otros_hallazgos_resultado",
      ruleId: metabolicSource.status === "EXACT_EQUIVALENT"
        ? "metabolic_source_equivalent_suppressed"
        : metabolicSource.status === "DISCREPANT"
          ? "metabolic_source_classification_conflict"
          : "metabolic_source_information_preserved",
      recommendationCandidate: false,
      sourceItem: options.sourceItem,
      sourceClassificationStatus: metabolicSource.status,
      sourceClassificationReason: metabolicSource.reason,
    }));
  }

  pickOnychomycosisFindings(result).forEach((onychomycosisFinding) => {
    findings.push(
      createFinding({
        area: "dermatologia",
        tipo: "alteracion",
        resultado: onychomycosisFinding,
        severidad: "warning",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
        ruleId: "dermatology_source_certainty_preserved",
        recommendationAreas: ["dermatologia"],
        sourceItem: options.sourceItem,
      }),
    );
  });

  const safeLiteralPatterns = [
    {
      pattern: /INSUFICIENCIA\s+VENOSA(?:\s+PERIF[EÉ]RICA)?(?:\s+I[°º])?(?:\s+(?:BILATERAL|IZQUIERDA|DERECHA))?/gi,
      area: "vascular",
      ruleId: "safe_other_finding_vascular",
      recommendationAreas: ["vascular"],
    },
    {
      pattern: /PIE\s+(?:CAVO|PLANO)(?:\s+(?:BILATERAL|IZQUIERDO|IZQUIERDA|DERECHO|DERECHA))?/gi,
      area: "traumatologia",
      ruleId: "safe_other_finding_traumatology",
      recommendationAreas: ["traumatologia"],
    },
    {
      pattern: /ALERGIA\s+A\s+(?:LA|LAS|LOS|EL)\s+[A-ZÃÃ‰ÃÃ“ÃšÃ‘]+/gi,
      area: "alergias",
      ruleId: "safe_other_finding_allergy",
      recommendationAreas: ["alergias"],
    },
    {
      pattern: /(?:DESCARTAR\s+|SOSPECHA\s+DE\s+|COMPATIBLE\s+CON\s+)?\b(?:MICOSIS|HIPERQUERATOSIS|ONICODISTROFIA|DERMATITIS)(?:\s+(?:PEDIA|MANO|EN\s+TRATAMIENTO|BILATERAL|IZQUIERDA|DERECHA))*/gi,
      area: "dermatologia",
      ruleId: "dermatology_source_certainty_preserved",
      recommendationAreas: ["dermatologia"],
    },
  ];

  safeLiteralPatterns.forEach((config) => {
    [...result.matchAll(config.pattern)].forEach((match) => {
      findings.push(createFinding({
        area: config.area,
        tipo: "alteracion",
        resultado: getString(match[0]),
        severidad: "warning",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
        ruleId: config.ruleId,
        recommendationAreas: config.recommendationAreas,
        sourceItem: options.sourceItem,
      }));
    });
  });

  const neutralSourcePatterns = [
    {
      pattern: /^EOSINOFILIA\s*:\s*DESCARTAR\s+PARASITOSIS\s+Y\s*\/\s*O\s+ALERGIAS\.?$/gi,
      area: "otros",
      ruleId: "safe_neutral_source_eosinophilia",
      recommendationAreas: [],
    },
    {
      pattern: /^FARINGITIS\.?$/gi,
      area: "otros",
      ruleId: "safe_neutral_source_faringitis",
      recommendationAreas: [],
    },
    {
      pattern: /^LEUCOPENIA\.?$/gi,
      area: "otros",
      ruleId: "safe_neutral_source_leucopenia",
      recommendationAreas: [],
    },
    {
      pattern: /^LIPOMATOSIS\s+EN\s+MANO\s+DERECHA\.?$/gi,
      area: "otros",
      ruleId: "safe_neutral_source_lipomatosis",
      recommendationAreas: [],
    },
    {
      pattern: /^QUEMADURA\s+DE\s+TERCER\s+GRADO(?:\s+EN\s+EL\s+MUSLO\s+DERECHO)?\.?$/gi,
      area: "dermatologia",
      ruleId: "safe_neutral_source_burn",
      recommendationAreas: ["dermatologia"],
    },
  ];

  neutralSourcePatterns.forEach((config) => {
    [...result.matchAll(config.pattern)].forEach((match) => {
      findings.push(createFinding({
        area: config.area,
        tipo: "source_statement",
        resultado: getString(match[0]),
        severidad: "info",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
        ruleId: config.ruleId,
        recommendationAreas: config.recommendationAreas,
        sourceItem: options.sourceItem,
      }));
    });
  });

  const safeNeutralComparablePatterns = new Map([
    ["HEPATOMEGALIA", "hepatomegaly"],
    ["RINITIS ALERGICA EN TRATAMIENTO", "allergic_rhinitis_treatment"],
    ["HIPERTENSION ARTERIAL CONTROLADA", "controlled_hypertension"],
    ["ANEMIA", "anemia"],
    ["LEUCOCITOSIS", "leukocytosis"],
    ["MIGRANA POR ANTECEDENTE", "migraine_history"],
    ["ESTEATOSIS HEPATICA", "hepatic_steatosis"],
    ["DIABETES MELLITUS CONTROLADA", "controlled_diabetes"],
    ["LEUCOCITURIA", "leukocyturia"],
    ["TROMBOCITOSIS", "thrombocytosis"],
    ["FARINGITIS AGUDA", "acute_pharyngitis"],
    ["LEUCOPENIA LEVE SIN REPERCUSION HEMATOLOGICA MAYOR", "extended_leukopenia"],
  ]);
  const safeNeutralComparableId = safeNeutralComparablePatterns.get(comparable.replace(/\.$/, ""));
  if (safeNeutralComparableId) {
    findings.push(createFinding({
      area: "otros",
      tipo: "source_statement",
      resultado: result,
      severidad: "info",
      field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
      source: "otros_hallazgos_resultado",
      ruleId: `safe_neutral_source_${safeNeutralComparableId}`,
      recommendationAreas: [],
      sourceItem: options.sourceItem,
    }));
  }

  if (!metabolicSource && comparable.includes("HIPERTRIGLICERIDEMIA")) {
    findings.push(
      createFinding({
        area: "metabolico",
        tipo: "alteracion",
        resultado: "hipertrigliceridemia",
        severidad: "warning",
        narrar: !options.hasTriglyceridesLabFinding,
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
        sourceItem: options.sourceItem,
      }),
    );
  }

  if (!metabolicSource && comparable.includes("HIPERGLICEMIA")) {
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
        sourceItem: options.sourceItem,
      }),
    );
  }

  if (!metabolicSource && comparable.includes("HIPERLIPIDEMIA MIXTA")) {
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
        sourceItem: options.sourceItem,
      }),
    );
  }

  const unrecognizedSegments = (safeNeutralComparableId ? "" : result)
    .replace(/(?:(?:DESCARTAR|SOSPECHA\s+DE|COMPATIBLE\s+CON)\s+)?ONICOMICOSIS(?:\s+(?:PEDIA|MANO))?(?:\s+(?:BILATERAL|IZQUIERDA|DERECHA))?/gi, "")
    .replace(/INSUFICIENCIA\s+VENOSA(?:\s+PERIF[EÉ]RICA)?(?:\s+I[°º])?(?:\s+(?:BILATERAL|IZQUIERDA|DERECHA))?/gi, "")
    .replace(/PIE\s+(?:CAVO|PLANO)(?:\s+(?:BILATERAL|IZQUIERDO|IZQUIERDA|DERECHO|DERECHA))?/gi, "")
    .replace(/ALERGIA\s+A\s+(?:LA|LAS|LOS|EL)\s+[A-ZÃÃ‰ÃÃ“ÃšÃ‘]+/gi, "")
    .replace(/(?:DESCARTAR\s+|SOSPECHA\s+DE\s+|COMPATIBLE\s+CON\s+)?\b(?:MICOSIS|HIPERQUERATOSIS|ONICODISTROFIA|DERMATITIS)(?:\s+(?:PEDIA|MANO|EN\s+TRATAMIENTO|BILATERAL|IZQUIERDA|DERECHA))*/gi, "")
    .replace(/HIPERTRIGLICERIDEMIA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
    .replace(/HIPERGLICEMIA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
    .replace(/HIPERLIPIDEMIA\s+MIXTA(?:\s+EN\s+TRATAMIENTO)?/gi, "")
    .replace(/^HIPERCOLESTEROLEMIA\s+(?:LIMITE\s+ALTO|DEFINIDA)\.?$/gi, metabolicSource ? "" : "$&")
    .replace(/^EOSINOFILIA\s*:\s*DESCARTAR\s+PARASITOSIS\s+Y\s*\/\s*O\s+ALERGIAS\.?$/gi, "")
    .replace(/^FARINGITIS\.?$/gi, "")
    .replace(/^LEUCOPENIA\.?$/gi, "")
    .replace(/^LIPOMATOSIS\s+EN\s+MANO\s+DERECHA\.?$/gi, "")
    .replace(/^QUEMADURA\s+DE\s+TERCER\s+GRADO(?:\s+EN\s+EL\s+MUSLO\s+DERECHO)?\.?$/gi, "")
    .replace(/^(?:HEPATOMEGALIA|RINITIS ALERGICA EN TRATAMIENTO|HIPERTENSION ARTERIAL CONTROLADA|ANEMIA|LEUCOCITOSIS|MIGRANA POR ANTECEDENTE|ESTEATOSIS HEPATICA|DIABETES MELLITUS CONTROLADA|LEUCOCITURIA|TROMBOCITOSIS|FARINGITIS AGUDA|LEUCOPENIA LEVE SIN REPERCUSION HEMATOLOGICA MAYOR)\.?$/gi, "")
    .split(/\s*(?:;|•|\.\s+-\s+|(?:^|\s)\d+(?:\s*[,Y]\s*\d+)*\.\s*)\s*/gi)
    .map((segment) => getString(segment?.replace(/^[,.-]+|[,.-]+$/g, "")))
    .filter(Boolean);

  unrecognizedSegments.forEach((unrecognizedText) => {
    findings.push(
      createFinding({
        area: "otros",
        tipo: "otro",
        resultado: unrecognizedText,
        severidad: "info",
        field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
        source: "otros_hallazgos_resultado",
        sourceItem: options.sourceItem,
      }),
    );
  });

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
        sourceItem: options.sourceItem,
      }),
    );
  }

  return findings;
}

function deriveQualitativeFindings(evaluaciones = {}, options = {}) {
  const findings = [];
  const normales = [];

  addFindingIfRelevant(findings, evaluaciones.oftalmologia_resultado, "oftalmologia", "oftalmologia_resultado", {
    matches: hasExplicitOphthalmologyFinding,
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
    options.ecgSafeAssociation
  ) {
    addFindingIfRelevant(findings, evaluaciones.ecg_resultado, "cardiologia", "ecg_resultado", {
      ruleId: "ecg_with_explicit_cardiology_recommendation",
      matches: () => true,
    });
  }

  addFindingIfRelevant(findings, evaluaciones.espirometria_resultado, "espirometria", "espirometria_resultado");
  addFindingIfRelevant(
    findings,
    evaluaciones.radiografia_torax_resultado,
    "radiografia_torax",
    "radiografia_torax_resultado",
  );
  if (options.traumatologySourceAssociation) {
    addFindingIfRelevant(
      findings,
      evaluaciones.musculoesqueletico_resultado,
      "traumatologia",
      "musculoesqueletico_resultado",
      {
        matches: (value) =>
          !isNormalResult(value) &&
          !/(?:BUEN ESTADO|ADECUADO|CONSERVADO)/.test(value),
        ruleId: "structural_musculoskeletal_traumatology_association",
        recommendationAreas: ["traumatologia"],
      },
    );
  } else {
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
  }

  const structuredOtherItems = getStructuredOtherFindingItems(evaluaciones);
  if (structuredOtherItems.length) {
    structuredOtherItems.forEach((item) => {
      findings.push(...deriveOtherFindings(item.text, {
        ...options,
        sourceItem: item,
        metabolicSourceEvaluation: evaluateMetabolicSourceStatement(item.text, options.laboratory || {}),
      }));
    });
  } else {
    findings.push(...deriveOtherFindings(evaluaciones.otros_hallazgos_resultado, {
      ...options,
      metabolicSourceEvaluation: evaluateMetabolicSourceStatement(
        evaluaciones.otros_hallazgos_resultado,
        options.laboratory || {},
      ),
    }));
  }

  [
    ["examen_orina_resultado", "orina"],
    ["informe_psicologico_resultado", "psicologico"],
    ["espirometria_resultado", "espirometria"],
    ["radiografia_torax_resultado", "radiografia_torax"],
    ["audiometria_resultado", "audiometria"],
    ["oftalmologia_resultado", "oftalmologia"],
  ].forEach(([field, area]) => {
    const value = getString(evaluaciones[field]);
    const containsExplicitFinding =
      field === "oftalmologia_resultado" && hasExplicitOphthalmologyFinding(value);
    if (value && isNormalResult(value) && !containsExplicitFinding) {
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
  const group = () => ({
    narrar: false,
    hallazgos: [],
    recomendaciones: [],
    association_status: "NONE",
    association_reason: "",
    association_scope: "",
    suppress_standalone: false,
  });
  return {
    metabolico: group(), oftalmologia: group(), audiometria: group(), dermatologia: group(),
    medicina_interna: group(), musculoesqueletico: group(), espirometria: group(),
    neumologia: group(), radiografia_torax: group(), cardiologia: group(), traumatologia: group(),
    gastroenterologia: group(), ginecologia: group(), psicologia: group(), alergias: group(),
    vascular: group(), hemograma: group(), ocupacional: group(), otros: group(),
  };
}

function addGroupFinding(groups, finding) {
  const area = groups[finding.area] ? finding.area : "otros";
  groups[area].hallazgos.push(finding);
  groups[area].narrar = groups[area].narrar || Boolean(finding.narrar);
}

function applyRecommendationAssociations(groups, {
  anthropometryIsRelevant = false,
  ecgPolicy = {},
  ambiguousOtherStructure = false,
  pendingStructuredMetabolicMapping = false,
} = {}) {
  const pneumology = groups.neumologia;
  if (pneumology.recomendaciones.length === 1 && pneumology.hallazgos.length === 0) {
    const crossAreaCandidates = [groups.espirometria, groups.radiografia_torax]
      .flatMap((group) => group.hallazgos.filter((finding) => finding.narrar !== false));
    if (crossAreaCandidates.length === 1) {
      const candidate = crossAreaCandidates[0];
      const sourceGroup = groups[candidate.area];
      sourceGroup.hallazgos = sourceGroup.hallazgos.filter((finding) => finding !== candidate);
      sourceGroup.narrar = sourceGroup.hallazgos.some((finding) => finding.narrar !== false) || sourceGroup.recomendaciones.length > 0;
      pneumology.hallazgos.push({ ...candidate, association_source_area: candidate.area });
    }
  }

  Object.entries(groups).forEach(([area, group]) => {
    if (!group.recomendaciones.length) return;
    const associationFindings = area === "metabolico"
      ? group.hallazgos.filter((finding) => finding.recommendation_candidate !== false)
      : group.hallazgos;
    const sourceRecommendations = uniqueRecommendationSources(group.recomendaciones);
    const isGeneral = area === "otros" && group.recomendaciones.every((item) => item.matched_keywords.length === 0);
    if (isGeneral) {
      group.association_status = "GENERAL_RECOMMENDATION";
      group.association_reason = "La fuente presenta una recomendación general sin hallazgo clínico único.";
      return;
    }

    if (area === "cardiologia" && ecgPolicy.ambiguousAssociation) {
      group.association_status = "AMBIGUOUS_ASSOCIATION";
      group.association_reason = "La recomendación cardiológica compite con otro posible hallazgo cardiovascular.";
      group.hallazgos = [];
      return;
    }

    if (
      area === "metabolico" &&
      pendingStructuredMetabolicMapping &&
      group.hallazgos.some((finding) => finding.source === "otros_hallazgos_resultado")
    ) {
      group.association_status = "AMBIGUOUS_ASSOCIATION";
      group.association_reason = "La separación PDF recupera el hallazgo metabólico, pero su asociación requiere la política clínica pendiente.";
      return;
    }

    if (
      ambiguousOtherStructure &&
      group.hallazgos.some((finding) => finding.field === "evaluaciones_cualitativas.otros_hallazgos_resultado")
    ) {
      group.association_status = "AMBIGUOUS_ASSOCIATION";
      group.association_reason = "El bloque fuente contiene varios hallazgos sin delimitación inequívoca.";
      return;
    }

    const hasExplicitJointBlock =
      area === "metabolico" &&
      sourceRecommendations.length === 1 &&
      associationFindings.length > 1 &&
      /(?:BLOQUE|ANALISIS|RESULTADOS) METABOLIC/.test(
        normalizeComparable(sourceRecommendations[0].texto_original),
      );
    if (
      sourceRecommendations.length === 1 &&
      (associationFindings.length === 1 || hasExplicitJointBlock)
    ) {
      group.association_status = "SAFE_ASSOCIATION";
      group.association_scope = hasExplicitJointBlock ? "BLOCK" : "FINDING";
      group.association_reason = hasExplicitJointBlock
        ? "El texto fuente identifica explícitamente una recomendación conjunta para el bloque metabólico."
        : "Un único bloque fuente de recomendación coincide con un único hallazgo estructurado del área.";
      return;
    }

    if (associationFindings.length || sourceRecommendations.length > 1) {
      group.association_status = "AMBIGUOUS_ASSOCIATION";
      group.association_reason = "La estructura contiene múltiples candidatos y no demuestra una relación uno a uno.";
      return;
    }

    if (area === "metabolico" && anthropometryIsRelevant) {
      group.association_status = "SAFE_ASSOCIATION";
      group.association_reason = "La recomendación metabólica se vincula al único estado antropométrico narrado.";
      group.suppress_standalone = true;
      return;
    }

    const recommendationText = normalizeComparable(group.recomendaciones.map((item) => item.texto_original).join(" "));
    const ophthalmologyText = normalizeComparable(groups.oftalmologia.hallazgos.map((item) => item.resultado).join(" "));
    const sourceRecommendationKeys = new Set(
      group.recomendaciones.map((item) => normalizeComparable(item.texto_original)),
    );
    const structurallyLinkedArea = area === "ocupacional"
      ? ["oftalmologia", "audiometria"].find((candidateArea) => {
          const candidate = groups[candidateArea];
          return candidate.hallazgos.length > 0 && candidate.recomendaciones.some(
            (item) => sourceRecommendationKeys.has(normalizeComparable(item.texto_original)),
          );
        })
      : "";
    if (structurallyLinkedArea) {
      group.association_status = "SAFE_ASSOCIATION";
      group.association_reason = `La misma recomendación fuente ya está vinculada al hallazgo estructurado de ${structurallyLinkedArea}.`;
      group.suppress_standalone = true;
      return;
    }
    const safeOccupationalLink = area === "ocupacional" && (
      (/DISCRIMINAR COLORES|DIFERENCIACION DE COLORES/.test(recommendationText) && ophthalmologyText.includes("DISCROMATOPSIA")) ||
      (/ALTURA/.test(recommendationText) && ophthalmologyText.includes("VISION ESTEREOSCOPICA"))
    );
    if (safeOccupationalLink) {
      group.association_status = "SAFE_ASSOCIATION";
      group.association_reason = "La restricción y el hallazgo oftalmológico comparten una condición estructural explícita.";
      return;
    }

    group.association_status = "NO_RELATED_FINDING";
    group.association_reason = "No existe un hallazgo estructurado inequívocamente relacionado.";
  });
}

function buildNarrativeGroups({
  hallazgosRelevantes,
  laboratorioRelevante,
  recomendacionesPorArea,
  anthropometryIsRelevant,
  ecgPolicy,
  ambiguousOtherStructure,
  pendingStructuredMetabolicMapping,
}) {
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
    const added = groups[item.area]?.hallazgos.at(-1);
    if (added) {
      added.reference_classification = item.classification;
      added.unit = item.unit;
      added.value = item.value;
      added.source_value = item.sourceValue;
      added.reference = item.reference;
      added.recommendation_candidate = item.recommendation_candidate;
      added.rule_id = item.rule_id;
      added.source_page = item.reference?.page ?? null;
      added.source_position = item.reference?.position ?? null;
      added.source_line = item.reference?.rawText || "";
      added.source_items = item.reference?.textItems || [];
    }
  });

  hallazgosRelevantes.forEach((finding) => addGroupFinding(groups, finding));

  recomendacionesPorArea.forEach((recommendation) => {
    const area = groups[recommendation.area] ? recommendation.area : "otros";
    groups[area].recomendaciones.push(recommendation);
    groups[area].narrar = true;
  });

  applyRecommendationAssociations(groups, {
    anthropometryIsRelevant,
    ecgPolicy,
    ambiguousOtherStructure,
    pendingStructuredMetabolicMapping,
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
  const hemoglobin = classifyHemoglobinFromSource(laboratorio, identificacion.sexo);
  const hemoglobinaValor = hemoglobin.value;
  const hemoglobinaUnidad = hemoglobin.unit;
  const glucosaValor = toNumberOrNull(laboratorio.glucosa_valor);
  const trigliceridosValor = toNumberOrNull(laboratorio.trigliceridos_valor);
  const colesterolValor = toNumberOrNull(laboratorio.colesterol_valor);
  const leucocitosValor = toNumberOrNull(laboratorio.leucocitos_valor);
  const plaquetasValor = toNumberOrNull(laboratorio.plaquetas_valor);

  const laboratory = deriveLaboratory(laboratorio);
  const hasTriglyceridesLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.trigliceridos_valor" && item.classification !== "NORMAL",
  );
  const hasCholesterolLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.colesterol_valor" && item.classification !== "NORMAL",
  );
  const hasGlucoseLabFinding = laboratory.laboratorioRelevante.some(
    (item) => item.field === "laboratorio_numerico.glucosa_valor" && item.classification !== "NORMAL",
  );
  const recomendacionesPorArea = classifyRecommendations(
    aptitudData.recomendaciones_generales_texto,
  );
  const traumatologyRecommendations = uniqueRecommendationSources(
    recomendacionesPorArea.filter((item) => item.area === "traumatologia"),
  );
  const ecgPolicy = deriveEcgPolicy(evaluaciones, recomendacionesPorArea);
  const qualitative = deriveQualitativeFindings(evaluaciones, {
    laboratory: laboratorio,
    hasTriglyceridesLabFinding,
    hasCholesterolLabFinding,
    hasGlucoseLabFinding,
    cholesterolLabClassification: laboratory.laboratorioRelevante.find(
      (item) => item.field === "laboratorio_numerico.colesterol_valor",
    )?.classification || null,
    ecgSafeAssociation: ecgPolicy.safeAssociation,
    traumatologySourceAssociation:
      traumatologyRecommendations.length === 1 &&
      hasNarrableValue(evaluaciones.musculoesqueletico_resultado),
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
    anthropometryIsRelevant,
    ecgPolicy,
    ambiguousOtherStructure:
      hasAmbiguousOtherStructure(evaluaciones.otros_hallazgos_resultado) &&
      !hasStructuredOtherSeparation(evaluaciones),
    pendingStructuredMetabolicMapping:
      hasStructuredOtherSeparation(evaluaciones) &&
      hasAmbiguousOtherStructure(evaluaciones.otros_hallazgos_resultado),
  });
  const policyFlags = [];
  if (ecgPolicy.deliberatelyNotNarrated) {
    policyFlags.push({
      type: "ecg_not_narrated_no_cardiology_recommendation",
      sourceField: "evaluaciones_cualitativas.ecg_resultado",
      message: "El ECG se omite deliberadamente porque no existe recomendación explícita de cardiología.",
      confidence: "automatic",
    });
  }
  if (ecgPolicy.ambiguousAssociation) {
    policyFlags.push({
      type: "ecg_cardiology_association_ambiguous",
      sourceField: "evaluaciones_cualitativas.ecg_resultado",
      message: "Existe recomendación cardiológica, pero varios hallazgos podrían motivarla.",
      confidence: "review_recommended",
    });
  }

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
      hemoglobina_unidad: hemoglobinaUnidad,
      hemoglobina_rango_seleccionado: hemoglobin.range,
      hemoglobina_estado: hemoglobin.status,
      hemoglobina_sexo_rango: hemoglobin.sex,
      hemoglobina_rango_ambiguo: hemoglobin.ambiguous,
      hemoglobina_rango_faltante: hemoglobin.missingRange,
      hemoglobina_source_fields: hemoglobin.sourceFields,
      glucosa_valor: glucosaValor,
      glucosa_unidad: laboratorio.glucosa_unidad || "",
      glucosa_referencia: laboratorio.glucosa_referencia || null,
      trigliceridos_valor: trigliceridosValor,
      trigliceridos_unidad: laboratorio.trigliceridos_unidad || "",
      trigliceridos_referencia: laboratorio.trigliceridos_referencia || null,
      colesterol_valor: colesterolValor,
      colesterol_unidad: laboratorio.colesterol_unidad || "",
      colesterol_referencia: laboratorio.colesterol_referencia || null,
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
        classification: item.classification,
        unit: item.unit,
        reference: item.reference,
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
    has_omitted_findings: false,
    policy_flags: policyFlags,
    ecg_policy: ecgPolicy,
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
      otros_hallazgos: getStructuredOtherFindingItems(evaluaciones).length
        ? "evaluaciones_cualitativas.otros_hallazgos_items"
        : "evaluaciones_cualitativas.otros_hallazgos_resultado",
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
