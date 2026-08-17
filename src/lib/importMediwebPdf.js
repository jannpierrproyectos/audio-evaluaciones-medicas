import { getMediwebFirstPages, getMediwebWorkerMetadata } from "../services/mediwebService.js";

export function createMediwebPdfFile(blob) {
  return new File([blob], "primeras-hojas-mediweb.pdf", { type: "application/pdf" });
}

function normalizeDocument(value) {
  return String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function attachMediwebWorkerMetadata(analysis, metadata = {}) {
  const entries = Array.isArray(metadata.workers) ? metadata.workers : [];
  const used = new Set();
  const byDocument = new Map();
  const byPage = new Map();

  entries.forEach((entry, index) => {
    const document = normalizeDocument(entry.numeroDocumento);
    if (document) {
      const matches = byDocument.get(document) ?? [];
      matches.push(index);
      byDocument.set(document, matches);
    }
    const page = Number(entry.paginaConsolidado);
    if (Number.isInteger(page) && page > 0) byPage.set(page, index);
  });

  const workers = (analysis?.workers ?? []).map((worker, workerIndex) => {
    const document = normalizeDocument(worker?.identificacion?.numero_documento || worker?.identificacion?.dni);
    const page = Number(analysis?.groups?.[workerIndex]?.start_page);
    const documentMatches = (byDocument.get(document) ?? []).filter((index) => !used.has(index));
    let entryIndex = documentMatches.length === 1 ? documentMatches[0] : undefined;
    if (entryIndex === undefined && Number.isInteger(page)) {
      const pageMatch = byPage.get(page);
      if (pageMatch !== undefined && !used.has(pageMatch)) entryIndex = pageMatch;
    }
    if (entryIndex !== undefined) used.add(entryIndex);
    const entry = entryIndex === undefined ? null : entries[entryIndex];

    return {
      ...worker,
      datos_operativos: {
        ...(worker.datos_operativos || {}),
        telefono: entry?.telefono || "",
        archivo_pdf_completo: entry?.archivoPdfCompleto || "",
      },
    };
  });

  return { ...analysis, workers };
}

export async function importMediwebPdfIntoExistingFlow(jobId, handlePdfSelected, { signal } = {}) {
  const [blob, metadata] = await Promise.all([
    getMediwebFirstPages(jobId, { signal }),
    getMediwebWorkerMetadata(jobId, { signal }).catch(() => ({ workers: [] })),
  ]);
  const file = createMediwebPdfFile(blob);
  const processingResult = await handlePdfSelected(file, { mediwebWorkerMetadata: metadata });
  return { file, processingResult };
}
