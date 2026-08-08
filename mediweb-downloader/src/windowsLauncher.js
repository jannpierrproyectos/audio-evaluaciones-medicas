import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConnectorConfig } from "./config.js";
import { getRuntimePaths } from "./paths.js";
import { moduleRoot, startConnectorService } from "./service.js";

export async function probeConnector(port, { fetchImpl = fetch, timeoutMs = 1200 } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && health.service === "mediweb-downloader";
  } catch {
    return false;
  }
}

export async function runWindowsLauncher({
  env = process.env,
  logger = console,
  probe = probeConnector,
  startService = startConnectorService,
} = {}) {
  const runtimePaths = getRuntimePaths({ moduleRoot, packaged: true, env });
  const config = await loadConnectorConfig({ runtimePaths, env, createIfMissing: true });
  if (await probe(config.port)) {
    logger.log("AudioEvaluaciones Connector ya está activo.");
    return { alreadyRunning: true };
  }

  try {
    const service = await startService({ packaged: true, runtimePaths, config, logger });
    logger.log("\nAudioEvaluaciones Connector");
    logger.log("Estado: Activo");
    logger.log(`Puerto local: ${config.port}`);
    logger.log("\nPuedes cerrar esta ventana cuando termines de usar AudioEvaluaciones.");
    return { alreadyRunning: false, service };
  } catch (error) {
    if (error?.code === "EADDRINUSE" && await probe(config.port)) {
      logger.log("AudioEvaluaciones Connector ya está activo.");
      return { alreadyRunning: true };
    }
    throw error;
  }
}

async function main() {
  try {
    process.title = "AudioEvaluaciones Connector";
    const result = await runWindowsLauncher();
    if (result.alreadyRunning) await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.error(`No se pudo iniciar AudioEvaluaciones Connector: ${friendlyStartupError(error)}`);
    process.exitCode = 1;
  }
}

export function friendlyStartupError(error) {
  if (error?.code === "EADDRINUSE") return "el puerto configurado ya está siendo utilizado por otra aplicación.";
  return error?.message || "error desconocido.";
}

if (Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
