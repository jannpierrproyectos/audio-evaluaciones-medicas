import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import semver from "semver";

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const UPDATE_CACHE_MS = 5 * 60 * 1000;
export const UPDATE_MAX_BYTES = 200 * 1024 * 1024;
export const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
export const UPDATE_CONNECT_TIMEOUT_MS = 15 * 1000;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 256 * 1024;

export class UpdateError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "UpdateError";
    this.code = code;
    this.status = status;
  }
}

export function classifyConnectorVersion(installedVersion, manifest) {
  if (!semver.valid(installedVersion) || !manifest) return "unknown";
  if (semver.lt(installedVersion, manifest.minimumSupportedVersion)) return "update_required";
  if (semver.lt(installedVersion, manifest.latestVersion)) return "update_available";
  return "up_to_date";
}

export function isAllowedDownloadUrl(value, allowedHosts) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
}

export function validateReleaseManifest(value, { allowedHosts, releaseRepository = "jannpierrproyectos/audio-evaluaciones-medicas" }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidManifest();
  const { latestVersion, minimumSupportedVersion, windows, releaseNotesUrl } = value;
  if (value.product !== "AudioEvaluaciones Connector" || !semver.valid(latestVersion) || !semver.valid(minimumSupportedVersion)) throw invalidManifest();
  if (semver.gt(minimumSupportedVersion, latestVersion)) throw invalidManifest();
  if (!windows || windows.architecture !== "x64") throw invalidManifest();
  const expectedFile = `AudioEvaluacionesConnector-${latestVersion}-Setup.exe`;
  if (windows.fileName !== expectedFile || path.extname(windows.fileName).toLowerCase() !== ".exe") throw invalidManifest();
  if (!/^[a-fA-F0-9]{64}$/.test(String(windows.sha256 ?? ""))) throw invalidManifest();
  if (!isAllowedDownloadUrl(windows.downloadUrl, allowedHosts)) throw new UpdateError("DOWNLOAD_ORIGIN_NOT_ALLOWED", "El origen de la actualización no está permitido.");
  const download = new URL(windows.downloadUrl);
  if (download.hostname !== "github.com" || download.pathname !== `/${releaseRepository}/releases/download/v${latestVersion}/${expectedFile}`) {
    throw new UpdateError("DOWNLOAD_ORIGIN_NOT_ALLOWED", "El asset no pertenece al repositorio de releases permitido.");
  }
  if (releaseNotesUrl) {
    try {
      const notes = new URL(releaseNotesUrl);
      if (notes.protocol !== "https:" || notes.hostname !== "github.com" || notes.pathname !== `/${releaseRepository}/releases/tag/v${latestVersion}`) throw new Error();
    } catch { throw invalidManifest(); }
  }
  return {
    product: value.product,
    latestVersion,
    minimumSupportedVersion,
    publishedAt: value.publishedAt ?? null,
    windows: { ...windows, sha256: windows.sha256.toLowerCase() },
    releaseNotesUrl: releaseNotesUrl ?? null,
  };
}

function invalidManifest() {
  return new UpdateError("INVALID_UPDATE_MANIFEST", "El manifiesto de actualización no es válido.");
}

export class UpdateService {
  constructor({
    installedVersion,
    manifestUrl,
    releaseRepository = "jannpierrproyectos/audio-evaluaciones-medicas",
    allowedHosts,
    updatesDir,
    hasActiveJob = () => false,
    events,
    logger = console,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    cacheMs = UPDATE_CACHE_MS,
    maxBytes = UPDATE_MAX_BYTES,
    timeoutMs = UPDATE_TIMEOUT_MS,
    connectTimeoutMs = UPDATE_CONNECT_TIMEOUT_MS,
  }) {
    if (!semver.valid(installedVersion)) throw new Error("La versión instalada no es SemVer válida.");
    this.installedVersion = installedVersion;
    this.manifestUrl = manifestUrl;
    this.releaseRepository = releaseRepository;
    this.allowedHosts = allowedHosts.map((host) => host.toLowerCase());
    this.updatesDir = updatesDir;
    this.hasActiveJob = hasActiveJob;
    this.events = events;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cacheMs = cacheMs;
    this.maxBytes = maxBytes;
    this.timeoutMs = timeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.manifest = null;
    this.lastCheckedAt = null;
    this.lastCheckError = null;
    this.pending = null;
    this.download = { state: "idle", receivedBytes: 0, totalBytes: null };
    this.checkPromise = null;
    this.downloadController = null;
    this.cancelRequested = false;
    this.notifiedVersion = null;
  }

  publicStatus() {
    return {
      ok: true,
      installedVersion: this.installedVersion,
      latestVersion: this.manifest?.latestVersion ?? null,
      minimumSupportedVersion: this.manifest?.minimumSupportedVersion ?? null,
      compatibility: classifyConnectorVersion(this.installedVersion, this.manifest),
      lastCheckedAt: this.lastCheckedAt,
      checkAvailable: !this.checkPromise,
      download: { ...this.download },
      readyToInstall: Boolean(this.pending),
      releaseNotesUrl: this.manifest?.releaseNotesUrl ?? null,
    };
  }

  async check({ signal } = {}) {
    if (this.lastCheckedAt && this.now() - Date.parse(this.lastCheckedAt) < this.cacheMs) return this.publicStatus();
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.#performCheck(signal).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async #performCheck(signal) {
    this.logger.log?.("Update check started.");
    const controller = new AbortController();
    const abortExternal = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException("timeout", "AbortError")), this.connectTimeoutMs);
    try {
      const response = await fetchWithValidatedRedirects(this.manifestUrl, {
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
        timeoutMs: this.connectTimeoutMs,
        validateUrl: (url) => new URL(url).protocol === "https:",
      });
      if (!response.ok) throw new UpdateError("UPDATE_MANIFEST_UNAVAILABLE", "No se pudo consultar el manifiesto de actualización.", { status: 503 });
      const declaredLength = Number(response.headers.get("content-length"));
      if (declaredLength > MAX_MANIFEST_BYTES) throw invalidManifest();
      const text = await readResponseTextLimited(response, MAX_MANIFEST_BYTES, controller.signal);
      let raw;
      try { raw = JSON.parse(text); } catch { throw invalidManifest(); }
      this.manifest = validateReleaseManifest(raw, { allowedHosts: this.allowedHosts, releaseRepository: this.releaseRepository });
      this.lastCheckedAt = new Date(this.now()).toISOString();
      this.lastCheckError = null;
      this.logger.log?.(`Update check completed. latestVersion=${this.manifest.latestVersion}`);
      const compatibility = classifyConnectorVersion(this.installedVersion, this.manifest);
      if (["update_available", "update_required"].includes(compatibility) && this.notifiedVersion !== this.manifest.latestVersion) {
        this.notifiedVersion = this.manifest.latestVersion;
        this.events?.emit("update:available", { ...this.publicStatus(), automatic: !signal });
      }
      return this.publicStatus();
    } catch (error) {
      this.lastCheckedAt = new Date(this.now()).toISOString();
      this.lastCheckError = error?.code ?? "UPDATE_MANIFEST_UNAVAILABLE";
      this.logger.warn?.(`Update check failed: ${this.lastCheckError}`);
      if (error instanceof UpdateError) throw error;
      if (error?.name === "AbortError") throw new UpdateError("UPDATE_TIMEOUT", "La comprobación de actualización excedió el tiempo permitido.", { status: 504, cause: error });
      throw new UpdateError("UPDATE_MANIFEST_UNAVAILABLE", "No se pudo consultar el manifiesto de actualización.", { status: 503, cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortExternal);
    }
  }

  async downloadUpdate({ signal } = {}) {
    if (this.download.state === "downloading") throw new UpdateError("UPDATE_DOWNLOAD_IN_PROGRESS", "Ya existe una descarga de actualización en curso.", { status: 409 });
    if (!this.manifest) await this.check({ force: true, signal });
    if (!this.manifest) throw new UpdateError("UPDATE_MANIFEST_UNAVAILABLE", "No se pudo consultar el manifiesto de actualización.", { status: 503 });
    const compatibility = classifyConnectorVersion(this.installedVersion, this.manifest);
    if (compatibility === "up_to_date") throw new UpdateError("NO_UPDATE_AVAILABLE", "AudioEvaluaciones Connector ya está actualizado.", { status: 409 });

    const versionDir = path.join(this.updatesDir, this.manifest.latestVersion);
    const finalPath = path.join(versionDir, this.manifest.windows.fileName);
    const temporaryPath = `${finalPath}.partial`;
    await mkdir(versionDir, { recursive: true });
    await rm(temporaryPath, { force: true });
    const controller = new AbortController();
    this.downloadController = controller;
    this.cancelRequested = false;
    const abortExternal = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortExternal, { once: true });
    const globalTimeout = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    this.download = { state: "downloading", receivedBytes: 0, totalBytes: null };
    this.events?.emit("update:download-progress", { ...this.download });

    try {
      const response = await fetchWithValidatedRedirects(this.manifest.windows.downloadUrl, {
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
        timeoutMs: this.connectTimeoutMs,
        validateUrl: (url) => isAllowedDownloadUrl(url, this.allowedHosts),
      });
      if (!response.ok || !response.body) throw new UpdateError("UPDATE_DOWNLOAD_FAILED", "No se pudo descargar la actualización.", { status: 502 });
      const totalBytes = parseContentLength(response.headers.get("content-length"));
      if (totalBytes !== null && totalBytes > this.maxBytes) throw new UpdateError("UPDATE_TOO_LARGE", "La actualización excede el tamaño máximo permitido.", { status: 413 });
      this.download.totalBytes = totalBytes;
      const hash = createHash("sha256");
      const counter = new Transform({
        transform: (chunk, _encoding, callback) => {
          this.download.receivedBytes += chunk.length;
          if (this.download.receivedBytes > this.maxBytes) return callback(new UpdateError("UPDATE_TOO_LARGE", "La actualización excede el tamaño máximo permitido.", { status: 413 }));
          hash.update(chunk);
          this.events?.emit("update:download-progress", { ...this.download });
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temporaryPath, { flags: "wx" }), { signal: controller.signal });
      const downloadedSha256 = hash.digest("hex");
      if (downloadedSha256 !== this.manifest.windows.sha256) {
        throw new UpdateError("UPDATE_SHA256_MISMATCH", "No se pudo verificar la actualización. El instalador descargado fue descartado.", { status: 422 });
      }
      await rm(finalPath, { force: true });
      await rename(temporaryPath, finalPath);
      this.pending = { version: this.manifest.latestVersion, filePath: finalPath, sha256: downloadedSha256 };
      this.download = { state: "verified", receivedBytes: this.download.receivedBytes, totalBytes: this.download.totalBytes };
      await this.cleanupOldUpdates();
      this.logger.log?.("Update download completed; sha256 verified.");
      this.events?.emit("update:downloaded", { version: this.pending.version });
      return this.publicStatus();
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      this.download = { state: "failed", receivedBytes: 0, totalBytes: null };
      if (error instanceof UpdateError) throw error;
      if (controller.signal.aborted) {
        const code = signal?.aborted || this.cancelRequested ? "UPDATE_CANCELLED" : "UPDATE_TIMEOUT";
        throw new UpdateError(code, code === "UPDATE_CANCELLED" ? "La descarga fue cancelada." : "La descarga excedió el tiempo permitido.", { status: code === "UPDATE_CANCELLED" ? 409 : 504, cause: error });
      }
      throw new UpdateError("UPDATE_DOWNLOAD_FAILED", "No se pudo descargar la actualización.", { status: 502, cause: error });
    } finally {
      clearTimeout(globalTimeout);
      signal?.removeEventListener("abort", abortExternal);
      this.downloadController = null;
    }
  }

  cancelDownload() {
    if (!this.downloadController) throw new UpdateError("NO_UPDATE_DOWNLOAD", "No existe una descarga de actualización en curso.", { status: 409 });
    this.cancelRequested = true;
    this.downloadController.abort(new Error("cancelled"));
  }

  async requestInstall() {
    if (this.hasActiveJob()) throw new UpdateError("UPDATE_JOB_ACTIVE", "Hay un procesamiento de evaluaciones en curso. Finalízalo o cancélalo antes de actualizar AudioEvaluaciones Connector.", { status: 409 });
    if (!this.pending) throw new UpdateError("UPDATE_NOT_READY", "No existe una actualización verificada lista para instalar.", { status: 409 });
    await access(this.pending.filePath);
    const currentSha256 = await hashFile(this.pending.filePath);
    if (currentSha256 !== this.pending.sha256) {
      await rm(this.pending.filePath, { force: true });
      this.pending = null;
      throw new UpdateError("UPDATE_SHA256_MISMATCH", "No se pudo verificar la actualización. El instalador descargado fue descartado.", { status: 422 });
    }
    this.events?.emit("update:install-requested", { version: this.pending.version, filePath: this.pending.filePath, sha256: currentSha256 });
    return { ok: true, accepted: true, version: this.pending.version };
  }

  async cleanupOldUpdates() {
    await mkdir(this.updatesDir, { recursive: true });
    const entries = (await readdir(this.updatesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && semver.valid(entry.name))
      .map((entry) => entry.name)
      .sort(semver.rcompare);
    const keep = new Set([this.pending?.version, ...entries.filter((version) => version !== this.pending?.version).slice(0, 1)].filter(Boolean));
    await Promise.all(entries.filter((version) => !keep.has(version)).map((version) => rm(path.join(this.updatesDir, version), { recursive: true, force: true })));
  }
}

export async function fetchWithValidatedRedirects(initialUrl, { fetchImpl, signal, timeoutMs, validateUrl }) {
  let current = new URL(initialUrl).href;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!validateUrl(current)) throw new UpdateError("DOWNLOAD_ORIGIN_NOT_ALLOWED", "El origen de la actualización no está permitido.");
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("connect timeout")), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json, application/octet-stream" } });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relayAbort);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw new UpdateError("UPDATE_REDIRECT_INVALID", "La actualización contiene demasiados redirects o uno inválido.", { status: 502 });
    current = new URL(location, current).href;
  }
  throw new UpdateError("UPDATE_REDIRECT_INVALID", "La actualización contiene demasiados redirects.", { status: 502 });
}

async function readResponseTextLimited(response, limit, signal) {
  if (!response.body) return "";
  let size = 0;
  const chunks = [];
  for await (const chunk of Readable.fromWeb(response.body, { signal })) {
    size += chunk.length;
    if (size > limit) throw invalidManifest();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseContentLength(value) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
