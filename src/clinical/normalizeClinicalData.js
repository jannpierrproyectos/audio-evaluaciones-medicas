import { hasCasedLetters, isClinicalPlaceholder, normalizePersonName } from "../../mediweb-downloader/src/personNames.js";
export { isClinicalPlaceholder, normalizePersonName } from "../../mediweb-downloader/src/personNames.js";
import {
  CLINICAL_ACCENT_REPLACEMENTS,
  CLINICAL_ACRONYMS,
} from "./dictionaries.js";

const CLINICAL_BLOCKS = [
  "datos_generales_narrables",
  "laboratorio_numerico",
  "evaluaciones_cualitativas",
  "aptitud_y_recomendaciones",
];

function sentenceCaseAllCaps(value) {
  if (!hasCasedLetters(value)) return value;
  const lowered = value.toLocaleLowerCase("es-PE");
  return lowered.replace(/(^|[.!?]\s+)(\p{L})/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("es-PE")}`);
}

function restoreAcronyms(value) {
  return CLINICAL_ACRONYMS.reduce(
    (text, acronym) => text.replace(new RegExp(`\\b${acronym}\\b`, "giu"), acronym),
    value,
  );
}

export function normalizeClinicalText(value) {
  if (value === null || value === undefined || isClinicalPlaceholder(value)) return null;
  if (typeof value !== "string") return value;

  let normalized = value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])\1+/g, "$1")
    .replace(/\s*:\s*/g, ": ")
    .replace(/(\d)\s*(mg\s*\/\s*dL|mmHg|kg|cm)\b/giu, "$1 $2")
    .trim();

  normalized = sentenceCaseAllCaps(normalized);
  CLINICAL_ACCENT_REPLACEMENTS.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, (...args) => {
      const matched = args[0];
      const next = typeof replacement === "function"
        ? replacement(...args)
        : replacement;
      return /^\p{Lu}/u.test(matched)
        ? next.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase("es-PE"))
        : next;
    });
  });
  normalized = restoreAcronyms(normalized);
  normalized = normalized
    .replace(/\bg\s*\/\s*dl\b/giu, "g/dL")
    .replace(/\bmg\s*\/\s*dl\b/giu, "mg/dL")
    .replace(/\bmmhg\b/giu, "mmHg");

  return normalized || null;
}

function normalizeBlock(block = {}, blockName, trace) {
  return Object.fromEntries(Object.entries(block).map(([field, originalValue]) => {
    const normalizedValue = normalizeClinicalText(originalValue);
    if (normalizedValue !== originalValue) {
      trace.push({
        sourceField: `${blockName}.${field}`,
        ruleId: "normalize_clinical_value",
        originalValue,
        normalizedValue,
      });
    }
    return [field, normalizedValue];
  }));
}

export function normalizeWorkerClinicalData(rawWorker = {}) {
  const trace = [];
  const worker = { ...rawWorker };

  CLINICAL_BLOCKS.forEach((blockName) => {
    worker[blockName] = normalizeBlock(rawWorker[blockName], blockName, trace);
  });

  const originalIdentity = rawWorker.identificacion || {};
  worker.identificacion = { ...originalIdentity };
  Object.entries(originalIdentity).forEach(([field, originalValue]) => {
    const normalizedValue = ["nombres", "apellidos", "nombre_completo", "nombre_completo_original"].includes(field)
      ? normalizePersonName(originalValue)
      : normalizeClinicalText(originalValue);
    worker.identificacion[field] = normalizedValue;
    if (normalizedValue !== originalValue) {
      trace.push({
        sourceField: `identificacion.${field}`,
        ruleId: field.includes("nombre") || field === "apellidos" ? "normalize_person_name" : "normalize_clinical_value",
        originalValue,
        normalizedValue,
      });
    }
  });

  return { worker, trace };
}
