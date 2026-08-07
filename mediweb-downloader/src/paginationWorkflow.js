import { APTITUD_CATEGORIES, classifyAptitud } from "./aptitud.js";
import { createAttentionKey } from "./mediwebTable.js";
import { createPageSignature } from "./pagination.js";

function emptyTotals() {
  return {
    totalPaginasVisitadas: 0,
    totalDetectado: 0,
    totalUnico: 0,
    totalElegible: 0,
    totalExcluido: 0,
    totalSeleccionado: 0,
    totalProcesado: 0,
    totalDuplicado: 0,
    excluidosObservado: 0,
    excluidosPendiente: 0,
    excluidosNoApto: 0,
    excluidosOtros: 0,
  };
}

function snapshot(totals) {
  return { ...totals };
}

function addExcludedCategory(totals, category) {
  if (category === APTITUD_CATEGORIES.OBSERVADO) totals.excluidosObservado += 1;
  else if (category === APTITUD_CATEGORIES.PENDIENTE) totals.excluidosPendiente += 1;
  else if (category === APTITUD_CATEGORIES.NO_APTO) totals.excluidosNoApto += 1;
  else totals.excluidosOtros += 1;
}

export async function runPaginatedWorkflow({
  firstExtraction,
  limit = null,
  perPageLimit = null,
  maxPages = null,
  singlePage = false,
  processAttention,
  advance,
  onPageClassified = async () => {},
  onAttentionProcessed = async () => {},
  onPageCompleted = async () => {},
  onWarning = async () => {},
  isInterrupted = () => false,
}) {
  const totals = emptyTotals();
  const seenAttentions = new Set();
  const visitedSignatures = new Map();
  let extraction = firstExtraction;
  let allowVisited = false;
  let motivoFinalizacion = "ultima_pagina";

  while (!isInterrupted()) {
    const signature = createPageSignature(extraction.atenciones);
    if (visitedSignatures.has(signature)) {
      if (!allowVisited) {
        motivoFinalizacion = "pagina_repetida";
        await onWarning("Se detectó una página ya procesada. La paginación se detuvo para evitar un bucle.");
        break;
      }

      const repeatedAdvance = await advance({
        previousSignature: signature,
        pageNumber: visitedSignatures.get(signature),
        recoveryTraversal: true,
      });
      if (repeatedAdvance.status === "advanced") {
        extraction = repeatedAdvance.extraction;
        allowVisited = Boolean(repeatedAdvance.allowVisited);
        continue;
      }
      motivoFinalizacion = repeatedAdvance.status === "last_page" ? "ultima_pagina" : "error_paginacion";
      break;
    }

    const paginaMediWeb = totals.totalPaginasVisitadas + 1;
    visitedSignatures.set(signature, paginaMediWeb);
    totals.totalPaginasVisitadas += 1;
    const rawDetected = extraction.totalFilasDetectadas ?? extraction.atenciones.length;
    totals.totalDetectado += rawDetected;

    const unique = [];
    for (const item of extraction.atenciones) {
      const key = createAttentionKey(item);
      if (seenAttentions.has(key)) continue;
      seenAttentions.add(key);
      const aptitudClassification = classifyAptitud(item.aptitud);
      unique.push({
        ...item,
        paginaMediWeb,
        ordenDetectado: totals.totalUnico + unique.length + 1,
        aptitudClassification,
      });
    }

    const duplicateCount = rawDetected - unique.length;
    totals.totalDuplicado += Math.max(0, duplicateCount);
    totals.totalUnico += unique.length;
    const eligible = unique.filter((item) => item.aptitudClassification.eligible);
    const excluded = unique.filter((item) => !item.aptitudClassification.eligible);
    totals.totalElegible += eligible.length;
    totals.totalExcluido += excluded.length;
    for (const item of excluded) addExcludedCategory(totals, item.aptitudClassification.category);

    const remainingGlobal = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - totals.totalSeleccionado);
    const pageCapacity = perPageLimit === null ? Number.POSITIVE_INFINITY : perPageLimit;
    const selectedCount = Math.min(eligible.length, remainingGlobal, pageCapacity);
    const selected = eligible.slice(0, selectedCount);
    totals.totalSeleccionado += selected.length;
    const pageData = {
      paginaMediWeb,
      signature,
      detected: rawDetected,
      duplicateCount: Math.max(0, duplicateCount),
      unique,
      eligible,
      excluded,
      selected,
    };
    await onPageClassified(pageData, snapshot(totals));

    for (const item of selected) {
      if (isInterrupted()) break;
      const fileOrder = totals.totalProcesado + 1;
      const result = await processAttention(item, { fileOrder, paginaMediWeb });
      totals.totalProcesado += 1;
      await onAttentionProcessed(result, pageData, snapshot(totals));
    }
    await onPageCompleted(pageData, snapshot(totals));

    if (isInterrupted()) {
      motivoFinalizacion = "cancelado";
      break;
    }
    if (limit !== null && totals.totalSeleccionado >= limit) {
      motivoFinalizacion = "limite_alcanzado";
      break;
    }
    if (singlePage) {
      motivoFinalizacion = "single_page";
      break;
    }
    if (maxPages !== null && totals.totalPaginasVisitadas >= maxPages) {
      motivoFinalizacion = "max_pages_alcanzado";
      break;
    }

    const next = await advance({ previousSignature: signature, pageNumber: paginaMediWeb, recoveryTraversal: false });
    if (next.status === "last_page") {
      motivoFinalizacion = "ultima_pagina";
      break;
    }
    if (next.status !== "advanced") {
      motivoFinalizacion = "error_paginacion";
      break;
    }
    extraction = next.extraction;
    allowVisited = Boolean(next.allowVisited);
  }

  if (isInterrupted()) motivoFinalizacion = "cancelado";
  return { totals: snapshot(totals), motivoFinalizacion, visitedSignatures, seenAttentions };
}
