import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { startControlledPreview } from "./controlled-processing-preview.mjs";

const preview = await startControlledPreview(4186, { manualResultsOnly: true, resultsInNewTab: true });
const context = await preview.browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const captures = "artifacts/simple-operator-flow";
await mkdir(captures, { recursive: true });
let page;
const actions = [], drafts = [], errors = [];
const heartbeat = setInterval(() => console.log(`PROGRESS reports=${preview.stats.reportRequests}/16 localTts=${preview.stats.ttsRequests} attachments=${preview.stats.reveals}`), 20000);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const shot = async name => {
  await page.screenshot({ path: `${captures}/${name}.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(`CAPTURE ${name}`);
};
try {
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if ([preview.url, preview.connectorUrl].includes(url.origin) || ["blob:", "data:"].includes(url.protocol)) {
      if (url.pathname === "/deliveries" && request.method() === "POST") actions.push(JSON.parse(request.postData()).action);
      if (url.pathname.startsWith("/__fixture/chat")) drafts.push(url.searchParams.get("text"));
      return route.continue();
    }
    preview.stats.actualExternalRequests++; return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(preview.url);
  const mediweb = page.getByRole("region", { name: "MediWeb", exact: true });
  await mediweb.getByRole("button", { name: "Detectar evaluaciones", exact: true }).waitFor();
  assert.equal(await page.getByText(/Historial y recuperaci|Descarga por pasos y opciones anteriores|Guardar esta b/).count(), 0);
  await shot("01-descarga-por-pasos-visible");
  const download = async () => {
    await mediweb.getByRole("button", { name: "Detectar evaluaciones", exact: true }).click();
    await mediweb.getByRole("radio", { name: /^Ambos/ }).waitFor();
    assert.equal(await mediweb.getByRole("radio", { name: /^Ambos/ }).isChecked(), true);
    await mediweb.getByRole("button", { name: "Preparar y generar reportes", exact: true }).click();
  };
  await download();
  await page.getByRole("heading", { name: "Procesando MediWeb", exact: true }).waitFor();
  await shot("02-descargando");
  await page.getByRole("heading", { name: "Importación desde MediWeb completada", exact: true }).waitFor({ timeout: 420000 });
  assert.equal(preview.stats.reportRequests, 8);
  const first = (await preview.store.catalogue()).data.batches.find(batch => batch.snapshot.workers.length === 8);
  assert.ok(first);
  const originals = await Promise.all(first.snapshot.workers.map(worker => preview.files.inspectFile(worker.datos_operativos.archivo_pdf_completo_id, ".pdf")));
  const beforeReload = hash(await readFile(path.join(preview.directory, "vault", "catalogue.enc")));
  await shot("03-ocho-evaluaciones-listas");
  await page.reload();
  await mediweb.getByRole("button", { name: "Detectar evaluaciones", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Importación desde MediWeb completada", exact: true }).count(), 0);
  assert.equal(hash(await readFile(path.join(preview.directory, "vault", "catalogue.enc"))), beforeReload);
  await shot("04-sin-memoria-del-ultimo-lote");
  await download();
  await page.getByRole("heading", { name: "Importación desde MediWeb completada", exact: true }).waitFor({ timeout: 420000 });
  assert.equal(preview.stats.reportRequests, 16, "Same search can be downloaded again");
  for (const original of originals) assert.equal((await preview.files.inspectFile(original.id, ".pdf")).sha256, original.sha256);
  await shot("05-misma-busqueda-descargada-otra-vez");
  await mediweb.getByRole("button", { name: "Verificar WhatsApp", exact: true }).click();
  const contact = page.getByRole("region", { name: "Contacto seleccionado" });
  for (let index = 1; index <= 8; index++) {
    await contact.getByRole("heading", { name: new RegExp(`Persona${index}`, "i") }).waitFor();
    await contact.getByRole("button", { name: "Abrir WhatsApp", exact: true }).click();
    await contact.getByRole("button", { name: index === 3 ? "No tiene WhatsApp" : "Tiene WhatsApp", exact: true }).click();
  }
  assert.equal(drafts.length, 8); assert.ok(drafts.every(draft => draft === null));
  await page.getByRole("button", { name: "Continuar con texto clínico", exact: true }).click();
  await page.getByRole("textbox", { name: "Texto final editable PDF" }).waitFor();
  for (let index = 0; index < 8; index++) {
    await page.getByRole("button", { name: /^Aprobar texto clínico/ }).click();
    if (index === 2) {
      await page.getByRole("option", { name: /FICTICIA PERSONA3/i }).click();
      await page.getByRole("button", { name: "Generar audio", exact: true }).click();
      await page.getByRole("button", { name: "Generando audio...", exact: true }).waitFor();
      await shot("06-audio-sin-whatsapp");
      await page.getByRole("button", { name: "Recuperar audio guardado", exact: true }).waitFor({ timeout: 180000 });
      await page.getByRole("option", { name: /FICTICIA PERSONA4/i }).click();
    }
  }
  await page.getByRole("button", { name: "Generar audios masivos", exact: true }).click();
  await page.getByText("8 textos aprobados · 8 MP3 guardados", { exact: true }).waitFor({ timeout: 240000 });
  await page.getByRole("button", { name: "Continuar con envíos", exact: true }).waitFor({ timeout: 240000 });
  assert.equal(preview.stats.ttsRequests, 8);
  await shot("07-audios-masivos");
  await page.getByRole("button", { name: "Continuar con envíos", exact: true }).click();
  const recipient = page.getByRole("region", { name: "Entrega seleccionada" });
  await recipient.getByRole("heading", { name: /Persona1/i }).waitFor();
  await recipient.getByRole("button", { name: "Confirmar destinatario y preparar envío", exact: true }).click();
  await page.getByText("Conversación abierta con el saludo preparado", { exact: false }).waitFor({ timeout: 240000 });
  assert.equal(preview.stats.reveals, 2);
  assert.equal(drafts.at(-1), (await preview.store.catalogue()).data.deliveries[0].message);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(await page.getByText(/Confirmo que envi|Conciliar|Declaraciones de envío|parcial o incierto/).count(), 0);
  await shot("08-chat-adjuntos-y-siguiente-sin-registros");
  await recipient.getByRole("button", { name: "Siguiente trabajador", exact: true }).click();
  await recipient.getByRole("heading", { name: /Persona2/i }).waitFor();
  assert.ok(actions.every(action => !["complete", "confirm", "uncertain", "reconcile"].includes(action)));
  assert.deepEqual((await preview.store.catalogue()).data.deliveries[0].confirmations, {});
  assert.notEqual((await preview.store.catalogue()).data.deliveries[0].state, "completada");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("09-envio-movil");
  await page.reload();
  await mediweb.getByRole("button", { name: "Detectar evaluaciones", exact: true }).waitFor();
  assert.equal(preview.stats.reportRequests, 16); assert.equal(preview.stats.ttsRequests, 8);
  assert.equal(preview.stats.actualExternalRequests, 0); assert.deepEqual(errors, []);
  const result = { passed: true, ...preview.stats, sameSearchDownloadedTwice: true, noAutomaticBatchRestore: true, noHistoryInUi: true, noSendDeclarations: true, nextWorkerNeverClaimsSent: true, originalsUnchanged: true, verificationHasNoMessage: true, deliveryHasGreeting: true, realWindowsProtection: true, errors };
  await writeFile(`${captures}/results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: `${captures}/failure.png`, fullPage: true }).catch(() => {});
  console.error((await page?.locator("body").innerText())?.slice(-5000)); throw error;
} finally { clearInterval(heartbeat); await context.close(); await preview.stop(); }
