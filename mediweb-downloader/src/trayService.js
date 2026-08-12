import { EventEmitter } from "node:events";
import readline from "node:readline";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConnectorConfig } from "./config.js";
import { createFileLogger } from "./logger.js";
import { getRuntimePaths } from "./paths.js";
import { moduleRoot, startConnectorService } from "./service.js";
import { probeConnector } from "./windowsLauncher.js";

const EVENT_PREFIX = "AE_EVENT ";

export function writeTrayEvent(output, type, details = {}) {
  output.write(`${EVENT_PREFIX}${JSON.stringify({ type, ...details })}\n`);
}

export async function runTrayService({ env = process.env, output = process.stdout, input = process.stdin } = {}) {
  const runtimePaths = getRuntimePaths({ moduleRoot, packaged: true, env });
  const config = await loadConnectorConfig({ runtimePaths, env, createIfMissing: true });
  const logger = await createFileLogger(runtimePaths.logsDir);
  const events = new EventEmitter();
  let service = null;
  let closing = false;

  for (const type of ["connector:ready", "browser:opened", "browser:error", "job:started", "job:completed", "job:failed", "job:cancelled"]) {
    events.on(type, (details = {}) => writeTrayEvent(output, type, details));
  }

  if (await probeConnector(config.port)) {
    writeTrayEvent(output, "connector:already-running", { port: config.port });
    return { alreadyRunning: true };
  }

  try {
    service = await startConnectorService({ packaged: true, runtimePaths, config, logger, events, registerSignalHandlers: false });
  } catch (error) {
    await logger.error("No se pudo iniciar el servicio local.", error);
    writeTrayEvent(output, "connector:error", { code: error?.code ?? "START_ERROR", port: config.port });
    return { error };
  }

  const shutdown = async (reason = "tray") => {
    if (closing) return;
    closing = true;
    await service.shutdown(reason);
  };

  const lines = readline.createInterface({ input });
  lines.on("line", (line) => {
    const command = line.trim().toLowerCase();
    if (command === "shutdown") shutdown("tray").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => shutdown("SIGTERM").finally(() => process.exit(0)));
  process.once("SIGINT", () => shutdown("SIGINT").finally(() => process.exit(0)));
  return { service, shutdown, config, runtimePaths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTrayService().catch((error) => {
    writeTrayEvent(process.stdout, "connector:error", { code: error?.code ?? "UNEXPECTED_ERROR" });
    process.exitCode = 1;
  });
}
