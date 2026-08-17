const NUMBER_SOURCE = "[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)";

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseSourceNumber(value) {
  const raw = normalizeSpaces(value);
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseReferenceExpression(value) {
  const rawText = normalizeSpaces(value);
  if (!rawText) return null;

  const range = rawText.match(new RegExp(`^(${NUMBER_SOURCE})\\s*[-–—]\\s*(${NUMBER_SOURCE})$`));
  if (range) {
    const min = parseSourceNumber(range[1]);
    const max = parseSourceNumber(range[2]);
    if (min === null || max === null || min > max) return null;
    return {
      type: "range",
      rawText,
      min,
      max,
      minInclusive: true,
      maxInclusive: true,
    };
  }

  const comparison = rawText.match(new RegExp(`^(<=|>=|≤|≥|<|>)\\s*(${NUMBER_SOURCE})$`));
  if (!comparison) return null;
  const boundary = parseSourceNumber(comparison[2]);
  if (boundary === null) return null;
  const operator = comparison[1].replace("≤", "<=").replace("≥", ">=");
  return {
    type: "comparison",
    rawText,
    operator,
    boundary,
    min: operator.startsWith(">") ? boundary : null,
    max: operator.startsWith("<") ? boundary : null,
    minInclusive: operator === ">=",
    maxInclusive: operator === "<=",
  };
}

export function referenceExpressionMatches(expression, value) {
  const numericValue = typeof value === "number" ? value : parseSourceNumber(value);
  if (!expression || numericValue === null || !Number.isFinite(numericValue)) return false;
  if (expression.type === "range") {
    const aboveMin = expression.minInclusive ? numericValue >= expression.min : numericValue > expression.min;
    const belowMax = expression.maxInclusive ? numericValue <= expression.max : numericValue < expression.max;
    return aboveMin && belowMax;
  }
  if (expression.type !== "comparison") return false;
  if (expression.operator === "<") return numericValue < expression.boundary;
  if (expression.operator === "<=") return numericValue <= expression.boundary;
  if (expression.operator === ">") return numericValue > expression.boundary;
  if (expression.operator === ">=") return numericValue >= expression.boundary;
  return false;
}

export function classifyBySimpleRange(value, reference) {
  const numericValue = typeof value === "number" ? value : parseSourceNumber(value);
  const expression = reference?.expression || reference;
  if (numericValue === null) return { resolved: false, reason: "VALUE_MISSING", classification: null };
  if (!expression) return { resolved: false, reason: "REFERENCE_MISSING", classification: null };
  if (expression.type !== "range") return { resolved: false, reason: "REFERENCE_UNRESOLVED", classification: null };
  if (referenceExpressionMatches(expression, numericValue)) {
    return { resolved: true, reason: null, classification: "NORMAL", matchedCategories: [] };
  }
  if (numericValue < expression.min) {
    return { resolved: true, reason: null, classification: "LOW", matchedCategories: [] };
  }
  if (numericValue > expression.max) {
    return { resolved: true, reason: null, classification: "HIGH", matchedCategories: [] };
  }
  return { resolved: false, reason: "REFERENCE_GAP", classification: null, matchedCategories: [] };
}

export function classifyByCategories(value, reference) {
  const numericValue = typeof value === "number" ? value : parseSourceNumber(value);
  if (numericValue === null) return { resolved: false, reason: "VALUE_MISSING", classification: null };
  const categories = reference?.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    return { resolved: false, reason: "REFERENCE_MISSING", classification: null, matchedCategories: [] };
  }
  if (categories.some((category) => !category.expression)) {
    return { resolved: false, reason: "REFERENCE_UNRESOLVED", classification: null, matchedCategories: [] };
  }
  const matches = categories.filter((category) => referenceExpressionMatches(category.expression, numericValue));
  if (matches.length === 1) {
    return {
      resolved: true,
      reason: null,
      classification: matches[0].classification,
      sourceLabel: matches[0].labelRaw,
      matchedCategories: matches,
    };
  }
  return {
    resolved: false,
    reason: matches.length > 1 ? "REFERENCE_OVERLAP" : "REFERENCE_GAP",
    classification: null,
    matchedCategories: matches,
  };
}

export function classifyMetabolicAnalyte(analyte, laboratory = {}) {
  const prefix = String(analyte || "").toLowerCase();
  const value = laboratory[`${prefix}_valor`];
  const reference = laboratory[`${prefix}_referencia`];
  const result = prefix === "glucosa"
    ? classifyBySimpleRange(value, reference)
    : classifyByCategories(value, reference);
  return {
    analyte: prefix,
    value,
    unit: laboratory[`${prefix}_unidad`] || "",
    sourceValue: laboratory[`${prefix}_valor_fuente`] || "",
    reference,
    ...result,
  };
}

function comparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function evaluateMetabolicSourceStatement(sourceText, laboratory = {}) {
  const source = comparable(sourceText);
  if (!source) return null;

  const glucose = classifyMetabolicAnalyte("glucosa", laboratory);
  const cholesterol = classifyMetabolicAnalyte("colesterol", laboratory);
  const triglycerides = classifyMetabolicAnalyte("trigliceridos", laboratory);
  const result = (kind, status, analytes, reason) => ({
    kind,
    status,
    sourceText: String(sourceText ?? "").trim(),
    normalizedSource: source,
    analytes,
    reason,
  });

  if (source === "HIPERCOLESTEROLEMIA LIMITE ALTO") {
    return cholesterol.classification === "BORDERLINE_HIGH"
      ? result("HYPERCHOLESTEROLEMIA_BORDERLINE", "EXACT_EQUIVALENT", [cholesterol], "El texto fuente coincide con la categoria numerica impresa.")
      : result("HYPERCHOLESTEROLEMIA_BORDERLINE", "DISCREPANT", [cholesterol], "El texto fuente no coincide con la categoria numerica impresa.");
  }

  if (source === "HIPERCOLESTEROLEMIA DEFINIDA") {
    return cholesterol.classification === "HIGH"
      ? result("HYPERCHOLESTEROLEMIA_DEFINED", "ADDITIONAL_SOURCE_INFORMATION", [cholesterol], "La fuente aporta una calificacion explicita adicional al resultado numerico alto.")
      : result("HYPERCHOLESTEROLEMIA_DEFINED", "DISCREPANT", [cholesterol], "La calificacion explicita de la fuente no coincide con la categoria numerica impresa.");
  }

  if (/^HIPERGLICEMIA(?: EN TRATAMIENTO)?$/.test(source)) {
    if (glucose.classification !== "HIGH") {
      return result("HYPERGLYCEMIA", "DISCREPANT", [glucose], "El texto fuente no coincide con la categoria numerica impresa.");
    }
    return result(
      "HYPERGLYCEMIA",
      source.includes("EN TRATAMIENTO") ? "ADDITIONAL_SOURCE_INFORMATION" : "EXACT_EQUIVALENT",
      [glucose],
      source.includes("EN TRATAMIENTO")
        ? "La fuente aporta el estado en tratamiento, que no esta contenido en la cifra."
        : "El texto fuente coincide con el resultado numerico por encima del rango.",
    );
  }

  if (/^HIPERTRIGLICERIDEMIA(?: EN TRATAMIENTO)?$/.test(source)) {
    if (!["BORDERLINE_HIGH", "HIGH", "VERY_HIGH"].includes(triglycerides.classification)) {
      return result("HYPERTRIGLYCERIDEMIA", "DISCREPANT", [triglycerides], "El texto fuente no coincide con la categoria numerica impresa.");
    }
    const exact = triglycerides.classification === "HIGH" && !source.includes("EN TRATAMIENTO");
    return result(
      "HYPERTRIGLYCERIDEMIA",
      exact ? "EXACT_EQUIVALENT" : "ADDITIONAL_SOURCE_INFORMATION",
      [triglycerides],
      exact
        ? "El texto fuente coincide con el resultado numerico en rango alto."
        : "La fuente aporta una calificacion o estado adicional que no se deduce de la cifra.",
    );
  }

  if (/^HIPERLIPIDEMIA MIXTA(?: EN TRATAMIENTO)?$/.test(source)) {
    const bothAbnormal = [cholesterol, triglycerides].every((item) =>
      ["BORDERLINE_HIGH", "HIGH", "VERY_HIGH"].includes(item.classification),
    );
    return bothAbnormal
      ? result("MIXED_HYPERLIPIDEMIA", "ADDITIONAL_SOURCE_INFORMATION", [cholesterol, triglycerides], "La fuente aporta una calificacion conjunta explicita de ambos resultados.")
      : result("MIXED_HYPERLIPIDEMIA", "DISCREPANT", [cholesterol, triglycerides], "La calificacion conjunta de la fuente no coincide con ambos resultados numericos.");
  }

  return null;
}
