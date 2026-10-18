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
import { UpdateService } from "./updateService.js";
import { createManagedFileService } from "./managedFiles.js";
import os from "node:os";
import { EvaluationStore } from "./evaluationStore.js";
import { restrictFile } from "./windowsProtection.js";
import { TemporaryAttachments } from "./temporaryAttachments.js";
import { createEncryptedOutput } from "./encryptedOutput.js";

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
  const updateService = new UpdateService({
    installedVersion: packageJson.version,
    manifestUrl: resolvedConfig.releaseManifestUrl,
    releaseRepository: resolvedConfig.releaseRepository,
    allowedHosts: resolvedConfig.allowedDownloadHosts,
    updatesDir: runtimePaths.updatesDir,
    hasActiveJob: () => jobManager.hasActiveJob,
    events,
    logger,
  });
  // User data never lives beside the installed executable or in the source tree.
  const stateDirectory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AudioEvaluacionesConnector", "evaluations-v1");
  let storePromise;
  const getEvaluationStore = () => {
    storePromise ||= new EvaluationStore({ directory: stateDirectory }).initialize().catch(error => { storePromise = null; throw error; });
    return storePromise;
  };
  const temporaryAttachments = new TemporaryAttachments({
    directory: path.join(path.dirname(stateDirectory), "temporary-attachments-v1"), getStore: getEvaluationStore,
  });
  // Sweep leftovers even when the operator does not open the delivery inbox.
  // A failure remains local to export: importing/reviewing still works.
  await temporaryAttachments.initialize().catch(() => logger.warn?.("Adjuntos temporales bloqueados: revisa los permisos o archivos abiertos y reinicia el Connector."));
  const output = createEncryptedOutput({ downloadsDir: runtimePaths.downloadsDir, getStore: getEvaluationStore });
  engine.protectOutput = output.protectOutput; engine.writeOutput = output.write; engine.readOutput = output.read;
  const managedFiles = createManagedFileService({ downloadsDir: runtimePaths.downloadsDir, ensureProtectedFile: restrictFile, temporaryAttachments, readProtectedOutput: output.read });
  const server = createServer(createApp({ engine, jobManager, managedFiles, updateService, getEvaluationStore, version: packageJson.version, allowedOrigins }));
  let shuttingDown = false;
  let updateTimer = null;

  const shutdown = async (signal = "cierre") => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (updateTimer) clearInterval(updateTimer);
    logger.log(`\nCerrando servicio (${signal})...`);
    await new Promise((resolve) => server.close(resolve));
    if (jobManager.hasActiveJob) await jobManager.cancel(jobManager.activeJobId);
    await jobManager.waitForIdle();
    await engine.close();
    await temporaryAttachments.release().catch(() => logger.warn?.("Quedan adjuntos temporales bloqueados; el vigilante volvera a intentar su limpieza."));
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
  updateService.check().catch(() => {});
  updateTimer = setInterval(() => updateService.check({ force: true }).catch(() => {}), 12 * 60 * 60 * 1000);
  updateTimer.unref?.();

  if (registerSignalHandlers) {
    process.once("SIGINT", () => { shutdown("SIGINT").finally(() => { process.exitCode = 130; }); });
    process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => { process.exitCode = 143; }); });
  }
  return { server, engine, jobManager, updateService, shutdown, port: resolvedConfig.port, version: packageJson.version, events };
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
