import { classifyMetabolicAnalyte } from "./metabolicReference.js";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isEmptyLike(value) {
  const normalized = normalizeText(value);

  return (
    !normalized ||
    normalized === "-" ||
    normalized === "NO APLICA" ||
    normalized === "N/A" ||
    normalized === "NA" ||
    normalized === "S/D" ||
    normalized === "SD"
  );
}

function addWarning(warnings, field, message, severity = "warning", type = "unknown_value") {
  warnings.push({
    field,
    message,
    severity,
    type,
  });
}

export function validateExtractedWorker(worker) {
  const warnings = [];

  const generales = worker.datos_generales_narrables || {};
  const laboratorio = worker.laboratorio_numerico || {};
  const evaluaciones = worker.evaluaciones_cualitativas || {};
  const aptitud = worker.aptitud_y_recomendaciones || {};

  if (worker.derived_states?.low_confidence_fields?.includes("identificacion.nombres")) {
    addWarning(
      warnings,
      "identificacion.nombres",
      "Los nombres fueron separados automaticamente desde el campo Apellidos y Nombres. Revisar.",
      "warning",
      "identity_name_split_detected"
    );
  }

  if (worker.derived_states?.low_confidence_fields?.includes("identificacion.apellidos")) {
    addWarning(
      warnings,
      "identificacion.apellidos",
      "Los apellidos fueron separados automaticamente desde el campo Apellidos y Nombres. Revisar.",
      "warning",
      "identity_name_split_detected"
    );
  }

  if (normalizeText(aptitud.aptitud_final) === "PENDIENTE") {
    addWarning(
      warnings,
      "aptitud_y_recomendaciones.aptitud_final",
      "La aptitud final esta pendiente. No deberia pasar a narracion final sin revision.",
      "error"
    );
  }

  if (isEmptyLike(aptitud.aptitud_final)) {
    addWarning(
      warnings,
      "aptitud_y_recomendaciones.aptitud_final",
      "No se detecto aptitud final.",
      "error"
    );
  }

  if (typeof generales.imc === "number") {
    if (generales.imc >= 30) {
      addWarning(
        warnings,
        "datos_generales_narrables.imc",
      "IMC en rango de obesidad. Revisar que exista recomendacion nutricional o endocrinologica.",
        "warning",
        "imc_recommendation_review"
      );
    } else if (generales.imc >= 25) {
      addWarning(
        warnings,
        "datos_generales_narrables.imc",
        "IMC en rango de sobrepeso. Revisar recomendacion nutricional.",
        "info",
        "imc_recommendation_review"
      );
    }
  }

  [
    ["glucosa", "glucose"],
    ["colesterol", "cholesterol"],
    ["trigliceridos", "triglycerides"],
  ].forEach(([analyte, flagPrefix]) => {
    if (typeof laboratorio[`${analyte}_valor`] !== "number") return;
    const classification = classifyMetabolicAnalyte(analyte, laboratorio);
    if (classification.resolved) return;
    const ambiguous = classification.reason === "REFERENCE_GAP" ||
      classification.reason === "REFERENCE_OVERLAP" ||
      Boolean(classification.reference?.ambiguous);
    const missing = classification.reason === "REFERENCE_MISSING";
    addWarning(
      warnings,
      `laboratorio_numerico.${analyte}_referencia`,
      ambiguous
        ? `La referencia fuente de ${analyte} no permite una clasificacion inequivoca del valor.`
        : missing
          ? `No se encontro referencia fuente para clasificar ${analyte}.`
          : `No se pudo interpretar la referencia fuente de ${analyte}.`,
      "warning",
      ambiguous
        ? `${flagPrefix}_reference_ambiguous`
        : missing
          ? `${flagPrefix}_reference_missing`
          : `${flagPrefix}_classification_unresolved`,
    );
  });

  if (isEmptyLike(evaluaciones.ecg_resultado)) {
    addWarning(
      warnings,
      "evaluaciones_cualitativas.ecg_resultado",
      "ECG no informado o figura con guion.",
      "info",
      "ecg_not_reported"
    );
  }

  if (isEmptyLike(evaluaciones.audiometria_resultado)) {
    addWarning(
      warnings,
      "evaluaciones_cualitativas.audiometria_resultado",
      "Audiometria no informada o figura con guion.",
      "info",
      "audiometry_not_reported"
    );
  }

  const recomendaciones = aptitud.recomendaciones_generales_texto || "";
  const recomendacionesNormalizadas = normalizeText(recomendaciones);

  if (recomendacionesNormalizadas.includes("CONTROL CONTROL")) {
    addWarning(
      warnings,
      "aptitud_y_recomendaciones.recomendaciones_generales_texto",
      "La recomendacion contiene posible duplicidad: CONTROL CONTROL.",
      "warning",
      "duplicate_recommendation_source"
    );
  }

  if (/\dY\d/i.test(recomendaciones)) {
    addWarning(
      warnings,
      "aptitud_y_recomendaciones.recomendaciones_generales_texto",
      "La recomendacion contiene numeracion compacta tipo 2Y3. Revisar redaccion.",
      "info",
      "recommendation_compact_numbering"
    );
  }

  return {
    warnings,
    warning_count: warnings.length,
    error_count: warnings.filter((item) => item.severity === "error").length,
    has_errors: warnings.some((item) => item.severity === "error"),
    has_warnings: warnings.length > 0,
  };
}
