export const APTITUD_CATEGORIES = Object.freeze({
  APTO: "apto",
  OBSERVADO: "observado",
  PENDIENTE: "pendiente",
  NO_APTO: "no_apto",
  NO_ELEGIBLE: "aptitud_no_elegible",
});

export function normalizeAptitud(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\r\n]+/g, " ")
    .toUpperCase()
    .replace(/[.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAptitud(value) {
  const normalized = normalizeAptitud(value);

  if (/\bNO\s+APTO\b/.test(normalized)) {
    return { eligible: false, category: APTITUD_CATEGORIES.NO_APTO, normalized };
  }
  if (/\bOBSERVADO\b/.test(normalized)) {
    return { eligible: false, category: APTITUD_CATEGORIES.OBSERVADO, normalized };
  }
  if (/\bPENDIENTE\b/.test(normalized)) {
    return { eligible: false, category: APTITUD_CATEGORIES.PENDIENTE, normalized };
  }
  if (/^APTO\b/.test(normalized)) {
    return { eligible: true, category: APTITUD_CATEGORIES.APTO, normalized };
  }
  return { eligible: false, category: APTITUD_CATEGORIES.NO_ELEGIBLE, normalized };
}
