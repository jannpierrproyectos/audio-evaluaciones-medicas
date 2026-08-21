export const PDF_SOURCE_MODE = "pdf";
export const MEDIWEB_SOURCE_MODE = "mediweb";

export function prepareAnalysisForReview(
  analysis,
  sourceMode,
  reviewedAt = new Date().toISOString(),
) {
  if (!analysis) return analysis;

  return {
    ...analysis,
    source_mode: sourceMode === MEDIWEB_SOURCE_MODE
      ? MEDIWEB_SOURCE_MODE
      : PDF_SOURCE_MODE,
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

export function resolveEditableNarrative({ savedText, generatedText }) {
  return savedText || generatedText || "";
}
