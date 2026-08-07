import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { parseArgs } from "./args.js";
import { launchBrowser, closeQuietly } from "./browser.js";
import {
  createCli,
  printAptitudDiagnostic,
  printAptitudExtractionError,
  printManualNavigationInstructions,
  printProcessingSummary,
} from "./cli.js";
import { extractVisibleReports } from "./mediwebTable.js";
import { goToNextResultsPage } from "./pagination.js";
import { runPaginatedWorkflow } from "./paginationWorkflow.js";
import { isSessionExpired, restoreSession } from "./session.js";
import { waitForReportReady } from "./reportLoader.js";
import { appendFirstPage, createReportPdf, validatePdf } from "./pdfGenerator.js";
import { uniqueReportPath } from "./fileNames.js";
import { createOutputPaths, removeTmpIfEmpty } from "./paths.js";
import {
  applyPaginationTotals,
  createExcludedEntry,
  createManifest,
  isAptitudExtractionFailure,
  relativeOutputPath,
  saveControl,
  selectAttentions,
  summarizeManifest,
} from "./manifest.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = {
  cli: null,
  context: null,
  mainPage: null,
  manifest: null,
  paths: null,
  interrupted: false,
  shuttingDown: false,
  sessionRecoveryPending: false,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  state.cli = createCli();
  ({ context: state.context, mainPage: state.mainPage } = await launchBrowser(moduleRoot));
  printManualNavigationInstructions();
  await state.cli.enter("");

  const firstExtraction = await detectReportsWithRetry();
  if (!firstExtraction) return;
  const firstSelection = selectAttentions(firstExtraction.atenciones, null);
  console.log(`\nAtenciones con Imp S.F encontradas en la página actual: ${firstSelection.totalDetectado}`);
  printAptitudDiagnostic(firstSelection);
  if (isAptitudExtractionFailure(firstSelection)) {
    printAptitudExtractionError(firstSelection.totalDetectado, firstExtraction.encabezadosEncontrados);
    return;
  }

  const mode = options.mode ?? await state.cli.chooseMode();
  if (!mode) return;
  state.paths = await createOutputPaths(moduleRoot, options.output, mode);
  printProcessingSummary({
    selection: firstSelection,
    limit: options.limit,
    perPageLimit: options.perPageLimit,
    mode,
    outputDirectory: state.paths.root,
    singlePage: options.singlePage,
    maxPages: options.maxPages,
  });
  if (!await state.cli.confirm("\n¿Iniciar procesamiento?")) return;

  state.manifest = createManifest({
    mode,
    limit: options.limit,
    perPageLimit: options.perPageLimit,
    outputDirectory: state.paths.root,
    singlePage: options.singlePage,
    maxPages: options.maxPages,
  });
  await saveControl(state.manifest, state.paths);
  const consolidated = mode === "first" || mode === "both" ? await PDFDocument.create() : null;

  const workflow = await runPaginatedWorkflow({
    firstExtraction,
    limit: options.limit,
    perPageLimit: options.perPageLimit,
    maxPages: options.maxPages,
    singlePage: options.singlePage,
    isInterrupted: () => state.interrupted,
    onPageClassified: async (pageData, totals) => {
      console.log(`\n================================\nPágina de MediWeb ${pageData.paginaMediWeb}\n================================`);
      console.log(`\nDetectadas en página: ${pageData.detected}\nElegibles nuevas: ${pageData.eligible.length}\nSeleccionadas para esta página: ${pageData.selected.length}\nDuplicadas: ${pageData.duplicateCount}\nExcluidas: ${pageData.excluded.length}\n`);
      state.manifest.atenciones.push(...pageData.excluded.map(createExcludedEntry));
      state.manifest.pages.push({
        paginaMediWeb: pageData.paginaMediWeb,
        detectadas: pageData.detected,
        elegibles: pageData.eligible.length,
        seleccionadas: pageData.selected.length,
        excluidas: pageData.excluded.length,
        duplicadas: pageData.duplicateCount,
      });
      applyPaginationTotals(state.manifest, totals);
      await saveControl(state.manifest, state.paths);
    },
    processAttention: async (report, { fileOrder, paginaMediWeb }) => {
      console.log(`[${fileOrder}] Procesando ${report.codigo ? `código ${report.codigo}` : `atención ${fileOrder}`}`);
      const result = await processReport({
        report,
        order: report.ordenDetectado,
        fileOrder,
        paginaMediWeb,
        mode,
        consolidated,
      });
      return result;
    },
    onAttentionProcessed: async (result, pageData, totals) => {
      state.manifest.atenciones.push(result);
      applyPaginationTotals(state.manifest, totals);
      summarizeManifest(state.manifest);
      if (consolidated && consolidated.getPageCount() > 0) {
        await writeFile(state.paths.consolidated, await consolidated.save());
      }
      await saveControl(state.manifest, state.paths);
      if (!state.interrupted) await new Promise((resolve) => setTimeout(resolve, options.delay));
    },
    onPageCompleted: async (pageData, totals) => {
      applyPaginationTotals(state.manifest, totals);
      state.manifest.pagination.ultimaPaginaCompletada = pageData.paginaMediWeb;
      console.log(`Página ${pageData.paginaMediWeb} completada.`);
      await saveControl(state.manifest, state.paths);
    },
    onWarning: async (warning) => {
      console.warn(`\n${warning}`);
      state.manifest.warnings.push(warning);
      await saveControl(state.manifest, state.paths);
    },
    advance: async ({ previousSignature, pageNumber, recoveryTraversal }) => {
      if (state.sessionRecoveryPending) {
        state.sessionRecoveryPending = false;
        const recovered = await detectReportsWithRetry();
        return recovered
          ? { status: "advanced", extraction: recovered, allowVisited: true }
          : { status: "error" };
      }

      console.log(recoveryTraversal ? "Avanzando por una página ya registrada..." : "Avanzando a siguiente página...");
      const next = await goToNextResultsPage(state.mainPage, previousSignature, {
        expectedPageNumber: pageNumber + 1,
      });
      if (next.status !== "error" || !await isSessionExpired(state.mainPage)) {
        return recoveryTraversal && next.status === "advanced" ? { ...next, allowVisited: true } : next;
      }

      await restoreSession({ mainPage: state.mainPage, cli: state.cli });
      const recovered = await detectReportsWithRetry();
      return recovered
        ? { status: "advanced", extraction: recovered, allowVisited: true }
        : { status: "error" };
    },
  });

  applyPaginationTotals(state.manifest, workflow.totals);
  state.manifest.pagination.motivoFinalizacion = workflow.motivoFinalizacion;
  if (workflow.motivoFinalizacion === "error_paginacion") {
    console.error("\nNo fue posible avanzar a la siguiente página de MediWeb.\nLos reportes ya procesados fueron conservados.");
  }
  state.manifest.fechaFin = new Date().toISOString();
  state.manifest.estadoEjecucion = state.interrupted ? "cancelado"
    : workflow.motivoFinalizacion === "error_paginacion" ? "error" : "completado";
  summarizeManifest(state.manifest);
  await saveControl(state.manifest, state.paths);
  await removeTmpIfEmpty(state.paths.tmp);
  console.log(`\nProceso ${state.interrupted ? "cancelado" : "finalizado"}. Resultados conservados en:\n${state.paths.root}`);
}

async function detectReportsWithRetry() {
  while (!state.interrupted) {
    if (await isSessionExpired(state.mainPage)) {
      await restoreSession({ mainPage: state.mainPage, cli: state.cli });
    }
    const extraction = await extractVisibleReports(state.mainPage);
    if (extraction.atenciones.length > 0) return extraction;
    const answer = (await state.cli.enter("\nNo se encontraron reportes Imp S.F.\n\nComprueba que:\n- hayas iniciado sesión;\n- estés en Atenciones → Ocupacional;\n- hayas seleccionado los filtros;\n- hayas pulsado Buscar;\n- existan atenciones en los resultados.\n\nCuando la tabla esté lista, presiona Enter para volver a intentar.\nEscribe C para cancelar.\n")).trim().toLowerCase();
    if (answer === "c") return null;
  }
  return null;
}

async function processReport({ report, order, fileOrder, paginaMediWeb, mode, consolidated }) {
  const entry = {
    orden: order,
    paginaMediWeb,
    codigo: report.codigo,
    fecha: report.fecha,
    empresa: report.empresa,
    subcontrata: report.subcontrata,
    paciente: report.paciente,
    tipoExamen: report.tipoExamen,
    tipoDocumento: report.tipoDocumento,
    aptitud: report.aptitud,
    categoriaAptitud: report.aptitudClassification.category,
    idcomprobante: report.idcomprobante,
    idpaciente: report.idpaciente,
    estado: "error_carga",
    archivoCompleto: "",
    paginaConsolidado: "",
    intentos: 0,
    mensajeError: "",
  };
  let lastCategory = "error_carga";

  for (let attempt = 1; attempt <= 2 && !state.interrupted; attempt += 1) {
    entry.intentos = attempt;
    let reportPage;
    try {
      reportPage = await state.context.newPage();
      await reportPage.goto(report.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      const readiness = await waitForReportReady(reportPage);
      if (readiness.sessionExpired) {
        lastCategory = "sesion_expirada";
        await closeQuietly(reportPage);
        reportPage = null;
        await restoreSession({ mainPage: state.mainPage, cli: state.cli });
        state.sessionRecoveryPending = true;
        continue;
      }
      if (!readiness.ready) {
        lastCategory = "error_validacion";
        throw new ProcessingError("No apareció el título esperado del reporte médico.", lastCategory);
      }

      const firstOnly = mode === "first";
      let buffer;
      let document;
      try {
        buffer = await createReportPdf(reportPage, firstOnly);
        ({ document } = await validatePdf(buffer, firstOnly ? 1 : null));
      } catch (error) {
        throw new ProcessingError(error instanceof Error ? error.message : String(error), "error_pdf");
      }
      if (mode === "full" || mode === "both") {
        const output = await uniqueReportPath(state.paths.full, report, fileOrder);
        await writeFile(output.absolute, buffer);
        entry.archivoCompleto = relativeOutputPath(state.paths.root, output.absolute);
        state.manifest.reportesCompletosGenerados += 1;
      }
      if (mode === "first" || mode === "both") {
        entry.paginaConsolidado = await appendFirstPage(consolidated, document);
        state.manifest.primerasHojasAgregadas += 1;
      }
      entry.estado = "correcto";
      entry.mensajeError = "";
      await closeQuietly(reportPage);
      return entry;
    } catch (error) {
      await closeQuietly(reportPage);
      if (error instanceof ProcessingError) lastCategory = error.category;
      else if (/pdf/i.test(error.message)) lastCategory = "error_pdf";
      else if (/timeout|navigation|net::/i.test(error.message)) lastCategory = "error_carga";
      entry.mensajeError = safeErrorMessage(error);
    }
  }
  entry.estado = state.interrupted ? "cancelado" : lastCategory;
  return entry;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/gi, "[URL omitida]").replace(/[\r\n]+/g, " ").slice(0, 500);
}

class ProcessingError extends Error {
  constructor(message, category) {
    super(message);
    this.category = category;
  }
}

async function shutdown(reason, exitCode = 0) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  state.interrupted = reason === "SIGINT" || reason === "SIGTERM";
  if (reason !== "complete" && state.manifest && state.paths) {
    state.manifest.fechaFin = new Date().toISOString();
    state.manifest.estadoEjecucion = state.interrupted ? "cancelado" : "error";
    if (state.interrupted && state.manifest.pagination) state.manifest.pagination.motivoFinalizacion = "cancelado";
    summarizeManifest(state.manifest);
    try { await saveControl(state.manifest, state.paths); } catch { /* conservar lo ya escrito */ }
  }
  state.cli?.close();
  await closeQuietly(state.context);
  process.exitCode = exitCode;
}

process.once("SIGINT", () => { shutdown("SIGINT", 130); });
process.once("SIGTERM", () => { shutdown("SIGTERM", 143); });

try {
  await main();
  await shutdown("complete", 0);
} catch (error) {
  console.error(`\nError: ${safeErrorMessage(error)}`);
  await shutdown("error", 1);
}
