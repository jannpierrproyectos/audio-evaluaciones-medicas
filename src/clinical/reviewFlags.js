import { evaluateMetabolicSourceStatement } from "../lib/data/metabolicReference.js";

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
      warning.severity === "error" ? "ambiguous_interpretation" : warning.type || "unknown_value",
      warning.field,
      warning.message,
      warning.severity === "error" ? "manual_only" : "review_recommended",
    ));
  });

  const structuredOtherItems = Array.isArray(worker.evaluaciones_cualitativas?.otros_hallazgos_items)
    ? worker.evaluaciones_cualitativas.otros_hallazgos_items
      .map((item) => comparable(item?.text))
      .filter(Boolean)
    : [];
  const otherFinding = comparable(worker.evaluaciones_cualitativas?.otros_hallazgos_resultado);
  const otherFindingValues = structuredOtherItems.length ? structuredOtherItems : [otherFinding].filter(Boolean);
  const recognizedOtherPatterns = [
    "NORMAL", "SIN ALTERACIONES", "ONICOMICOSIS", "MICOSIS", "HIPERQUERATOSIS", "DERMATITIS",
    "ONICODISTROFIA", "INSUFICIENCIA VENOSA", "PIE CAVO", "PIE PLANO", "ALERGIA A",
    "HIPERTRIGLICERIDEMIA", "HIPERGLICEMIA", "HIPERLIPIDEMIA MIXTA",
    "HIPERCOLESTEROLEMIA", "HEPATOMEGALIA", "RINITIS ALERGICA EN TRATAMIENTO",
    "HIPERTENSION ARTERIAL CONTROLADA", "ANEMIA", "LEUCOCITOSIS", "MIGRANA POR ANTECEDENTE",
    "ESTEATOSIS HEPATICA", "DIABETES MELLITUS CONTROLADA", "LEUCOCITURIA", "TROMBOCITOSIS",
    "EOSINOFILIA: DESCARTAR PARASITOSIS Y/O ALERGIAS", "FARINGITIS", "LEUCOPENIA",
    "LIPOMATOSIS EN MANO DERECHA", "QUEMADURA DE TERCER GRADO",
  ];
  const hasUnsupportedOtherFinding = otherFindingValues.some(
    (value) => !recognizedOtherPatterns.some((term) => value.includes(term)),
  );
  if (hasUnsupportedOtherFinding) {
    flags.push(createFlag(
      "unsupported_pattern",
      "evaluaciones_cualitativas.otros_hallazgos_resultado",
      "El dato se conserva de forma neutral, pero no coincide con un patrón clínico validado.",
    ));
  }
  const metabolicSourceConflicts = otherFindingValues
    .map((value) => evaluateMetabolicSourceStatement(value, worker.laboratorio_numerico || {}))
    .filter((evaluation) => evaluation?.status === "DISCREPANT");
  metabolicSourceConflicts.forEach((evaluation) => {
    flags.push(createFlag(
      "metabolic_source_classification_conflict",
      "evaluaciones_cualitativas.otros_hallazgos_resultado",
      `${evaluation.sourceText}: ${evaluation.reason}`,
    ));
  });
  if (
    structuredOtherItems.length <= 1 &&
    /(?:RINITIS ALERGICA.*EOSINOFILIA|INSUFICIENCIA VENOSA.*(?:EOSINOFILIA|HIPERCOLESTEROLEMIA|HIPERTENSION|ANEMIA)|ALERGIA A LA CEFTRIAXONA.*INSUFICIENCIA VENOSA|MIGRANA.*INSUFICIENCIA VENOSA|MICOSIS.*ANEMIA|HIPERCOLESTEROLEMIA DEFINIDA.*LEUCOPENIA|FARINGITIS AGUDA.*HIPERQUERATOSIS.*LEUCOCITOSIS|DESCARTAR ONICOMICOSIS.*INSUFICIENCIA VENOSA)/.test(otherFinding)
  ) {
    flags.push(createFlag(
      "ambiguous_other_findings_structure",
      "evaluaciones_cualitativas.otros_hallazgos_resultado",
      "El bloque contiene varios hallazgos sin delimitación fuente inequívoca.",
    ));
  }

  const laboratory = worker.laboratorio_numerico || {};
  const hemoglobinValue = Number(laboratory.hemoglobina_valor);
  if (Number.isFinite(hemoglobinValue)) {
    const sex = comparable(worker.identificacion?.sexo);
    const selectedSex = ["M", "MASCULINO", "HOMBRE"].includes(sex)
      ? "masculino"
      : ["F", "FEMENINO", "MUJER"].includes(sex)
        ? "femenino"
        : "";
    const minValue = laboratory[`hemoglobina_rango_${selectedSex}_min`];
    const maxValue = laboratory[`hemoglobina_rango_${selectedSex}_max`];
    const min = minValue === null || minValue === undefined || minValue === "" ? Number.NaN : Number(minValue);
    const max = maxValue === null || maxValue === undefined || maxValue === "" ? Number.NaN : Number(maxValue);
    if (laboratory.hemoglobina_rango_ambiguo || !selectedSex) {
      flags.push(createFlag(
        "hemoglobin_reference_range_ambiguous",
        "laboratorio_numerico.hemoglobina_valor",
        "No puede seleccionarse inequívocamente un rango de hemoglobina para el sexo registrado.",
      ));
    } else if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      flags.push(createFlag(
        "hemoglobin_reference_range_missing",
        "laboratorio_numerico.hemoglobina_valor",
        "La hemoglobina tiene valor, pero no un rango de referencia fuente utilizable.",
      ));
    }
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

export function collectNarrativeReviewFlags(findings = {}) {
  const flags = [...(findings.policy_flags || [])];
  Object.entries(findings.narrative_groups || {}).forEach(([area, group]) => {
    if (!group?.narrar || !group.recomendaciones?.length) return;
    if (group.association_status === "AMBIGUOUS_ASSOCIATION") {
      flags.push(createFlag(
        "ambiguous_recommendation_mapping",
        `narrative_groups.${area}`,
        group.association_reason || "La recomendación tiene varios hallazgos candidatos.",
      ));
    }
    if (
      !group.hallazgos?.some((finding) =>
        finding.recommendation_candidate !== false && finding.narrar !== false
      ) &&
      ["AMBIGUOUS_ASSOCIATION", "NO_RELATED_FINDING", "NONE"].includes(group.association_status)
    ) {
      flags.push(createFlag(
        "orphan_recommendation",
        `narrative_groups.${area}`,
        "La recomendación se conserva de forma neutral porque no tiene un hallazgo inequívocamente asociado.",
      ));
    }
  });
  return flags;
}
