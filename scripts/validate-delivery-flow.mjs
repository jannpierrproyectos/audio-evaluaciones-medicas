import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { startControlledPreview } from "./controlled-processing-preview.mjs";

const keepPreview = process.argv.includes("--keep-preview");
const preview = await startControlledPreview(Number(process.env.AE_TEST_PORT) || (keepPreview ? 4190 : 4181));
let passed = false;
const captures = "artifacts/delivery-flow";
await mkdir(captures, { recursive: true });
const context = await preview.browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
let page;
const errors = [], diagnostics = [];
const heartbeat = setInterval(() => console.log(`PROGRESS reports=${preview.stats.reportRequests}/8 localTts=${preview.stats.ttsRequests} attachments=${preview.stats.reveals}`), 20000);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const catalogueHash = async () => digest(await readFile(path.join(preview.directory, "vault", "catalogue.enc")));
const shot = async name => {
  await page.screenshot({ path: `${captures}/${name}.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no horizontal overflow`);
  console.log(`CAPTURE ${name}`);
};
try {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if ([preview.url, preview.connectorUrl].includes(url.origin) || ["blob:", "data:"].includes(url.protocol)) return route.continue();
    preview.stats.actualExternalRequests++; return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.text().includes("[AudioEvaluaciones:recuperacion]")) diagnostics.push(message.text()); });
  await page.goto(preview.url);
  const panel = page.getByRole("region", { name: "Procesamiento completo MediWeb" });
  await panel.getByRole("button", { name: "Procesar evaluaciones", exact: true }).waitFor();
  assert.equal(await panel.getByRole("checkbox").count(), 0);
  await shot("01-antes-de-importar");
  await panel.getByRole("button", { name: "Procesar evaluaciones", exact: true }).click();
  await panel.getByRole("heading", { name: "Preparando tus evaluaciones" }).waitFor();
  await shot("02-durante-procesamiento");
  await panel.getByRole("heading", { name: "Lote procesado y disponible", exact: true }).waitFor({ timeout: 420000 });
  await panel.getByText("evaluaciones disponibles", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Procesar evaluaciones", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("combobox").count(), 0);
  assert.equal(preview.stats.reportRequests, 8);
  const processing = await preview.store.processingState(), run = processing.runs[0];
  const saved = await preview.store.load(run.batch_id);
  assert.equal(saved.snapshot.workers.length, 8);
  assert.equal(saved.snapshot.workers.every(worker => worker.datos_operativos?.archivo_pdf_completo_id && !worker.derived_states?.reviewed_by_user), true);
  const protectedFiles = await Promise.all(saved.snapshot.workers.map(worker => preview.files.inspectFile(worker.datos_operativos.archivo_pdf_completo_id, ".pdf")));
  const originalHashes = protectedFiles.map(file => file.sha256);
  await shot("03-ocho-evaluaciones-disponibles");
  const beforeRecovery = await catalogueHash();
  await page.reload();
  await panel.getByRole("heading", { name: "Lote procesado y disponible", exact: true }).waitFor({ timeout: 90000 });
  assert.equal(await catalogueHash(), beforeRecovery, "Recovery leaves encrypted catalogue unchanged");
  await shot("04-lote-recuperado");
  preview.setLoadFailure(true);
  await page.reload();
  await panel.getByRole("alert").filter({ hasText: "BATCH_LOAD_STORE_BUSY" }).waitFor();
  assert.equal(await panel.getByRole("heading", { name: "Lote procesado y disponible", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Revisar evaluaciones", exact: true }).count(), 0);
  assert.equal(await catalogueHash(), beforeRecovery);
  await shot("05-error-real-de-recuperacion");
  preview.setLoadFailure(false);
  await panel.getByRole("button", { name: "Reintentar recuperación", exact: true }).click();
  await panel.getByRole("heading", { name: "Lote procesado y disponible", exact: true }).waitFor();
  assert.equal(preview.stats.reportRequests, 8);
  assert.equal(await catalogueHash(), beforeRecovery);
  await panel.getByRole("button", { name: "Revisar evaluaciones", exact: true }).click();
  await page.getByRole("textbox", { name: "Texto final editable PDF" }).waitFor();
  assert.equal(await page.getByRole("option").filter({ hasText: "DNI:" }).count(), 8);
  await shot("06-revision-clinica");
  await page.getByRole("button", { name: "Aprobar texto clínico y siguiente", exact: true }).click();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  const generate = page.getByRole("button", { name: "Generar audio", exact: true });
  assert.equal(await generate.isEnabled(), true);
  await generate.click();
  await page.getByRole("button", { name: "Generando audio...", exact: true }).waitFor();
  await shot("07-generacion-sin-whatsapp");
  await page.getByRole("button", { name: "Recuperar audio guardado", exact: true }).waitFor();
  assert.equal(preview.stats.ttsRequests, 1);
  await page.getByRole("button", { name: "Recuperar audio guardado", exact: true }).click();
  await page.getByText("Cambios guardados de forma segura.", { exact: true }).waitFor();
  assert.equal(preview.stats.ttsRequests, 1);
  // Review each narrative explicitly before bulk generation. WhatsApp remains unverified.
  for (let index = 1; index < 8; index++) {
    if (index === 1) await page.getByRole("button", { name: "Siguiente", exact: true }).click();
    await page.getByRole("button", { name: /^Aprobar texto cl\u00ednico/ }).click();
  }
  await page.getByRole("button", { name: "Ir a audios masivos", exact: true }).click();
  await page.getByRole("heading", { name: "Audios del lote" }).waitFor();
  await page.getByRole("button", { name: "Generar audios masivos", exact: true }).waitFor();
  await shot("08-boton-masivo-visible");
  await page.getByRole("button", { name: "Generar audios masivos", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Completados: 7") && document.body.innerText.includes("Reutilizados: 1"), null, { timeout: 180000 });
  assert.equal(preview.stats.ttsRequests, 8, "Only seven new calls; existing MP3 reused");
  await shot("09-ocho-mp3-sin-whatsapp");
  await page.getByRole("button", { name: /^2\. Revisar/ }).click();
  await page.getByRole("button", { name: "Revisar destinatarios", exact: true }).click();
  await page.getByRole("button", { name: /Persona1/i }).click();
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
    await page.getByRole("button", { name: "Tiene WhatsApp", exact: true }).click();
    await page.getByText("Resultado guardado.", { exact: false }).waitFor();
  }
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await shot("10-whatsapp-guardado-sin-formularios");
  await page.getByRole("button", { name: "Preparar entregas", exact: true }).click();
  const recipient = page.getByRole("region", { name: "Entrega seleccionada" });
  await recipient.getByRole("heading", { name: /Persona1/i }).waitFor();
  await recipient.getByRole("button", { name: "Confirmar destinatario y preparar envio", exact: true }).click();
  const complete = page.getByRole("button", { name: /Confirmo que envié mensaje, PDF y MP3/ });
  await complete.waitFor({ timeout: 180000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("Confirmo que envié mensaje, PDF y MP3") && !button.disabled), null, { timeout: 180000 });
  assert.equal(preview.stats.reveals, 2);
  await shot("11-entrega-preparada");
  const after = await preview.store.load(run.batch_id);
  assert.equal(after.snapshot.workers.length, 8);
  assert.ok(after.snapshot.workers[0].app_fields.whatsapp_verification.checked_at);
  assert.equal(after.snapshot.workers[0].app_fields.recipient_authorization.identity_confirmed, true);
  assert.equal(after.snapshot.workers[0].clinical_approval.status, "aprobada");
  const afterHashes = await Promise.all(after.snapshot.workers.map(async worker => (await preview.files.inspectFile(worker.datos_operativos.archivo_pdf_completo_id, ".pdf")).sha256));
  assert.deepEqual(afterHashes, originalHashes);
  const deliveries = (await preview.store.catalogue()).data.deliveries;
  assert.deepEqual(deliveries[0].confirmations, {}, "Preparation never fabricates sending");
  await complete.click();
  await recipient.getByRole("heading", { name: /Persona2/i }).waitFor();
  assert.equal(preview.stats.ttsRequests, 8);
  assert.equal((await preview.store.catalogue()).data.deliveries[0].state, "completada");
  await shot("12-entrega-confirmada-siguiente");
  await page.reload();
  await page.getByRole("button", { name: "4. Entregas", exact: true }).click();
  await recipient.getByRole("heading", { name: /Persona2/i }).waitFor();
  const stored = await preview.store.load(run.batch_id);
  assert.equal(stored.snapshot.workers.every(worker => worker.app_fields.audio_record), true);
  assert.equal(stored.snapshot.workers[0].app_fields.recipient_authorization.scope, "evaluation");
  assert.equal(preview.stats.ttsRequests, 8);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("10-entrega-movil");
  await page.getByRole("button", { name: "Volver al panel", exact: true }).click();
  await page.getByRole("button", { name: "1. Importar", exact: true }).click();
  await panel.getByRole("heading", { name: "Lote procesado y disponible" }).waitFor();
  await shot("11-resultado-movil");
  assert.deepEqual(errors, []);
  assert.equal(preview.stats.actualExternalRequests, 0);
  const result = { passed: true, evaluations: 8, ...preview.stats, catalogueUnchangedByRecovery: true,
    originalPdfHashesUnchanged: true, realWindowsProtection: true, realConnectorPipeline: true,
    pageErrors: errors, safeDiagnostics: diagnostics, completedAt: new Date().toISOString() };
  await writeFile("artifacts/delivery-flow/results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  passed = true;
} catch (error) {
  await page?.screenshot({ path: `${captures}/failure.png`, fullPage: true }).catch(() => {});
  console.error((await page?.locator("body").innerText())?.slice(-7000));
  throw error;
} finally {
  clearInterval(heartbeat); await context.close();
  if (!keepPreview || !passed) await preview.stop();
  else {
    console.log(`PREVIEW_READY ${preview.url}`);
    process.once("SIGINT", async () => { await preview.stop(); process.exit(0); });
    process.once("SIGTERM", async () => { await preview.stop(); process.exit(0); });
  }
}
