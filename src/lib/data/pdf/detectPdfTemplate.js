function normalizeForTemplateDetection(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function detectPdfTemplate(pageText = "") {
  const normalized = normalizeForTemplateDetection(pageText);

  const innomedicMarkers = [
    "RESULTADO DE EVALUACION MEDICA",
    "DATOS DEL TRABAJADOR",
    "RESUMEN DE RESULTADOS",
    "PRUEBAS DE LABORATORIO",
    "APTITUD",
    "RECOMENDACIONES",
  ];

  const matchedMarkers = innomedicMarkers.filter((marker) =>
    normalized.includes(marker)
  );

  if (matchedMarkers.length >= 4) {
    return {
      template_id: "innomedic_resultado_evaluacion_medica_v1",
      confidence: "alta",
      matched_markers: matchedMarkers,
    };
  }

  if (matchedMarkers.length >= 2) {
    return {
      template_id: "innomedic_resultado_evaluacion_medica_v1",
      confidence: "media",
      matched_markers: matchedMarkers,
    };
  }

  return {
    template_id: "unknown",
    confidence: "baja",
    matched_markers: matchedMarkers,
  };
}