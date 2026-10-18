// Real Edge + actual DownloaderRunner, pagination, PDF printing/parser and AES/DPAPI.
// All MediWeb/WhatsApp pages and TTS responses are fictional and intercepted.
// EFS output protection is injected ONLY for this disposable fictional fixture.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { DownloaderRunner } from "../mediweb-downloader/src/runner.js";
import { JobManager } from "../mediweb-downloader/src/http/jobManager.js";
import { ProcessingFlow } from "../mediweb-downloader/src/processingFlow.js";
import { createApp } from "../mediweb-downloader/src/http/app.js";
import { createManagedFileService } from "../mediweb-downloader/src/managedFiles.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "ae-phase04-functional-"));
let browser, connector, vite, testPage, engine, store;
let ttsCalls = 0, reportRequests = 0, outputProtectionChecks = 0, failFirstImport = true;
const reports = [];
const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
const origin = "https://resultados.innomedic.pe";
const headers = "<tr><th>Código</th><th>Fecha</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr>";
const row = id => `<tr><td>F${id}</td><td>17/10/2026</td><td>Ficticia</td><td>PERSONA FICTICIA ${id}</td><td>DNI</td><td>APTO</td><td><a href="${origin}/imprimirtodos.php?idcomprobante=${id}&idpaciente=${id}">Reporte</a></td></tr>`;
const search = `<form method="get" action="/atenciones/ocupacional"><label for="empresa">Empresa</label><select id="empresa" name="empresa"><option value="f">Ficticia</option></select><button>Buscar</button></form><table id="resultados">${headers}${row(1)}</table><button id="next" onclick='document.getElementById("resultados").innerHTML=${JSON.stringify(headers + row(1) + row(2))};this.disabled=true'>SIGUIENTE</button>`;
const report = id => `<html><head><style>body{font-family:Arial;font-size:12px}p{margin:16px 0}</style></head><body>${[
  "RESULTADO DE EVALUACION MEDICA", "DATOS DEL TRABAJADOR", `Apellidos y Nombres: FICTICIA PERSONA${id}`,
  `DNI: 0000000${id} Edad: 30 Sexo: F`, "Empresa: FICTICIA Area: PRUEBA", "FECHA DE EVALUACION: 17/10/2026",
  `TELEFONO: 99911111${id}`, "RESUMEN DE RESULTADOS", "PRUEBAS DE LABORATORIO", "APTITUD", "X APTO -", "RECOMENDACIONES", "CONTROL",
].map(line => `<p>${line}</p>`).join("")}</body></html>`;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const mediweb = await browser.newContext();
  await mediweb.route(`${origin}/**`, route => {
    if (route.request().url().includes("imprimirtodos.php")) { reportRequests++; return route.fulfill({ contentType: "text/html", body: report(new URL(route.request().url()).searchParams.get("idcomprobante")) }); }
    return route.fulfill({ contentType: "text/html", body: search });
  });
  const mainPage = await mediweb.newPage(); await mainPage.goto(`${origin}/atenciones/ocupacional`);
  engine = new DownloaderRunner({ runtimePaths: { packaged: false, downloadsDir: path.join(directory, "downloads") }, logger: { log() {}, warn() {} } });
  engine.context = mediweb; engine.mainPage = mainPage;
  store = await new EvaluationStore({ directory: path.join(directory, "vault") }).initialize();
  const manager = new JobManager({ engine });
  const processing = new ProcessingFlow({ engine, jobManager: manager, getStore: async () => store,
    protectOutput: async () => { outputProtectionChecks++; }, // Fictional files only. Production defaults enforce EFS.
  });
  connector = createHttpServer(); await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
  vite = await createServer({ configFile: false, plugins: [react()], define: { "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(`http://127.0.0.1:${connector.address().port}`) }, server: { host: "127.0.0.1", port: 0, strictPort: true } });
  await vite.listen(); const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  connector.on("request", createApp({ engine, jobManager: manager, processingService: processing,
    getEvaluationStore: async () => store, managedFiles: createManagedFileService({ downloadsDir: path.join(directory, "downloads") }), version: "0.5.0", allowedOrigins: new Set([appUrl]) }));
  const context = await browser.newContext();
  await context.route("**/jobs/*/first-pages", route => {
    if (failFirstImport) { failFirstImport = false; return route.fulfill({ contentType: "application/pdf", body: "fixture-invalid-pdf" }); }
    return route.continue();
  });
  await context.route("**/api/tts/configuration", route => route.fulfill({ json: configuration }));
  await context.route("**/api/tts/synthesize", route => { ttsCalls++; return route.fulfill({ contentType: "audio/mpeg", headers: { "X-TTS-Configuration": encodeURIComponent(JSON.stringify(configuration)) }, body: Buffer.from("ID3phase04-synthetic") }); });
  await context.route("https://wa.me/**", route => route.fulfill({ contentType: "text/html", body: "Comprobación ficticia" }));
  const page = await context.newPage(); testPage = page;
  await page.goto(appUrl);
  const panel = page.getByRole("region", { name: "Procesamiento completo MediWeb" });
  await panel.getByRole("button", { name: "Iniciar procesamiento completo", exact: true }).click();
  await panel.getByText("Prepara la búsqueda", { exact: false }).waitFor(); assert.equal(reportRequests, 0);
  await panel.getByRole("checkbox", { name: "Confirmo que los filtros", exact: false }).check();
  await panel.getByText("Guardar la búsqueda confirmada", { exact: true }).click();
  await panel.getByLabel("Nombre de búsqueda").fill("Empresa ficticia");
  await panel.getByRole("button", { name: "Guardar búsqueda confirmada", exact: true }).click();
  await panel.getByText("Búsqueda confirmada guardada", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Iniciar procesamiento completo", exact: true }).click();
  await panel.getByText("No se completó la extracción", { exact: false }).waitFor({ timeout: 90000 });
  assert.equal(reportRequests, 2); assert.equal(ttsCalls, 0);
  await panel.getByText("Recuperar procesos anteriores", { exact: true }).click();
  await panel.getByRole("button", { name: "Recuperar proceso", exact: true }).click();
  await page.getByLabel("Texto final editable PDF").waitFor({ timeout: 90000 });
  await panel.getByText("Lote procesado y guardado", { exact: false }).waitFor();
  assert.equal(reportRequests, 2); assert.equal(outputProtectionChecks, 1); assert.equal(ttsCalls, 0);
  const state = await store.processingState(), run = state.runs[0];
  const batch = await store.load(run.batch_id);
  assert.equal(batch.snapshot.workers.length, 2);
  assert.equal(batch.snapshot.workers.every(worker => worker.clinical_approval.status === "pendiente" && !worker.derived_states.reviewed_by_user && worker.app_fields.texto_final && worker.datos_operativos.archivo_pdf_completo_id), true);
  reports.push("Un botón aplica perfil confirmado, pagina/deduplica y descarga ambos PDF; parser y narrativas reales guardan dos evaluaciones sin aprobación ni TTS.");
  reports.push("Fallo de importación inyectado: recuperación explícita relee los PDF guardados, sin otra descarga ni aprobación ficticia.");
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Abrir WhatsApp para comprobar número" }).click();
  await page.getByRole("button", { name: "Sí, puedo escribirle" }).click();
  await page.locator('.pdf-detail-panel input[type="datetime-local"]').fill("2099-01-01T12:00");
  await page.locator('.pdf-detail-panel input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Generar audio", exact: true }).click(); await page.locator("audio").waitFor();
  assert.equal(ttsCalls, 1);
  await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor();
  await page.reload(); store = await new EvaluationStore({ directory: path.join(directory, "vault") }).initialize();
  await panel.getByText("Recuperar procesos anteriores", { exact: true }).click();
  await panel.getByRole("button", { name: "Recuperar proceso", exact: true }).click();
  await page.locator("audio").waitFor(); assert.equal(ttsCalls, 1); assert.equal(reportRequests, 2);
  await page.getByRole("region", { name: "Generación masiva de audios" }).getByRole("button", { name: "Generar audios autorizados", exact: true }).click();
  await page.getByText("Reutilizables: 1", { exact: false }).waitFor(); assert.equal(ttsCalls, 1);
  reports.push("Aprobación y destinatario explícitos habilitan solo un TTS simulado; recarga y reapertura del almacén conservan autorización/aprobación/MP3 y la cola masiva lo identifica reutilizable.");
  process.stdout.write(JSON.stringify({ browser: "Edge headless real", reports, reportRequestsSimulated: reportRequests, ttsRequestsSimulated: ttsCalls, realProviderRequests: 0, efs: "simulado solo en el fixture; producción exige EFS" }, null, 2) + "\n");
} catch (error) {
  if (testPage) process.stderr.write((await testPage.locator("body").innerText()).slice(-13000) + "\n");
  throw error;
} finally {
  await browser?.close(); await vite?.close(); if (connector) await new Promise(resolve => connector.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
