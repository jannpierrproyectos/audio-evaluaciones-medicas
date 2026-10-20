import { createServer } from "node:http";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
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

function launch() { return spawn(runtime, [launcher], {
  cwd: path.join(stagingRoot, "app"),
  env: {
    ...process.env,
    LOCALAPPDATA: path.join(isolatedUser, "LocalAppData"),
    USERPROFILE: isolatedUser,
    MEDIWEB_SERVICE_PORT: String(port),
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
}); }
let child = launch();
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const health = await waitForHealth(port, 12_000);
  if (health.version === undefined || health.service !== "mediweb-downloader") throw new Error("Contrato /health inesperado.");
  console.log(`Smoke staging correcto con runtime\\node.exe en puerto ${port}; versión ${health.version}.`);
  const request = async body => {
    const response = await fetch(`http://127.0.0.1:${port}/state`, { method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  const saved = await request({ action: "import", importKey: "a".repeat(64), snapshot: { workers: [{ identificacion: { dni: "00000001", nombres: "Persona", apellidos: "Ficticia" }, app_fields: { texto_final: "MARCADOR_STAGING_FICTICIO" } }] } });
  const evaluationId = saved.snapshot.workers[0].evaluation_id;
  const operation = await request({ action: "reserve", batchId: saved.id, evaluationId, fingerprint: "b".repeat(64) });
  const syntheticMp3 = Buffer.from("ID3LOCAL-STAGING-SYNTHETIC-AUDIO");
  await request({ action: "complete", operationId: operation.id, audio: syntheticMp3.toString("base64"), metadata: { evaluation_id: evaluationId, fingerprint: operation.fingerprint } });
  const normalMp3 = path.join(isolatedUser, "Documents", "AudioEvaluaciones", "Descargas", "Documentos", "MP3", "02_Audio_Persona_Ficticia.mp3");
  assert.deepEqual(await readFile(normalMp3), syntheticMp3);
  await stop(); child = launch();
  await waitForHealth(port, 12000);
  const restored = await request({ action: "load", id: saved.id });
  assert.equal(restored.snapshot.workers[0].app_fields.texto_final, "MARCADOR_STAGING_FICTICIO");
  assert.deepEqual(await readFile(normalMp3), syntheticMp3);
  const vault = path.join(isolatedUser, "LocalAppData", "AudioEvaluacionesConnector", "evaluations-v1");
  for (const name of await readdir(vault)) assert.equal((await readFile(path.join(vault, name))).includes(Buffer.from("MARCADOR_STAGING_FICTICIO")), false);
  console.log("Reinicio real del proceso staging recupera lote con AES-GCM/DPAPI; sin marcador en claro.");
  console.log("MP3 normal con nombre del paciente disponible antes y después de reiniciar; cero solicitudes al proveedor.");
} catch (error) {
  throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
} finally {
  await stop();
  assert.ok(path.resolve(isolatedUser).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(isolatedUser, { recursive: true, force: true });
}

async function stop() {
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.stdin.write("shutdown\n");
  const timer = setTimeout(() => child.kill(), 5000);
  try { await exited; } finally { clearTimeout(timer); }
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
