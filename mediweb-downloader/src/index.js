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
import { isSessionExpired, restoreSession } from "./session.js";
import { waitForReportReady } from "./reportLoader.js";
import { appendFirstPage, createReportPdf, validatePdf } from "./pdfGenerator.js";
import { uniqueReportPath } from "./fileNames.js";
import { createOutputPaths, removeTmpIfEmpty } from "./paths.js";
import {
  createManifest,
  isAptitudExtractionFailure,
  relativeOutputPath,
  saveControl,
  selectAttentions,
  summarizeManifest,
} from "./manifest.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = { cli: null, context: null, mainPage: null, manifest: null, paths: null, interrupted: false, shuttingDown: false };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  state.cli = createCli();
  ({ context: state.context, mainPage: state.mainPage } = await launchBrowser(moduleRoot));
  printManualNavigationInstructions();
  await state.cli.enter("");

  const extraction = await detectReportsWithRetry();
  if (!extraction) return;
  const selection = selectAttentions(extraction.atenciones, options.limit);
  console.log(`\nAtenciones con Imp S.F encontradas: ${selection.totalDetectado}`);
  printAptitudDiagnostic(selection);
  if (isAptitudExtractionFailure(selection)) {
    printAptitudExtractionError(selection.totalDetectado, extraction.encabezadosEncontrados);
    return;
  }

  const mode = options.mode ?? await state.cli.chooseMode();
  if (!mode) return;
  state.paths = await createOutputPaths(moduleRoot, options.output, mode);
  printProcessingSummary({ selection, limit: options.limit, mode, outputDirectory: state.paths.root });
  if (!await state.cli.confirm("\n¿Iniciar procesamiento?")) return;

  state.manifest = createManifest({
    mode,
    limit: options.limit,
    selection,
    outputDirectory: state.paths.root,
  });
  await saveControl(state.manifest, state.paths);
  const consolidated = mode === "first" || mode === "both" ? await PDFDocument.create() : null;

  for (let index = 0; index < selection.totalSeleccionado && !state.interrupted; index += 1) {
    const report = selection.atencionesSeleccionadas[index];
    const processingOrder = index + 1;
    console.log(`[${processingOrder}/${selection.totalSeleccionado}] Procesando ${report.codigo ? `código ${report.codigo}` : `atención ${processingOrder}`}`);
    const result = await processReport({
      report,
      order: report.ordenDetectado,
      fileOrder: processingOrder,
      mode,
      consolidated,
    });
    state.manifest.atenciones.push(result);
    summarizeManifest(state.manifest);
    if (consolidated && consolidated.getPageCount() > 0) await writeFile(state.paths.consolidated, await consolidated.save());
    await saveControl(state.manifest, state.paths);
    if (index < selection.totalSeleccionado - 1 && !state.interrupted) await new Promise((resolve) => setTimeout(resolve, options.delay));
  }

  state.manifest.fechaFin = new Date().toISOString();
  state.manifest.estadoEjecucion = state.interrupted ? "cancelado" : "completado";
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

async function processReport({ report, order, fileOrder, mode, consolidated }) {
  const entry = {
    orden: order, codigo: report.codigo, fecha: report.fecha, empresa: report.empresa,
    subcontrata: report.subcontrata, paciente: report.paciente, tipoExamen: report.tipoExamen,
    tipoDocumento: report.tipoDocumento, aptitud: report.aptitud,
    categoriaAptitud: report.aptitudClassification.category, idcomprobante: report.idcomprobante,
    idpaciente: report.idpaciente, estado: "error_carga", archivoCompleto: "", paginaConsolidado: "",
    intentos: 0, mensajeError: "",
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
        continue;
      }
      if (!readiness.ready) {
        lastCategory = "error_validacion";
        throw new ProcessingError("No aparecio el titulo esperado del reporte medico.", lastCategory);
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
  if (state.manifest && state.paths) {
    state.manifest.fechaFin = new Date().toISOString();
    state.manifest.estadoEjecucion = state.interrupted ? "cancelado" : "error";
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
