export const EMPTY_CLINICAL_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  "---",
  "N/A",
  "NA",
  "NO APLICA",
  "NO REGISTRA",
  "SIN DATO",
  "NULL",
  "UNDEFINED",
]);
function comparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function isClinicalPlaceholder(value) {
  return typeof value === "string" && EMPTY_CLINICAL_PLACEHOLDERS.has(comparable(value));
}

export function hasCasedLetters(value) {
  const letters = String(value)
    .replace(/\b(?:mg\s*\/\s*dL|mmHg)\b/giu, "")
    .match(/\p{L}/gu) || [];
  return letters.length > 1 && letters.every((letter) => letter === letter.toUpperCase());
}

export function normalizePersonName(value) {
  if (value === null || value === undefined || isClinicalPlaceholder(value)) return null;
  const cleaned = String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (!hasCasedLetters(cleaned)) return cleaned;
  return cleaned
    .toLocaleLowerCase("es-PE")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("es-PE")}`);
}

