import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, parseAllowedOrigins } from "./http/app.js";
import { JobManager } from "./http/jobManager.js";
import { DownloaderRunner } from "./runner.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(moduleRoot, "package.json"), "utf8"));
const port = parsePort(process.env.MEDIWEB_SERVICE_PORT);
const allowedOrigins = parseAllowedOrigins(process.env.MEDIWEB_ALLOWED_ORIGINS);
const engine = new DownloaderRunner({ moduleRoot });
const jobManager = new JobManager({ engine });
const server = createServer(createApp({ engine, jobManager, version: packageJson.version, allowedOrigins }));
let shuttingDown = false;

server.listen(port, "127.0.0.1", () => {
  console.log(`mediweb-downloader escuchando en http://127.0.0.1:${port}`);
  console.log(`Origins permitidos: ${[...allowedOrigins].join(", ")}`);
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nCerrando servicio (${signal})...`);
  server.close();
  if (jobManager.hasActiveJob) {
    const active = jobManager.get(jobManager.activeJobId);
    await jobManager.cancel(active.id);
  }
  await jobManager.waitForIdle();
  await engine.close();
}

process.once("SIGINT", () => { shutdown("SIGINT").finally(() => { process.exitCode = 130; }); });
process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => { process.exitCode = 143; }); });

function parsePort(value) {
  if (value === undefined || value === "") return 8765;
  if (!/^\d+$/.test(value)) throw new Error("MEDIWEB_SERVICE_PORT debe ser un puerto válido.");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65535) throw new Error("MEDIWEB_SERVICE_PORT debe estar entre 1 y 65535.");
  return parsed;
}
