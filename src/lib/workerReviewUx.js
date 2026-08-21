import { createBatchMetadata } from "./batchState.js";

export const PDF_SOURCE_MODE = "pdf";
export const MEDIWEB_SOURCE_MODE = "mediweb";

export function prepareAnalysisForReview(
  analysis,
  sourceMode,
  reviewedAt = new Date().toISOString(),
) {
  if (!analysis) return analysis;

  const normalizedSourceMode = sourceMode === MEDIWEB_SOURCE_MODE
    ? MEDIWEB_SOURCE_MODE
    : PDF_SOURCE_MODE;

  const prepared = {
    ...analysis,
    source_mode: normalizedSourceMode,
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

  return {
    ...prepared,
    batch_metadata: createBatchMetadata(prepared, normalizedSourceMode),
  };
}

export function resolveEditableNarrative({ savedText, generatedText }) {
  return savedText || generatedText || "";
}

export function getWorkerPhone(worker) {
  return String(worker?.datos_operativos?.telefono || "").trim();
}

export function getWorkerFullPdfName(worker) {
  return String(worker?.datos_operativos?.archivo_pdf_completo || "").trim();
}
