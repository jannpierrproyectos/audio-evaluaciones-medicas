import { getMediwebFirstPages } from "../services/mediwebService.js";

export function createMediwebPdfFile(blob) {
  return new File([blob], "primeras-hojas-mediweb.pdf", { type: "application/pdf" });
}

export async function importMediwebPdfIntoExistingFlow(jobId, handlePdfSelected, { signal } = {}) {
  const blob = await getMediwebFirstPages(jobId, { signal });
  const file = createMediwebPdfFile(blob);
  const processingResult = await handlePdfSelected(file);
  return { file, processingResult };
}
