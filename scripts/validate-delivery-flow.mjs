import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { startControlledPreview } from "./controlled-processing-preview.mjs";

const keepPreview = process.argv.includes("--keep-preview");
const manualResultsOnly = process.argv.includes("--manual-results");
const preview = await startControlledPreview(Number(process.env.AE_TEST_PORT) || (keepPreview ? 4182 : 4181), { manualResultsOnly, resultsInNewTab: manualResultsOnly });
let passed = false;
const captures = manualResultsOnly ? "artifacts/manual-results-flow" : "artifacts/sequential-flow";
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
  assert.equal(await panel.getByRole("button", { name: "Verificar WhatsApp", exact: true }).count(), 0);
  assert.equal(await catalogueHash(), beforeRecovery);
  await shot("05-error-real-de-recuperacion");
  preview.setLoadFailure(false);
  await panel.getByRole("button", { name: "Reintentar recuperación", exact: true }).click();
  await panel.getByRole("heading", { name: "Lote procesado y disponible", exact: true }).waitFor();
  assert.equal(preview.stats.reportRequests, 8);
  assert.equal(await catalogueHash(), beforeRecovery);
  assert.equal(await page.getByRole("navigation", { name: "Etapas de trabajo" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^(2\. Revisar|3\. Audios|4\. Entregas)/ }).count(), 0);
  await panel.getByRole("button", { name: "Verificar WhatsApp", exact: true }).click();
  const contact = page.getByRole("region", { name: "Contacto seleccionado" });
  await contact.getByRole("heading", { name: /Persona1/i }).waitFor();
  await shot("06-whatsapp-primero");
  for (let index = 1; index <= 8; index++) {
    await contact.getByRole("heading", { name: new RegExp(`Persona${index}`, "i") }).waitFor();
    await contact.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
    await contact.getByRole("button", { name: index === 3 ? "No tiene WhatsApp" : "Tiene WhatsApp", exact: true }).click();
  }
  await page.getByText("No quedan otros contactos en esta vuelta.", { exact: false }).waitFor();
  assert.equal(preview.stats.chatOpens, 8);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await shot("07-whatsapp-revisado");
  await page.getByRole("button", { name: "Continuar con texto cl\u00ednico", exact: true }).click();
  await page.getByRole("textbox", { name: "Texto final editable PDF" }).waitFor();
  await shot("08-texto-y-audio-juntos");
  for (let index = 0; index < 8; index++) {
    await page.getByRole("button", { name: /^Aprobar texto cl\u00ednico/ }).click();
    if (index === 2) {
      await page.getByRole("option", { name: /FICTICIA PERSONA3/i }).click();
      await page.getByRole("button", { name: "Generar audio", exact: true }).click();
      await page.getByRole("button", { name: "Generando audio...", exact: true }).waitFor();
      await shot("09-audio-sin-whatsapp");
      await page.getByRole("button", { name: "Recuperar audio guardado", exact: true }).waitFor();
      await page.getByRole("button", { name: "Recuperar audio guardado", exact: true }).click();
      assert.equal(preview.stats.ttsRequests, 1);
      await page.getByRole("button", { name: "Siguiente", exact: true }).click();
    }
  }
  await page.getByRole("button", { name: "Generar audios masivos", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Completados: 7") && document.body.innerText.includes("Reutilizados: 1"), null, { timeout: 180000 });
  assert.equal(preview.stats.ttsRequests, 8);
  await shot("10-ocho-mp3-en-la-misma-pantalla");
  preview.setFileMode("missing");
  await page.getByRole("button", { name: "Continuar con env\u00edos", exact: true }).click();
  const recipient = page.getByRole("region", { name: "Entrega seleccionada" });
  await recipient.getByRole("heading", { name: /Persona1/i }).waitFor();
  await recipient.getByRole("button", { name: "Confirmar destinatario y preparar env\u00edo", exact: true }).click();
  await page.getByText(/\[FILE_NOT_FOUND\]/).waitFor();
  assert.equal(preview.stats.chatOpens, 8, "Missing PDF stops before navigating to a WhatsApp conversation");
  assert.equal((await preview.store.load(run.batch_id)).snapshot.workers[0].app_fields.recipient_authorization, null);
  await shot("11-falta-pdf-diagnostico");
  preview.setFileMode("fallback");
  await recipient.getByRole("button", { name: "Confirmar destinatario y preparar env\u00edo", exact: true }).click();
  const complete = page.getByRole("button", { name: /Confirmo que envi\u00e9 mensaje, PDF y MP3/ });
  await complete.waitFor({ timeout: 180000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("Confirmo que envi\u00e9 mensaje, PDF y MP3") && !button.disabled), null, { timeout: 180000 });
  assert.equal(preview.stats.reveals, 2);
  assert.equal(preview.stats.chatOpens, 9);
  await shot("12-original-recuperado-envio-preparado");
  const after = await preview.store.load(run.batch_id);
  assert.equal(after.snapshot.workers[0].app_fields.recipient_authorization.scope, "evaluation");
  assert.deepEqual((await preview.store.catalogue()).data.deliveries[0].confirmations, {});
  const afterHashes = await Promise.all(after.snapshot.workers.map(async worker => (await preview.files.inspectFile(worker.datos_operativos.archivo_pdf_completo_id, ".pdf")).sha256));
  assert.deepEqual(afterHashes, originalHashes);
  await complete.click();
  await recipient.getByRole("heading", { name: /Persona2/i }).waitFor();
  assert.equal((await preview.store.catalogue()).data.deliveries[0].state, "completada");
  await shot("13-envio-confirmado-siguiente");
  await page.reload();
  await panel.getByRole("heading", { name: "Lote procesado y disponible" }).waitFor();
  await panel.getByRole("button", { name: "Continuar lote", exact: true }).click();
  await recipient.getByRole("heading", { name: /Persona2/i }).waitFor();
  const stored = await preview.store.load(run.batch_id);
  assert.equal(stored.snapshot.workers.every(worker => worker.app_fields.audio_record), true);
  assert.equal(preview.stats.ttsRequests, 8);
  assert.equal(preview.stats.reportRequests, 8);
  assert.equal(preview.stats.chatOpens, 9, "Recovery never opens a chat for an existing verification");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("14-envio-movil");
  await page.getByRole("button", { name: "Volver a texto y audio", exact: true }).click();
  await page.getByRole("textbox", { name: "Texto final editable PDF" }).waitFor();
  await shot("15-texto-audio-movil");
  assert.deepEqual(errors, []);
  assert.equal(preview.stats.actualExternalRequests, 0);
  const result = { passed: true, evaluations: 8, manualResultsOnly, resultsInNewTab: manualResultsOnly, ...preview.stats, catalogueUnchangedByRecovery: true,
    originalPdfHashesUnchanged: true, originalRecoveredFromKnownLocation: true, noTaskTabs: true, workflowOrder: ["import", "whatsapp", "clinical-text", "audio", "manual-send"], realWindowsProtection: true, realConnectorPipeline: true,
    pageErrors: errors, safeDiagnostics: diagnostics, completedAt: new Date().toISOString() };
  await writeFile(`${captures}/results.json`, JSON.stringify(result, null, 2));
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
