import { getMediwebFirstPages, getMediwebWorkerMetadata } from "../services/mediwebService.js";

export function createMediwebPdfFile(blob, fileName) {
  return new File([blob], fileName, { type: blob.type || "application/pdf" });
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
    if (Number.isInteger(page) && page > 0) byPage.set(page, [...(byPage.get(page) || []), index]);
  });

  const workers = (analysis?.workers ?? []).map((worker, workerIndex) => {
    const document = normalizeDocument(worker?.identificacion?.numero_documento || worker?.identificacion?.dni);
    const page = Number(analysis?.groups?.[workerIndex]?.start_page);
    const documentMatches = byDocument.get(document) ?? [];
    let entryIndex = documentMatches.length === 1 ? documentMatches[0] : undefined;
    let conflict = false;
    const pages = Number.isInteger(page) ? byPage.get(page) || [] : [];
    if (entryIndex !== undefined && ((pages.length && (pages.length !== 1 || pages[0] !== entryIndex)) || (page > 0 && Number(entries[entryIndex].paginaConsolidado) > 0 && Number(entries[entryIndex].paginaConsolidado) !== page))) { entryIndex = undefined; conflict = true; }
    if (entryIndex === undefined && Number.isInteger(page)) {
      const pageMatch = pages.length === 1 ? pages[0] : undefined;
      if (!conflict && pageMatch !== undefined && !used.has(pageMatch) && (!document || !normalizeDocument(entries[pageMatch].numeroDocumento) || normalizeDocument(entries[pageMatch].numeroDocumento) === document)) entryIndex = pageMatch;
    }
    if (entryIndex !== undefined && used.has(entryIndex)) entryIndex = undefined;
    if (entryIndex !== undefined) used.add(entryIndex);
    const entry = entryIndex === undefined ? null : entries[entryIndex];
    const identityMatched = Boolean(document && entry && normalizeDocument(entry.numeroDocumento) === document);
    const operational = { ...worker.datos_operativos };
    delete operational.archivo_pdf_completo_id;

    return {
      ...worker,
      datos_operativos: {
        ...operational,
        telefono: entry?.telefono || "",
        archivo_pdf_completo: entry?.archivoPdfCompleto || "",
        ...(entry?.archivoPdfCompletoId && identityMatched
          ? { archivo_pdf_completo_id: entry.archivoPdfCompletoId }
          : {}),
      },
      ...(!entry || !identityMatched ? { app_fields: { ...worker.app_fields, mediweb_link_error: !entry ? "No se pudo vincular inequívocamente documento y página del PDF completo." : "Vinculación por página sin identidad documental suficiente; requiere revisión." } } : {}),
    };
  });

  return { ...analysis, workers };
}

export async function importMediwebPdfIntoExistingFlow(jobId, handlePdfSelected, { signal } = {}) {
  const [firstPages, metadata] = await Promise.all([
    getMediwebFirstPages(jobId, { signal }),
    getMediwebWorkerMetadata(jobId, { signal }).catch(() => ({ workers: [] })),
  ]);
  const file = createMediwebPdfFile(firstPages.blob, firstPages.fileName);
  const processingResult = await handlePdfSelected(file, { mediwebWorkerMetadata: metadata });
  return { file, processingResult };
}
