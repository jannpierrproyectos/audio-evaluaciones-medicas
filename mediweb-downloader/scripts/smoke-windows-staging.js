import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagingRoot = path.join(projectRoot, "build-windows", "staging");
const runtime = path.join(stagingRoot, "runtime", "node.exe");
const launcher = path.join(stagingRoot, "app", "src", "trayService.js");
const isolatedUser = path.join(os.tmpdir(), `audioevaluaciones-smoke-${process.pid}-${Date.now()}`);
const port = await availablePort();
await mkdir(isolatedUser, { recursive: true });

const child = spawn(runtime, [launcher], {
  cwd: path.join(stagingRoot, "app"),
  env: {
    ...process.env,
    LOCALAPPDATA: path.join(isolatedUser, "LocalAppData"),
    USERPROFILE: isolatedUser,
    MEDIWEB_SERVICE_PORT: String(port),
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const health = await waitForHealth(port, 12_000);
  if (health.version === undefined || health.service !== "mediweb-downloader") throw new Error("Contrato /health inesperado.");
  console.log(`Smoke staging correcto con runtime\\node.exe en puerto ${port}; versión ${health.version}.`);
} catch (error) {
  throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
} finally {
  child.stdin.write("shutdown\n");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await rm(isolatedUser, { recursive: true, force: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const selected = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return selected;
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // El proceso puede seguir arrancando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El staging no respondió /health dentro del tiempo esperado.");
}
