import { createBatchMetadata } from "./batchState.js";
import { processWorkerClinicalNarrative } from "../clinical/index.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";

export function prepareInitialNarratives(analysis, greeting) {
  return { ...analysis, workers: analysis.workers.map(worker => ({ ...worker, app_fields: { ...worker.app_fields,
    texto_final: applyNarrativeGreeting(processWorkerClinicalNarrative({ ...worker, derived_states: { ...worker.derived_states, reviewed_by_user: true } }).displayText, greeting),
  } })) };
}

export const PDF_SOURCE_MODE = "pdf";
export const MEDIWEB_SOURCE_MODE = "mediweb";

export function prepareAnalysisForReview(
  analysis,
  sourceMode,
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
      source_mode: normalizedSourceMode,
      clinical_approval: { status: "pendiente" },
      derived_states: {
        ...(worker.derived_states || {}),
        reviewed_by_user: false,
        reviewed_at: "",
        needs_review: true,
        extraction_status: "extraido",
      },
      app_fields: {
        ...(worker.app_fields || {}),
        needs_review: true,
      },
    })),
  };

  return {
    ...prepared,
    batch_metadata: createBatchMetadata(prepared, normalizedSourceMode),
  };
}

export function resolveEditableNarrative({ savedText, generatedText }) {
  return savedText ?? generatedText ?? "";
}

export function getWorkerPhone(worker) {
  return String(worker?.datos_operativos?.telefono || "").trim();
}

export function getWorkerFullPdfName(worker) {
  return String(worker?.datos_operativos?.archivo_pdf_completo || "").trim();
}
