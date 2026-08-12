import { readFile, writeFile } from "node:fs/promises";
import { ensureRuntimeDirectories } from "./paths.js";

export const DEFAULT_CONFIG = Object.freeze({
  configVersion: 1,
  port: 8765,
  audioEvaluacionesUrl: "https://audio-evaluaciones-medicas.vercel.app",
  downloadsDir: "",
  startWithWindows: true,
  releaseManifestUrl: "https://audio-evaluaciones-medicas.vercel.app/connector-release.json",
  releaseRepository: "jannpierrproyectos/audio-evaluaciones-medicas",
  allowedDownloadHosts: Object.freeze([
    "github.com",
    "objects.githubusercontent.com",
    "githubusercontent.com",
  ]),
  allowedOrigins: Object.freeze([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://audio-evaluaciones-medicas.vercel.app",
  ]),
});

export async function loadConnectorConfig({ runtimePaths, env = process.env, createIfMissing = runtimePaths.packaged } = {}) {
  if (!runtimePaths) throw new Error("runtimePaths es obligatorio para cargar la configuración.");
  if (createIfMissing) await ensureRuntimeDirectories(runtimePaths);

  let localConfig = {};
  try {
    localConfig = JSON.parse(await readFile(runtimePaths.configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("config.json no contiene JSON válido.");
    if (createIfMissing) {
      await writeFile(runtimePaths.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
        .catch((writeError) => { if (writeError.code !== "EEXIST") throw writeError; });
    }
  }

  const portValue = env.MEDIWEB_SERVICE_PORT ?? localConfig.port ?? DEFAULT_CONFIG.port;
  const originsValue = env.MEDIWEB_ALLOWED_ORIGINS
    ?? (Array.isArray(localConfig.allowedOrigins) ? localConfig.allowedOrigins.join(",") : undefined)
    ?? DEFAULT_CONFIG.allowedOrigins.join(",");
  const audioEvaluacionesUrl = validateWebUrl(localConfig.audioEvaluacionesUrl ?? DEFAULT_CONFIG.audioEvaluacionesUrl);
  const releaseManifestUrl = validateHttpsUrl(localConfig.releaseManifestUrl ?? DEFAULT_CONFIG.releaseManifestUrl, "manifest de actualizaciones");
  const releaseRepository = validateReleaseRepository(localConfig.releaseRepository ?? DEFAULT_CONFIG.releaseRepository);
  const allowedDownloadHosts = validateDownloadHosts(localConfig.allowedDownloadHosts ?? DEFAULT_CONFIG.allowedDownloadHosts);
  const configuredOrigins = originsValue.split(",").map((value) => value.trim()).filter(Boolean);
  for (const safeDefault of DEFAULT_CONFIG.allowedOrigins) {
    if (!configuredOrigins.includes(safeDefault)) configuredOrigins.push(safeDefault);
  }
  if (!configuredOrigins.includes(audioEvaluacionesUrl)) configuredOrigins.push(audioEvaluacionesUrl);
  return {
    configVersion: DEFAULT_CONFIG.configVersion,
    port: parsePort(portValue),
    allowedOrigins: configuredOrigins.join(","),
    audioEvaluacionesUrl,
    downloadsDir: String(localConfig.downloadsDir ?? DEFAULT_CONFIG.downloadsDir).trim() || runtimePaths.downloadsDir,
    startWithWindows: localConfig.startWithWindows ?? DEFAULT_CONFIG.startWithWindows,
    releaseManifestUrl,
    releaseRepository,
    allowedDownloadHosts,
  };
}

export function validateReleaseRepository(value) {
  const repository = String(value).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("releaseRepository no es válido.");
  return repository;
}

export function validateHttpsUrl(value, label = "URL") {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error(`La URL del ${label} debe usar HTTPS y ser válida.`);
  }
}

export function validateDownloadHosts(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("allowedDownloadHosts debe contener al menos un host.");
  const hosts = value.map((item) => String(item).trim().toLowerCase());
  if (hosts.some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host))) {
    throw new Error("allowedDownloadHosts contiene un host no válido.");
  }
  return [...new Set(hosts)];
}

export function validateWebUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch {
    throw new Error("La URL de AudioEvaluaciones debe ser un origen HTTP o HTTPS válido.");
  }
}

export function configurationRequiresRestart(before, after) {
  return before.port !== after.port
    || before.audioEvaluacionesUrl !== after.audioEvaluacionesUrl
    || before.downloadsDir !== after.downloadsDir
    || before.allowedOrigins !== after.allowedOrigins;
}

export function parsePort(value) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error("MEDIWEB_SERVICE_PORT debe ser un puerto válido.");
  const parsed = Number(text);
  if (parsed < 1 || parsed > 65535) throw new Error("MEDIWEB_SERVICE_PORT debe estar entre 1 y 65535.");
  return parsed;
}
