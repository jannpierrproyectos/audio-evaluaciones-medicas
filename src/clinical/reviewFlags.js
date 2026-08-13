function comparable(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

const CONFLICT_RULES = [
  {
    field: "evaluaciones_cualitativas.audiometria_resultado",
    normal: ["NORMAL", "NORMOACUSIA", "CONSERVADA"],
    abnormal: ["HIPOACUSIA", "PERDIDA AUDITIVA", "ALTERADA"],
  },
  {
    field: "evaluaciones_cualitativas.oftalmologia_resultado",
    normal: ["NORMAL", "CONSERVADA", "SIN ALTERACIONES"],
    abnormal: ["AMETROPIA", "DISMINUCION", "ALTERADA"],
  },
  {
    field: "evaluaciones_cualitativas.espirometria_resultado",
    normal: ["NORMAL", "SIN ALTERACIONES"],
    abnormal: ["RESTRICTIVO", "OBSTRUCTIVO", "ALTERADA"],
  },
];

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function createFlag(type, sourceField, message, confidence = "review_recommended") {
  return { type, sourceField, message, confidence };
}

export function collectReviewFlags(worker = {}, normalizationTrace = []) {
  const flags = [];

  CONFLICT_RULES.forEach((rule) => {
    const text = comparable(getPath(worker, rule.field));
    if (!text) return;
    const hasNormal = rule.normal.some((term) => text.includes(term));
    const hasAbnormal = rule.abnormal.some((term) => text.includes(term));
    if (hasNormal && hasAbnormal) {
      flags.push(createFlag(
        "conflicting_values",
        rule.field,
        "Se detectaron interpretaciones normal y anormal incompatibles. Revisar este resultado.",
      ));
    }
  });

  (worker.validation?.warnings || []).forEach((warning) => {
    flags.push(createFlag(
      warning.severity === "error" ? "ambiguous_interpretation" : "unknown_value",
      warning.field,
      warning.message,
      warning.severity === "error" ? "manual_only" : "review_recommended",
    ));
  });

  const otherFinding = comparable(worker.evaluaciones_cualitativas?.otros_hallazgos_resultado);
  const recognizedOtherPatterns = [
    "NORMAL",
    "SIN ALTERACIONES",
    "ONICOMICOSIS",
    "HIPERTRIGLICERIDEMIA",
    "HIPERGLICEMIA",
    "HIPERLIPIDEMIA MIXTA",
  ];
  if (otherFinding && !recognizedOtherPatterns.some((term) => otherFinding.includes(term))) {
    flags.push(createFlag(
      "unsupported_pattern",
      "evaluaciones_cualitativas.otros_hallazgos_resultado",
      "El dato se conserva de forma neutral, pero no coincide con un patrón clínico validado.",
    ));
  }

  normalizationTrace
    .filter((item) => item.normalizedValue === null && item.originalValue)
    .forEach((item) => {
      flags.push(createFlag(
        "empty_placeholder",
        item.sourceField,
        "El marcador de ausencia se omitió de la narrativa.",
        "automatic",
      ));
    });

  const byKey = new Map();
  flags.forEach((flag) => byKey.set(`${flag.type}|${flag.sourceField}|${flag.message}`, flag));
  return Array.from(byKey.values());
}
