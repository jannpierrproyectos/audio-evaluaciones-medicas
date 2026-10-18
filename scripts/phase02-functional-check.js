// Real Edge + real encrypted temporary Connector. WhatsApp and TTS are simulated.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { createApp } from "../mediweb-downloader/src/http/app.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { getRecipientChecks } from "../src/lib/recipientPolicy.js";
import { recordWhatsAppDecision } from "../src/lib/whatsappReview.js";
import { sha256 } from "../src/lib/evaluationPersistence.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "ae-phase02-functional-"));
let store, connector, vite, browser, testPage;
let ttsCalls = 0;
const reports = [];
const evidence = { identity: true, consent: true, pdf: true, saveAuthorization: true, expires_at: "2099-01-01T12:00:00Z" };
const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
const person = (name, dni, phone, ficha) => prepareAnalysisForReview({ workers: [{
  identificacion: { nombres: name, apellidos: "Ficticio", dni, fecha_evaluacion: "17/10/2026", n_ficha: ficha },
  aptitud_y_recomendaciones: { aptitud_final: "APTO" },
  datos_operativos: { telefono: phone, archivo_pdf_completo: "ficticio.pdf", archivo_pdf_completo_id: "test/ficticio.pdf" },
}] }, "mediweb").workers[0];
try {
  store = await new EvaluationStore({ directory }).initialize();
  const prior = await store.import({ workers: [person("Ana", "00000001", "999111111", "previa")], greeting: "Buenos días" }, await sha256("prior-check"));
  prior.snapshot.workers[0] = recordWhatsAppDecision(prior.snapshot.workers[0], "confirmado_por_operador", evidence);
  await store.save(prior.id, prior.snapshot, prior.revision);
  const active = await store.import({ file_name: "cola-ficticia.pdf", greeting: "Buenos días", workers: [
    person("Ana", "00000001", "999111111", "actual"), person("Beto", "00000002", "999222222", "B"),
    person("Carla", "00000003", "999333333", "C"), person("Diego", "00000004", "999333333", "D"),
    person("Eva", "00000005", "123", "E"), person("Felix", "00000006", "999666666", "F"),
    person("Gala", "00000007", "999777777", "G"),
  ] }, await sha256("phase02-queue"));
  active.snapshot.workers[5] = recordWhatsAppDecision(active.snapshot.workers[5], "no_disponible");
  await store.save(active.id, active.snapshot, active.revision);
  connector = createHttpServer();
  await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
  vite = await createServer({ configFile: false, plugins: [react()], define: {
    "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(`http://127.0.0.1:${connector.address().port}`),
  }, server: { host: "127.0.0.1", port: 0, strictPort: true } });
  await vite.listen();
  const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  connector.on("request", createApp({ engine: { browserOpen: false }, jobManager: { hasActiveJob: false }, version: "0.5.0",
    getEvaluationStore: async () => store, allowedOrigins: new Set([appUrl]),
    managedFiles: { resolveFileId: async id => ({ id, name: "ficticio.pdf" }) },
  }));
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  const openedUrls = [];
  await context.route("https://wa.me/**", route => {
    openedUrls.push(route.request().url());
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: "WhatsApp simulado; no hay comunicación externa." });
  });
  await context.route("**/api/tts/configuration", route => route.fulfill({ json: configuration }));
  await context.route("**/api/tts/synthesize", route => {
    ttsCalls++;
    return route.fulfill({ contentType: "audio/mpeg", headers: { "X-TTS-Configuration": encodeURIComponent(JSON.stringify(configuration)) }, body: Buffer.from("ID3phase02-synthetic") });
  });
  const page = await context.newPage();
  testPage = page;
  const recover = async () => {
    await page.locator(".detail-actions").filter({ hasText: "cola-ficticia.pdf" }).getByRole("button", { name: "Recuperar lote" }).click();
    await page.getByLabel("Texto final editable PDF").waitFor();
    await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor();
  };
  const selected = page.getByRole("region", { name: "Contacto seleccionado" });
  const waitForFictionalChat = async phone => {
    const deadline = Date.now() + 15000;
    let handledClosure = false;
    while (Date.now() < deadline) {
      if (!handledClosure && (await selected.getByRole('status').textContent()).includes('cierra la conversación anterior')) {
        assert.equal(await selected.getByRole('button', { name: 'Tiene WhatsApp', exact: true }).isDisabled(), true);
        // Explicit operator fallback when Edge refuses programmatic closure.
        for (const previous of context.pages().filter(item => item !== page)) {
          assert.ok(previous.url() === 'about:blank' || previous.url().startsWith('https://wa.me/'));
          await previous.close();
        }
        handledClosure = true;
        await selected.getByRole('button', { name: 'Abrir WhatsApp', exact: true }).click();
      }
      const chat = context.pages().find(item => item !== page && item.url() === `https://wa.me/${phone}`);
      if (chat && await selected.getByRole('button', { name: 'No tiene WhatsApp', exact: true }).isEnabled()) { await chat.getByText("WhatsApp simulado; no hay comunicación externa.", { exact: true }).waitFor(); return; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("No terminó la navegación del chat ficticio; no se declara una comprobación humana antes de verlo.");
  };
  let checkpoint = 0;
  const selectedName = async name => {
    await selected.getByRole("heading", { name: `${name} Ficticio`, exact: true }).waitFor();
    process.stdout.write(`CHECK: contacto/navegación ${++checkpoint}\n`);
  };
  await page.goto(appUrl);
  await recover();
  const persisted = await store.load(active.id);
  assert.equal(persisted.snapshot.workers[0].app_fields.whatsapp_verification.origin, "recuperada");
  assert.equal(Boolean(persisted.snapshot.workers[0].app_fields.recipient_authorization), false);
  await page.getByLabel("Resumen de teléfonos").getByText("conflictos:", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Verificar WhatsApp pendientes" }).click();
  await selectedName("Beto");
  // Exercise popup rejection without bypassing the production confirmation control.
  await page.evaluate(() => { globalThis.testOpenOriginal = window.open; window.open = () => null; });
  await selected.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
  await selected.getByText("Permite ventanas emergentes", { exact: false }).waitFor();
  assert.equal(await selected.getByRole("button", { name: "Tiene WhatsApp", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.open = globalThis.testOpenOriginal; delete globalThis.testOpenOriginal; });
  await selected.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
  await waitForFictionalChat("51999222222");
  await selected.getByRole("button", { name: "Tiene WhatsApp", exact: true }).click();
  await selectedName("Carla");
  reports.push("Análisis, recuperación de existencia sin autorización heredada, popup bloqueado y avance tras guardado.");
  await selected.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
  await waitForFictionalChat("51999333333");
  await selected.getByText("Identidad y autorización para esta evaluación", { exact: true }).click();
  await selected.getByLabel("Identidad del destinatario verificada", { exact: true }).check();
  await selected.getByLabel("Autorización de entrega confirmada", { exact: true }).check();
  await selected.getByLabel("Trabajador y PDF corresponden", { exact: true }).check();
  await selected.getByLabel("Autorización vigente hasta", { exact: true }).fill("2099-01-01T12:00");
  await selected.getByLabel("Guardar estas declaraciones", { exact: false }).check();
  assert.equal(await selected.getByRole("button", { name: "Tiene WhatsApp", exact: true }).isDisabled(), true);
  await selected.getByLabel("Comprobé la identidad para este teléfono compartido", { exact: true }).check();
  await selected.getByRole("button", { name: "Tiene WhatsApp", exact: true }).click();
  await selectedName("Diego");
  // Window.close is asynchronous in Edge: wait for the browser's close event
  // before requiring one checking tab. Keep the same strict final assertion.
  const closeDeadline = Date.now() + 5000;
  while (context.pages().length !== 2 && Date.now() < closeDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(context.pages().length, 2, JSON.stringify(context.pages().map(item => item.url())));
  await selected.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
  await waitForFictionalChat("51999333333");
  assert.equal(await selected.getByRole("button", { name: "No tiene WhatsApp", exact: true }).isEnabled(), true, await selected.getByRole("status").textContent());
  await selected.getByRole("button", { name: "No tiene WhatsApp", exact: true }).click();
  await selectedName("Eva");
  assert.equal(await selected.getByRole("button", { name: "Abrir WhatsApp", exact: true }).isDisabled(), true);
  await selected.getByRole("button", { name: "Revisar después", exact: true }).click();
  await selectedName("Gala");
  await page.getByRole("button", { name: "Volver al panel" }).click();
  await page.reload();
  store = await new EvaluationStore({ directory }).initialize();
  await recover();
  await page.getByRole("button", { name: "Verificar WhatsApp pendientes" }).click();
  await selectedName("Gala");
  reports.push("Duplicados exigen identidad explícita; una ventana reutilizada; inválidos bloqueados; cursor recuperado tras recarga/reapertura.");
  await selected.getByText("Corregir teléfono", { exact: true }).click();
  await selected.getByLabel("Teléfono corregido", { exact: true }).fill("999777778");
  await selected.getByRole("button", { name: "Guardar teléfono", exact: true }).click();
  await selected.getByText("999777778", { exact: false }).first().waitFor();
  assert.equal(await selected.getByRole("button", { name: "Tiene WhatsApp", exact: true }).isDisabled(), true);
  await selected.getByRole("button", { name: "Revisar después", exact: true }).click();
  await page.getByText("No quedan otros contactos en esta vuelta.", { exact: false }).waitFor();
  await page.getByLabel("Filtrar contactos").selectOption("sin-whatsapp");
  await selectedName("Diego");
  await page.getByLabel("Filtrar contactos").selectOption("confirmados");
  await selectedName("Ana");
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await selectedName("Beto");
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await selectedName("Ana");
  await page.getByRole("button", { name: "Volver al panel" }).click();
  // Existence alone must not consume TTS even after clinical approval.
  await page.getByRole("listbox", { name: "Trabajadores extraidos" }).getByRole("option").filter({ hasText: "Beto" }).click();
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  assert.equal(ttsCalls, 0);
  await page.getByRole("listbox", { name: "Trabajadores extraidos" }).getByRole("option").filter({ hasText: "Carla" }).click();
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  await page.getByRole("button", { name: "Generar audio", exact: true }).click();
  await page.locator("audio").waitFor();
  assert.equal(ttsCalls, 1);
  const saved = await store.load(active.id);
  assert.equal(getRecipientChecks(saved.snapshot.workers[2]).authorized, true);
  for (const url of openedUrls) assert.match(url, /^https:\/\/wa\.me\/519\d{8}$/);
  assert.ok(openedUrls.length >= 3);
  reports.push("Corrección invalida verificación, filtros y navegación funcionan; WhatsApp solo bloquea TTS, autorización completa permite uno simulado.");
  for (const report of reports) process.stdout.write(`OK: ${report}\n`);
  process.stdout.write(`TTS: ${ttsCalls} solicitud simulada; cero envíos y cero consultas reales a WhatsApp/MediWeb/ElevenLabs.\n`);
} catch (error) {
  await testPage?.screenshot({ path: path.join(os.tmpdir(), "ae-phase02-functional-failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await vite?.close();
  if (connector) await new Promise(resolve => connector.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
