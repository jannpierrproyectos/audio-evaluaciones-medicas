import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp, parseAllowedOrigins } from "./http/app.js";
import { JobManager } from "./http/jobManager.js";
import { DownloaderRunner } from "./runner.js";
import { loadConnectorConfig } from "./config.js";
import { getRuntimePaths } from "./paths.js";
import { EventEmitter } from "node:events";

export const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startConnectorService({
  packaged = false,
  runtimePaths = getRuntimePaths({ moduleRoot, packaged }),
  config = null,
  logger = console,
  registerSignalHandlers = true,
  events = new EventEmitter(),
} = {}) {
  const resolvedConfig = config ?? await loadConnectorConfig({ runtimePaths });
  runtimePaths = { ...runtimePaths, downloadsDir: resolvedConfig.downloadsDir ?? runtimePaths.downloadsDir };
  const packageJson = JSON.parse(await readFile(path.join(moduleRoot, "package.json"), "utf8"));
  const allowedOrigins = parseAllowedOrigins(resolvedConfig.allowedOrigins);
  const engineLogger = packaged ? {
    log() {},
    warn() { logger.warn?.("Advertencia operativa durante el procesamiento."); },
  } : logger;
  const engine = new DownloaderRunner({ moduleRoot, runtimePaths, logger: engineLogger, events });
  const jobManager = new JobManager({ engine, events, logger });
  const server = createServer(createApp({ engine, jobManager, version: packageJson.version, allowedOrigins }));
  let shuttingDown = false;

  const shutdown = async (signal = "cierre") => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`\nCerrando servicio (${signal})...`);
    await new Promise((resolve) => server.close(resolve));
    if (jobManager.hasActiveJob) await jobManager.cancel(jobManager.activeJobId);
    await jobManager.waitForIdle();
    await engine.close();
    events.emit("connector:stopped");
  };

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(resolvedConfig.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  logger.log(`mediweb-downloader escuchando en http://127.0.0.1:${resolvedConfig.port}`);
  logger.log(`Origins permitidos: ${[...allowedOrigins].join(", ")}`);
  events.emit("connector:ready", { port: resolvedConfig.port, version: packageJson.version });

  if (registerSignalHandlers) {
    process.once("SIGINT", () => { shutdown("SIGINT").finally(() => { process.exitCode = 130; }); });
    process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => { process.exitCode = 143; }); });
  }
  return { server, engine, jobManager, shutdown, port: resolvedConfig.port, version: packageJson.version, events };
}

async function main() {
  await startConnectorService({ packaged: false });
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Error al iniciar AudioEvaluaciones Connector: ${error.message}`);
    process.exitCode = 1;
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}
