import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { launchBrowser, closeQuietly, MEDIWEB_URL } from "./browser.js";
import { extractVisibleReports } from "./mediwebTable.js";
import { getCurrentPageNumber, goToNextResultsPage, hasValidResultsTable } from "./pagination.js";
import { runPaginatedWorkflow } from "./paginationWorkflow.js";
import { isSessionExpired } from "./session.js";
import { waitForReportReady } from "./reportLoader.js";
import { appendFirstPage, createReportPdf, validatePdf } from "./pdfGenerator.js";
import { uniqueReportPath } from "./fileNames.js";
import { extractOperationalDataFromPdf } from "./phoneExtractor.js";
import { createOutputPaths, removeTmpIfEmpty } from "./paths.js";
import { getRuntimePaths } from "./paths.js";
import { protectExportDirectory } from "./windowsProtection.js";
import {
  applyPaginationTotals,
  createExcludedEntry,
  createManifest,
  isAptitudExtractionFailure,
  relativeOutputPath,
  saveControl,
  selectAttentions,
  summarizeManifest,
  writeAtomicOutput,
} from "./manifest.js";

const defaultModuleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class ResultsNotReadyError extends Error {
  constructor() {
    super("Realiza la búsqueda en MediWeb antes de continuar.");
    this.code = "RESULTS_NOT_READY";
  }
}

export class DownloaderRunner {
  constructor({ moduleRoot = defaultModuleRoot, logger = console, runtimePaths = null, events = null } = {}) {
    this.moduleRoot = moduleRoot;
    this.logger = logger;
    this.runtimePaths = runtimePaths ?? getRuntimePaths({ moduleRoot, packaged: false });
    this.events = events;
    this.context = null;
    this.mainPage = null;
    this.manifest = null;
    this.paths = null;
    this.cancelled = false;
    this.sessionRecoveryPending = false;
    this.sessionExpired = false;
    this.writeOutput = writeAtomicOutput;
    this.protectOutput = null;
  }

  get browserOpen() {
    if (!this.context || !this.mainPage) return false;
    try { return !this.mainPage.isClosed(); } catch { return false; }
  }

  async open() {
    if (this.browserOpen) {
      await this.mainPage.bringToFront().catch(() => {});
      this.events?.emit("browser:opened");
      return { browserOpen: true };
    }
    await closeQuietly(this.context);
    try {
      ({ context: this.context, mainPage: this.mainPage } = await launchBrowser(this.runtimePaths));
      this.events?.emit("browser:opened");
    } catch (error) {
      this.events?.emit("browser:error", { code: error?.code ?? "BROWSER_ERROR" });
      throw error;
    }
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

  async selectResultsPage() {
    // A search may open in another tab of the Connector's browser. Do not read
    // an unrelated browser, navigate away, or choose between two result sets.
    const candidates = [];
    for (const page of this.context?.pages() || []) {
      if (page.isClosed()) continue;
      let sameOrigin = false;
      try { sameOrigin = new URL(page.url()).origin === new URL(MEDIWEB_URL).origin; } catch { /* Blank tab. */ }
      if (sameOrigin && !await isSessionExpired(page) && await hasValidResultsTable(page)) candidates.push(page);
    }
    if (candidates.length > 1) throw Object.assign(new Error("Hay varias pestañas de resultados de MediWeb abiertas. Deja abierta la que deseas procesar."), { code: "SEARCH_MULTIPLE_RESULTS", status: 409 });
    if (candidates.length === 1) this.mainPage = candidates[0];
  }

  async inspectResults() {
    await this.selectResultsPage();
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
    this.sessionExpired = false;
    const isCancelled = () => this.cancelled || Boolean(hooks.isCancelled?.());
    const onProgress = hooks.onProgress ?? (() => {});
    const inspection = hooks.firstExtraction
      ? { ready: true, extraction: hooks.firstExtraction }
      : await this.inspectResults();
    if (!inspection.ready || inspection.extraction.atenciones.length === 0) throw new ResultsNotReadyError();
    await hooks.validateExtraction?.(inspection.extraction);

    this.paths = hooks.paths ?? await createOutputPaths(this.moduleRoot, options.output ?? null, options.mode, this.runtimePaths);
    if (hooks.beforeOutput) await hooks.beforeOutput(this.paths);
    else if (this.protectOutput) await this.protectOutput(this.paths);
    else if (this.runtimePaths.packaged) {
      try { for (const directory of [this.paths.root, this.paths.control, this.paths.tmp, this.paths.full, this.paths.audio].filter(Boolean)) await protectExportDirectory(directory); }
      catch { throw Object.assign(new Error("No se pueden proteger los archivos de salida. Revisa EFS y los permisos de Windows."), { code: "OUTPUT_PROTECTION_UNAVAILABLE" }); }
    }
    this.manifest = createManifest({
      mode: options.mode,
      limit: options.limit,
      perPageLimit: options.perPageLimit,
      outputDirectory: this.paths.root,
      singlePage: options.singlePage,
      maxPages: options.maxPages,
    });
    await saveControl(this.manifest, this.paths, this.writeOutput);
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
          await hooks.validateExtraction?.({ atenciones: [...pageData.eligible, ...pageData.excluded] });
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
          await saveControl(this.manifest, this.paths, this.writeOutput);
          onProgress({ type: "page_started", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
        },
        processAttention: async (report, { fileOrder, paginaMediWeb }) => {
          this.logger.log(`[${fileOrder}] Procesando atención ${fileOrder}`);
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
            await this.writeOutput(this.paths.consolidated, await consolidated.save());
          }
          await saveControl(this.manifest, this.paths, this.writeOutput);
          onProgress({ type: result.estado === "correcto" ? "report_completed" : "report_failed", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
          if (!isCancelled() && (options.delay ?? 900) > 0) {
            await new Promise((resolve) => setTimeout(resolve, options.delay ?? 900));
          }
        },
        onPageCompleted: async (pageData, totals) => {
          applyPaginationTotals(this.manifest, totals);
          this.manifest.pagination.ultimaPaginaCompletada = pageData.paginaMediWeb;
          this.logger.log(`Página ${pageData.paginaMediWeb} completada.`);
          await saveControl(this.manifest, this.paths, this.writeOutput);
          onProgress({ type: "page_completed", currentPage: pageData.paginaMediWeb, totals, manifest: this.manifest });
        },
        onWarning: async (warning) => {
          this.logger.warn(`\n${warning}`);
          this.manifest.warnings.push(warning);
          await saveControl(this.manifest, this.paths, this.writeOutput);
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
    return { status, manifest: this.manifest, paths: this.paths, errorCode: this.sessionExpired ? "SESSION_EXPIRED" : null };
  }

  async #recoverAndExtract(onSessionExpired) {
    if (!onSessionExpired) throw Object.assign(new Error("La sesión de MediWeb expiró. Inicia sesión manualmente y recupera los resultados guardados."), { code: "SESSION_EXPIRED" });
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
    await saveControl(this.manifest, this.paths, this.writeOutput);
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
      telefono: "",
      numeroDocumento: "",
      archivoCompleto: "",
      archivoPdfCompleto: "",
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
          await this.writeOutput(output.absolute, buffer);
          entry.archivoCompleto = relativeOutputPath(this.paths.root, output.absolute);
          entry.archivoPdfCompleto = output.relative;
          await this.onDocument?.(buffer, report.paciente);
          try {
            const operationalData = await extractOperationalDataFromPdf(buffer);
            entry.telefono = operationalData.telefono;
            entry.numeroDocumento = operationalData.numeroDocumento;
          } catch {
            // Un dato operativo ausente nunca invalida el PDF ni la atencion.
          }
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
        if (lastCategory === "sesion_expirada" && !onSessionExpired) { this.sessionExpired = true; this.cancelled = true; break; }
        if (error instanceof ProcessingError) lastCategory = error.category;
        else if (/pdf/i.test(error.message)) lastCategory = "error_pdf";
        else if (/timeout|navigation|net::/i.test(error.message)) lastCategory = "error_carga";
        entry.mensajeError = safeErrorMessage(error);
      }
    }
    entry.estado = lastCategory === "sesion_expirada" ? lastCategory : isCancelled() ? "cancelado" : lastCategory;
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
