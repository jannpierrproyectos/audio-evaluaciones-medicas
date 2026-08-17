import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

const MODES = new Set(["first", "full", "both"]);
const INTEGER_FIELDS = ["limit", "maxPages", "perPageLimit"];

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateJobOptions(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_REQUEST", "El cuerpo debe ser un objeto JSON.");
  }
  const allowed = new Set(["mode", "limit", "maxPages", "perPageLimit", "singlePage"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new HttpError(400, "INVALID_REQUEST", `Parámetro no permitido: ${unknown[0]}.`);
  if (!MODES.has(body.mode)) throw new HttpError(400, "INVALID_MODE", "mode debe ser first, full o both.");

  const options = { mode: body.mode, limit: null, maxPages: null, perPageLimit: null, singlePage: false, delay: 900 };
  for (const field of INTEGER_FIELDS) {
    const value = body[field] ?? null;
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      throw new HttpError(400, "INVALID_REQUEST", `${field} debe ser null o un entero mayor que cero.`);
    }
    options[field] = value;
  }
  if (body.singlePage !== undefined && typeof body.singlePage !== "boolean") {
    throw new HttpError(400, "INVALID_REQUEST", "singlePage debe ser booleano.");
  }
  options.singlePage = body.singlePage ?? false;
  if (options.singlePage && options.maxPages !== null) {
    throw new HttpError(400, "INVALID_REQUEST", "singlePage y maxPages no pueden combinarse.");
  }
  return options;
}

export class JobManager {
  constructor({ engine, events = null, logger = null }) {
    this.engine = engine;
    this.events = events;
    this.logger = logger;
    this.jobs = new Map();
    this.activeJobId = null;
  }

  get hasActiveJob() {
    return this.activeJobId !== null;
  }

  create(options) {
    if (this.hasActiveJob) throw new HttpError(409, "JOB_ALREADY_RUNNING", "Ya existe un trabajo en ejecución.");
    const id = randomUUID();
    const controller = new AbortController();
    const job = {
      id,
      status: "running",
      mode: options.mode,
      currentPage: 0,
      detected: 0,
      unique: 0,
      eligible: 0,
      excluded: 0,
      selected: 0,
      processed: 0,
      fullReportsGenerated: 0,
      firstPagesAdded: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      finalReason: null,
      options,
      controller,
      result: null,
      completion: null,
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    this.events?.emit("job:started", { id });
    this.engine.resetCancellation?.();
    job.completion = Promise.resolve().then(() => this.#execute(job));
    return this.publicJob(job);
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "JOB_NOT_FOUND", "Trabajo no encontrado.");
    return job;
  }

  publicJob(job) {
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      currentPage: job.currentPage,
      detected: job.detected,
      unique: job.unique,
      eligible: job.eligible,
      excluded: job.excluded,
      selected: job.selected,
      processed: job.processed,
      fullReportsGenerated: job.fullReportsGenerated,
      firstPagesAdded: job.firstPagesAdded,
      errors: job.errors,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  async cancel(id) {
    const job = this.get(id);
    if (job.status !== "running") return this.publicJob(job);
    job.controller.abort();
    this.engine.cancel?.();
    await job.completion;
    return this.publicJob(job);
  }

  async waitForIdle() {
    const active = this.activeJobId ? this.jobs.get(this.activeJobId) : null;
    if (active?.completion) await active.completion;
  }

  manifest(id) {
    const job = this.get(id);
    const manifest = job.result?.manifest;
    return {
      status: job.status,
      totalPaginasVisitadas: manifest?.totalPaginasVisitadas ?? job.currentPage,
      totalDetectado: manifest?.totalDetectado ?? job.detected,
      totalUnico: manifest?.totalUnico ?? job.unique,
      totalElegible: manifest?.totalElegible ?? job.eligible,
      totalExcluido: manifest?.totalExcluido ?? job.excluded,
      totalSeleccionado: manifest?.totalSeleccionado ?? job.selected,
      totalProcesado: manifest?.totalProcesado ?? job.processed,
      reportesCompletosGenerados: manifest?.reportesCompletosGenerados ?? job.fullReportsGenerated,
      primerasHojasAgregadas: manifest?.primerasHojasAgregadas ?? job.firstPagesAdded,
      errores: manifest?.errores ?? job.errors,
      motivoFinalizacion: manifest?.pagination?.motivoFinalizacion ?? job.finalReason,
    };
  }

  workerMetadata(id) {
    const job = this.get(id);
    if (job.status === "running" || job.status === "idle") {
      throw new HttpError(409, "JOB_NOT_FINISHED", "El trabajo todavia esta procesando.");
    }
    if (job.status !== "completed") {
      throw new HttpError(409, "JOB_NOT_COMPLETED", "El trabajo no termino correctamente.");
    }
    return {
      mode: job.mode,
      workers: (job.result?.manifest?.atenciones ?? [])
        .filter((entry) => entry.estado === "correcto")
        .map((entry) => ({
          numeroDocumento: entry.numeroDocumento || "",
          paginaConsolidado: entry.paginaConsolidado || "",
          telefono: entry.telefono || "",
          archivoPdfCompleto: entry.archivoPdfCompleto || "",
        })),
    };
  }

  async firstPagesPath(id) {
    const job = this.get(id);
    if (job.status === "running" || job.status === "idle") {
      throw new HttpError(409, "JOB_NOT_FINISHED", "El trabajo todavía está procesando.");
    }
    if (job.status !== "completed") {
      throw new HttpError(409, "JOB_NOT_COMPLETED", "El trabajo no terminó correctamente.");
    }
    const file = job.result?.paths?.consolidated;
    if (!file || !["first", "both"].includes(job.mode)) {
      throw new HttpError(404, "FIRST_PAGES_NOT_FOUND", "No existe primeras-hojas.pdf para este trabajo.");
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      throw new HttpError(404, "FIRST_PAGES_NOT_FOUND", "No existe primeras-hojas.pdf para este trabajo.");
    }
    return file;
  }

  async #execute(job) {
    try {
      const result = await this.engine.run(job.options, {
        isCancelled: () => job.controller.signal.aborted,
        onProgress: (event) => this.#update(job, event),
      });
      job.result = result;
      job.status = job.controller.signal.aborted || result.status === "cancelled" ? "cancelled" : result.status;
      job.finalReason = result.manifest?.pagination?.motivoFinalizacion ?? null;
      this.#updateFromManifest(job, result.manifest);
    } catch (error) {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.finalReason = job.status === "cancelled" ? "cancelado" : "error_ejecucion";
      this.logger?.error?.("El procesamiento terminó con error.", error);
    } finally {
      job.finishedAt = new Date().toISOString();
      if (this.activeJobId === job.id) this.activeJobId = null;
      this.events?.emit(`job:${job.status}`, { id: job.id, status: job.status });
    }
  }

  #update(job, event) {
    if (event.currentPage !== undefined && event.currentPage !== null) job.currentPage = event.currentPage;
    const totals = event.totals;
    if (totals) {
      job.detected = totals.totalDetectado ?? job.detected;
      job.unique = totals.totalUnico ?? job.unique;
      job.eligible = totals.totalElegible ?? job.eligible;
      job.excluded = totals.totalExcluido ?? job.excluded;
      job.selected = totals.totalSeleccionado ?? job.selected;
      job.processed = totals.totalProcesado ?? job.processed;
    }
    this.#updateFromManifest(job, event.manifest);
  }

  #updateFromManifest(job, manifest) {
    if (!manifest) return;
    job.detected = manifest.totalDetectado ?? job.detected;
    job.unique = manifest.totalUnico ?? job.unique;
    job.eligible = manifest.totalElegible ?? job.eligible;
    job.excluded = manifest.totalExcluido ?? job.excluded;
    job.selected = manifest.totalSeleccionado ?? job.selected;
    job.processed = manifest.totalProcesado ?? job.processed;
    job.fullReportsGenerated = manifest.reportesCompletosGenerados ?? job.fullReportsGenerated;
    job.firstPagesAdded = manifest.primerasHojasAgregadas ?? job.firstPagesAdded;
    job.errors = manifest.errores ?? job.errors;
  }
}
