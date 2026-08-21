export const PDF_SOURCE_MODE = "pdf";
export const MEDIWEB_SOURCE_MODE = "mediweb";

export function isMediwebSourceMode(sourceMode) {
  return sourceMode === MEDIWEB_SOURCE_MODE;
}

export function prepareAnalysisForSource(
  analysis,
  sourceMode,
  reviewedAt = new Date().toISOString(),
) {
  if (!analysis) return analysis;

  if (!isMediwebSourceMode(sourceMode)) {
    return { ...analysis, source_mode: PDF_SOURCE_MODE };
  }

  return {
    ...analysis,
    source_mode: MEDIWEB_SOURCE_MODE,
    workers: (analysis.workers || []).map((worker) => ({
      ...worker,
      derived_states: {
        ...(worker.derived_states || {}),
        reviewed_by_user: true,
        reviewed_at: worker.derived_states?.reviewed_at || reviewedAt,
      },
      app_fields: {
        ...(worker.app_fields || {}),
        needs_review: false,
      },
    })),
  };
}

export function resolveEditableNarrative({ sourceMode, savedText, generatedText }) {
  if (savedText) return savedText;
  return isMediwebSourceMode(sourceMode) ? generatedText || "" : "";
}
