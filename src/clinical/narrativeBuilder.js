import { buildNarrativeDraftFromFindings } from "../lib/narrative/buildNarrativeDraftFromFindings.js";
import { normalizeClinicalText } from "./normalizeClinicalData.js";

function dedupeParagraphs(text) {
  const seen = new Set();
  return String(text || "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter((paragraph) => {
    if (!paragraph) return false;
    const key = paragraph.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n\n");
}

export function normalizeNarrativeForDisplay(value) {
  const normalized = String(value || "")
    .split(/\n{2,}/)
    .map((paragraph) => normalizeClinicalText(paragraph))
    .filter(Boolean)
    .join("\n\n");
  return dedupeParagraphs(normalized);
}

export function buildWorkerNarrative(findings) {
  const draft = buildNarrativeDraftFromFindings(findings);
  return {
    ...draft,
    text: normalizeNarrativeForDisplay(draft.text),
  };
}
