import { applyClinicalRules } from "./clinicalRules.js";
import { buildWorkerNarrative } from "./narrativeBuilder.js";
import { normalizeWorkerClinicalData } from "./normalizeClinicalData.js";
import { collectNarrativeReviewFlags, collectReviewFlags } from "./reviewFlags.js";
import { prepareTextForTts } from "./ttsNormalizer.js";

export function processWorkerClinicalNarrative(rawWorker = {}, options = {}) {
  const normalization = normalizeWorkerClinicalData(rawWorker);
  const initialReviewFlags = collectReviewFlags(normalization.worker, normalization.trace);
  const rules = applyClinicalRules(normalization.worker, initialReviewFlags);
  const reviewFlags = [
    ...initialReviewFlags,
    ...collectNarrativeReviewFlags(rules.findings),
  ];
  const narrative = buildWorkerNarrative(rules.findings);
  const displayText = narrative.text;
  const ttsText = prepareTextForTts(displayText, options);

  return {
    rawWorker,
    normalizedWorker: normalization.worker,
    findings: rules.findings,
    displayText,
    ttsText,
    canGenerate: narrative.can_generate,
    blockingReasons: narrative.blocking_reasons,
    reviewFlags,
    confidence: reviewFlags.some((flag) => flag.confidence === "manual_only")
      ? "manual_only"
      : reviewFlags.some((flag) => flag.confidence === "review_recommended")
        ? "review_recommended"
        : "automatic",
    trace: [...normalization.trace, ...rules.trace],
    metrics: {
      flags: reviewFlags.length,
      normalizedFields: normalization.trace.length,
      generatedFragments: (narrative.sections?.hallazgos || []).length,
    },
  };
}

export { normalizeClinicalText, normalizePersonName, normalizeWorkerClinicalData } from "./normalizeClinicalData.js";
export { prepareTextForTts } from "./ttsNormalizer.js";
