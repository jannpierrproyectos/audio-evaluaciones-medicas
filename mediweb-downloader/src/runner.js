import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { launchBrowser, closeQuietly } from "./browser.js";
import { extractVisibleReports } from "./mediwebTable.js";
import { getCurrentPageNumber, goToNextResultsPage, hasValidResultsTable } from "./pagination.js";
import { runPaginatedWorkflow } from "./paginationWorkflow.js";
import { isSessionExpired } from "./session.js";
import { waitForReportReady } from "./reportLoader.js";
import { appendFirstPage, createReportPdf, validatePdf } from "./pdfGenerator.js";
import { uniqueReportPath } from "./fileNames.js";
import { createOutputPaths, removeTmpIfEmpty } from "./paths.js";
import { getRuntimePaths } from "./paths.js";
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

const defaultModuleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class ResultsNotReadyError extends Error {
  constructor() {
    super("Realiza la búsqueda en MediWeb antes de continuar.");
    this.code = "RESULTS_NOT_READY";
  }
}

export class DownloaderRunner {
  constructor({ moduleRoot = defaultModuleRoot, logger = console, runtimePaths = null } = {}) {
    this.moduleRoot = moduleRoot;
    this.logger = logger;
    this.runtimePaths = runtimePaths ?? getRuntimePaths({ moduleRoot, packaged: false });
    this.context = null;
    this.mainPage = null;
    this.manifest = null;
    this.paths = null;
    this.cancelled = false;
    this.sessionRecoveryPending = false;
  }

  get browserOpen() {
    if (!this.context || !this.mainPage) return false;
    try { return !this.mainPage.isClosed(); } catch { return false; }
  }

  async open() {
    if (this.browserOpen) return { browserOpen: true };
    await closeQuietly(this.context);
    ({ context: this.context, mainPage: this.mainPage } = await launchBrowser(this.runtimePaths));
    return { browserOpen: true };
  }

  async close() {
    await closeQuietly(this.context);
    this.context = null;
    this.mainPage = null;
  }

  cancel() {
    this.cancelled = true;
  }

  resetCancellation() {
    this.cancelled = false;
  }

  async inspectResults() {
    if (!this.browserOpen) return { ready: false };
    const validTable = await hasValidResultsTable(this.mainPage);
    if (!validTable) return { ready: false };
    const extraction = await extractVisibleReports(this.mainPage);
    const selection = selectAttentions(extraction.atenciones, null);
    return {
      ready: true,
      extraction,
      selection,
      aptitudFailure: isAptitudExtractionFailure(selection),
    };
  }

  async detectSummary() {
    const inspection = await this.inspectResults();
    if (!inspection.ready || inspection.extraction.atenciones.length === 0 || inspection.aptitudFailure) {
      throw new ResultsNotReadyError();
    }
    const { selection } = inspection;
    return {
      page: await getCurrentPageNumber(this.mainPage) ?? 1,
      detected: selection.totalDetectado,
      eligible: selection.totalElegible,
      excluded: {
        observado: selection.excluidosObservado,
        pendiente: selection.excluidosPendiente,
        noApto: selection.excluidosNoApto,
        otros: selection.excluidosOtros,
      },
    };
  }

  async run(options, hooks = {}) {
    if (!this.browserOpen) throw new ResultsNotReadyError();
    this.sessionRecoveryPending = false;
    const isCancelled = () => this.cancelled || Boolean(hooks.isCancelled?.());
    const onProgress = hooks.onProgress ?? (() => {});
    const inspection = hooks.firstExtraction
      ? { ready: true, extraction: hooks.firstExtraction }
      : await this.inspectResults();
    if (!inspection.ready || inspection.extraction.atenciones.length === 0) throw new ResultsNotReadyError();

    this.paths = hooks.paths ?? await createOutputPaths(this.moduleRoot, options.output ?? null, options.mode, this.runtimePaths);
    this.manifest = createManifest({
      mode: options.mode,
      limit: options.limit,
      perPageLimit: options.perPageLimit,
      outputDirectory: this.paths.root,
      singlePage: options.singlePage,
      maxPages: options.maxPages,
    });
    await saveControl(this.manifest, this.paths);
    const consolidated = options.mode === "first" || options.mode === "both" ? await PDFDocument.create() : null;
    let workflow;

    try {
      workflow = await runPaginatedWorkflow({
        firstExtraction: inspection.extraction,
        limit: options.limit,
        perPageLimit: options.perPageLimit,
        maxPages: options.maxPages,
        singlePage: options.singlePage,
        isInterrupted: isCancelled,
        onPageClassified: async (pageData, totals) => {
          this.logger.log(`\n================================\nPágina de MediWeb ${pageData.paginaMediWeb}\n================================`);
          this.logger.log(`\nDetectadas en página: ${pageData.detected}\nElegibles nuevas: ${pageData.eligible.length}\nSeleccionadas para esta página: ${pageData.selected.length}\nDuplicadas: ${pageData.duplicateCount}\nExcluidas: ${pageData.excluded.length}\n`);
          this.manifest.atenciones.push(...pageData.excluded.map(createExcludedEntry));
          this.manifest.pages.push({
            paginaMediWeb: pageData.paginaMediWeb,
            detectadas: pageData.detected,
            elegibles: pageData.eligible.length,
            seleccionadas: pageData.selected.length,
            excluidas: pageData.excluded.length,
            duplicadas: pageData.duplicateCount,
          });
          applyPaginationTotals(this.manifest, totals);
          await saveControl(this.manifest, this.paths);
          onProgress({ type: "page_started", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
        },
        processAttention: async (report, { fileOrder, paginaMediWeb }) => {
          this.logger.log(`[${fileOrder}] Procesando ${report.codigo ? `código ${report.codigo}` : `atención ${fileOrder}`}`);
          onProgress({ type: "report_started", currentPage: paginaMediWeb, totals: null, manifest: this.manifest });
          return this.#processReport({
            report,
            order: report.ordenDetectado,
            fileOrder,
            paginaMediWeb,
            mode: options.mode,
            consolidated,
            isCancelled,
            onSessionExpired: hooks.onSessionExpired,
          });
        },
        onAttentionProcessed: async (result, pageData, totals) => {
          this.manifest.atenciones.push(result);
          applyPaginationTotals(this.manifest, totals);
          summarizeManifest(this.manifest);
          if (consolidated && consolidated.getPageCount() > 0) {
            await writeFile(this.paths.consolidated, await consolidated.save());
          }
          await saveControl(this.manifest, this.paths);
          onProgress({ type: result.estado === "correcto" ? "report_completed" : "report_failed", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
          if (!isCancelled() && (options.delay ?? 900) > 0) {
            await new Promise((resolve) => setTimeout(resolve, options.delay ?? 900));
          }
        },
        onPageCompleted: async (pageData, totals) => {
          applyPaginationTotals(this.manifest, totals);
          this.manifest.pagination.ultimaPaginaCompletada = pageData.paginaMediWeb;
          this.logger.log(`Página ${pageData.paginaMediWeb} completada.`);
          await saveControl(this.manifest, this.paths);
          onProgress({ type: "page_completed", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
        },
        onWarning: async (warning) => {
          this.logger.warn(`\n${warning}`);
          this.manifest.warnings.push(warning);
          await saveControl(this.manifest, this.paths);
        },
        advance: async ({ previousSignature, pageNumber, recoveryTraversal }) => {
          if (this.sessionRecoveryPending) {
            this.sessionRecoveryPending = false;
            const recovered = await this.#recoverAndExtract(hooks.onSessionExpired);
            return recovered ? { status: "advanced", extraction: recovered, allowVisited: true } : { status: "error" };
          }
          this.logger.log(recoveryTraversal ? "Avanzando por una página ya registrada..." : "Avanzando a siguiente página...");
          const next = await goToNextResultsPage(this.mainPage, previousSignature, { expectedPageNumber: pageNumber + 1 });
          if (next.status !== "error" || !await isSessionExpired(this.mainPage)) {
            return recoveryTraversal && next.status === "advanced" ? { ...next, allowVisited: true } : next;
          }
          const recovered = await this.#recoverAndExtract(hooks.onSessionExpired);
          return recovered ? { status: "advanced", extraction: recovered, allowVisited: true } : { status: "error" };
        },
      });
    } catch (error) {
      await this.#finalize("failed", "error_ejecucion");
      throw error;
    }

    const status = isCancelled() ? "cancelled"
      : workflow.motivoFinalizacion === "error_paginacion" ? "failed" : "completed";
    await this.#finalize(status, workflow.motivoFinalizacion, workflow.totals);
    onProgress({ type: status, currentPage: this.manifest.pagination.ultimaPaginaCompletada, totals: workflow.totals, manifest: this.manifest });
    return { status, manifest: this.manifest, paths: this.paths };
  }

  async #recoverAndExtract(onSessionExpired) {
    if (!onSessionExpired) throw new Error("La sesión de MediWeb expiró. Inicia sesión manualmente y vuelve a ejecutar el trabajo.");
    await onSessionExpired();
    if (this.cancelled) return null;
    const inspection = await this.inspectResults();
    return inspection.ready && inspection.extraction.atenciones.length > 0 ? inspection.extraction : null;
  }

  async #finalize(status, reason, totals = null) {
    if (!this.manifest || !this.paths) return;
    if (totals) applyPaginationTotals(this.manifest, totals);
    this.manifest.pagination.motivoFinalizacion = status === "cancelled" ? "cancelado" : reason;
    this.manifest.fechaFin = new Date().toISOString();
    this.manifest.estadoEjecucion = status === "cancelled" ? "cancelado" : status === "completed" ? "completado" : "error";
    summarizeManifest(this.manifest);
    await saveControl(this.manifest, this.paths);
    await removeTmpIfEmpty(this.paths.tmp);
  }

  async #processReport({ report, order, fileOrder, paginaMediWeb, mode, consolidated, isCancelled, onSessionExpired }) {
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

    for (let attempt = 1; attempt <= 2 && !isCancelled(); attempt += 1) {
      entry.intentos = attempt;
      let reportPage;
      try {
        reportPage = await this.context.newPage();
        await reportPage.goto(report.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
        const readiness = await waitForReportReady(reportPage);
        if (readiness.sessionExpired) {
          lastCategory = "sesion_expirada";
          await closeQuietly(reportPage);
          reportPage = null;
          if (!onSessionExpired) throw new ProcessingError("La sesión de MediWeb expiró.", lastCategory);
          await onSessionExpired();
          this.sessionRecoveryPending = true;
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
          const output = await uniqueReportPath(this.paths.full, report, fileOrder);
          await writeFile(output.absolute, buffer);
          entry.archivoCompleto = relativeOutputPath(this.paths.root, output.absolute);
          this.manifest.reportesCompletosGenerados += 1;
        }
        if (mode === "first" || mode === "both") {
          entry.paginaConsolidado = await appendFirstPage(consolidated, document);
          this.manifest.primerasHojasAgregadas += 1;
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
    entry.estado = isCancelled() ? "cancelado" : lastCategory;
    return entry;
  }
}

export function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/gi, "[URL omitida]").replace(/[\r\n]+/g, " ").slice(0, 500);
}

class ProcessingError extends Error {
  constructor(message, category) {
    super(message);
    this.category = category;
  }
}
