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

  if (typeof laboratorio.trigliceridos_valor === "number") {
    if (laboratorio.trigliceridos_valor >= 200) {
      addWarning(
        warnings,
        "laboratorio_numerico.trigliceridos_valor",
        "Trigliceridos elevados. Revisar recomendacion metabolica.",
        "warning",
        "triglycerides_unclassified"
      );
    } else if (laboratorio.trigliceridos_valor >= 150) {
      addWarning(
        warnings,
        "laboratorio_numerico.trigliceridos_valor",
        "Trigliceridos en limite alto. Revisar si corresponde recomendacion metabolica.",
        "info",
        "triglycerides_unclassified"
      );
    }
  }

  if (typeof laboratorio.colesterol_valor === "number") {
    if (laboratorio.colesterol_valor >= 240) {
      addWarning(
        warnings,
        "laboratorio_numerico.colesterol_valor",
        "Colesterol alto. Revisar recomendacion metabolica.",
        "warning",
        "cholesterol_unclassified"
      );
    } else if (laboratorio.colesterol_valor >= 200) {
      addWarning(
        warnings,
        "laboratorio_numerico.colesterol_valor",
        "Colesterol en limite alto. Revisar recomendacion metabolica.",
        "info",
        "cholesterol_unclassified"
      );
    }
  }

  if (typeof laboratorio.glucosa_valor === "number") {
    if (laboratorio.glucosa_valor >= 126) {
      addWarning(
        warnings,
        "laboratorio_numerico.glucosa_valor",
        "Glucosa elevada. Revisar indicacion de control medico.",
        "warning",
        "glucose_unclassified"
      );
    } else if (laboratorio.glucosa_valor > 100) {
      addWarning(
        warnings,
        "laboratorio_numerico.glucosa_valor",
        "Glucosa en limite alto. Revisar recomendacion metabolica.",
        "info",
        "glucose_unclassified"
      );
    }
  }

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
