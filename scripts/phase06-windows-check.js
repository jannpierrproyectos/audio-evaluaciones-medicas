// Disposable fictional files only. Never opens or alters an installed Connector.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { protectExportDirectory, restrictDirectory } from "../mediweb-downloader/src/windowsProtection.js";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "ae-phase06-acceptance-"));
const results = [];
try {
  let store = await new EvaluationStore({ directory: path.join(directory, "vault") }).initialize();
  const batch = await store.import({ workers: [{ identificacion: { dni: "00000001", nombres: "Ficticia" }, app_fields: { texto_final: "MARCADOR_FICTICIO_PRIVADO" } }] }, "a".repeat(64));
  store = await new EvaluationStore({ directory: path.join(directory, "vault") }).initialize();
  assert.equal((await store.load(batch.id)).snapshot.workers[0].app_fields.texto_final, "MARCADOR_FICTICIO_PRIVADO");
  for (const file of await readdir(path.join(directory, "vault"))) assert.equal((await readFile(path.join(directory, "vault", file))).includes(Buffer.from("MARCADOR_FICTICIO_PRIVADO")), false);
  results.push({ check: "DPAPI CurrentUser, ACL y recuperación AES-GCM reales", status: "APROBADA" });
  const profile = path.join(directory, "profile"); await mkdir(profile); await restrictDirectory(profile);
  let context = await chromium.launchPersistentContext(profile, { channel: "msedge", headless: true });
  try { await context.addCookies([{ name: "fictional_session", value: "fictional_only", domain: "mediweb.ficticio.invalid", path: "/", secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }]); }
  finally { await context.close(); }
  context = await chromium.launchPersistentContext(profile, { channel: "msedge", headless: true });
  try { assert.equal((await context.cookies()).some(cookie => cookie.name === "fictional_session" && cookie.value === "fictional_only"), true); }
  finally { await context.close(); }
  results.push({ check: "Perfil persistente Edge real tras cierre/reapertura", status: "APROBADA", scope: "Cookie ficticia local; no sesión institucional MediWeb" });
  const output = path.join(directory, "export");
  await mkdir(output);
  try {
    await protectExportDirectory(output);
    await writeFile(path.join(output, "ficticio.mp3"), Buffer.from("ID3FICTICIO"));
    results.push({ check: "EFS real en directorio de prueba", status: "APROBADA", scope: "Archivo ficticio, no aceptación del directorio institucional" });
  } catch {
    assert.equal((await readdir(output)).length, 0);
    results.push({ check: "EFS real en este entorno", status: "FALLIDA", effect: "Exportación bloqueada; no se escribió archivo sin protección" });
  }
  results.push({ check: "Explorer real, instalación/desinstalación y reinicio Windows", status: "PENDIENTE", reason: "No se modifica la instalación existente ni se declara aceptación visual mediante simulaciones" });
  console.log(JSON.stringify({ platform: process.platform, windowsRelease: os.release(), node: process.version, results }, null, 2));
} finally {
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(directory, { recursive: true, force: true });
}
