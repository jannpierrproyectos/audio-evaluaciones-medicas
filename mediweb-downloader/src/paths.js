import path from "node:path";
import os from "node:os";
import { mkdir, readdir, rmdir } from "node:fs/promises";

export const CONNECTOR_DATA_DIRECTORY = "AudioEvaluacionesConnector";

export function getRuntimePaths({ moduleRoot, packaged = false, env = process.env, homeDir = os.homedir() } = {}) {
  if (!moduleRoot) throw new Error("moduleRoot es obligatorio para resolver las rutas del Connector.");
  if (!packaged) {
    return {
      packaged: false,
      authDir: path.join(moduleRoot, ".auth", "mediweb-profile"),
      downloadsDir: path.join(moduleRoot, "downloads"),
      tmpDir: path.join(moduleRoot, "tmp"),
      logsDir: path.join(moduleRoot, "logs"),
      updatesDir: path.join(moduleRoot, "updates"),
      configDir: path.join(moduleRoot, "config"),
      configPath: path.join(moduleRoot, "config", "config.json"),
    };
  }

  const userProfile = env.USERPROFILE || homeDir;
  const localAppData = env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
  const dataRoot = path.join(localAppData, CONNECTOR_DATA_DIRECTORY);
  return {
    packaged: true,
    authDir: path.join(dataRoot, "auth"),
    downloadsDir: path.join(userProfile, "Documents", "AudioEvaluaciones", "Descargas"),
    tmpDir: path.join(dataRoot, "tmp"),
    logsDir: path.join(dataRoot, "logs"),
    updatesDir: path.join(dataRoot, "updates"),
    configDir: dataRoot,
    configPath: path.join(dataRoot, "config.json"),
  };
}

export async function ensureRuntimeDirectories(paths) {
  await Promise.all([
    mkdir(paths.authDir, { recursive: true }),
    mkdir(paths.downloadsDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    paths.updatesDir ? mkdir(paths.updatesDir, { recursive: true }) : null,
    mkdir(paths.configDir, { recursive: true }),
  ]);
}

export function timestamp(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export async function createOutputPaths(moduleRoot, customBase, mode, runtimePaths = null) {
  const base = customBase ?? runtimePaths?.downloadsDir ?? path.join(moduleRoot, "downloads");
  const runTimestamp = timestamp();
  const root = path.join(base, runTimestamp);
  const paths = {
    root,
    control: path.join(root, "control"),
    manifest: path.join(root, "control", "manifest.json"),
    csv: path.join(root, "control", "resultados.csv"),
    tmp: runtimePaths?.packaged ? path.join(runtimePaths.tmpDir, runTimestamp) : path.join(root, "tmp"),
    full: path.join(root, "reportes-completos"),
    audio: path.join(root, "audioevaluaciones"),
    consolidated: path.join(root, "audioevaluaciones", "primeras-hojas.pdf"),
  };
  await Promise.all([mkdir(paths.control, { recursive: true }), mkdir(paths.tmp, { recursive: true })]);
  if (mode === "full" || mode === "both") await mkdir(paths.full, { recursive: true });
  if (mode === "first" || mode === "both") await mkdir(paths.audio, { recursive: true });
  return paths;
}

export async function removeTmpIfEmpty(directory) {
  try {
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  } catch {
    // No impedir el cierre por una carpeta temporal no vacia o ya eliminada.
  }
}
