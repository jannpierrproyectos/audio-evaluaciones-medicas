// Isolated functional check: synthetic data, encrypted temporary store, simulated TTS.
// Requires Connector dependencies and an installed Microsoft Edge. No real MediWeb/TTS calls.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
import pdfLib from "../mediweb-downloader/node_modules/pdf-lib/cjs/index.js";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { createApp } from "../mediweb-downloader/src/http/app.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { sha256 } from "../src/lib/evaluationPersistence.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "ae-functional-"));
const { PDFDocument, StandardFonts } = pdfLib;
let store;
let connector;
let vite;
let browser;
let ttsCalls = 0;
let finishTts = null;
let delayTts = false;
const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: { speed: 0.9 }, language: "es", format: "mp3", contract: 1 };
const reports = [];
try {
  store = await new EvaluationStore({ directory }).initialize();
  const makeSnapshot = source => ({ ...prepareAnalysisForReview({ file_name: `ficticio-${source}.pdf`, workers: [{
    identificacion: { nombres: "Persona", apellidos: "Ficticia", dni: "00000000", fecha_evaluacion: "17/10/2026" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
    ...(source === "mediweb" ? { datos_operativos: { telefono: "999888777", archivo_pdf_completo: "ficticio.pdf", archivo_pdf_completo_id: "ficticio/ficticio.pdf" } } : {}),
  }] }, source), greeting: "Buenos días" });
  const manual = await store.import(makeSnapshot("pdf"), await sha256("functional-manual"));
  const mediweb = await store.import(makeSnapshot("mediweb"), await sha256("functional-mediweb"));
  const origins = new Set();
  connector = createHttpServer(createApp({
    engine: { browserOpen: false }, jobManager: { hasActiveJob: false }, version: "0.5.0", allowedOrigins: origins,
    getEvaluationStore: async () => store,
    managedFiles: { resolveFileId: async id => ({ id, name: "ficticio.pdf" }) },
  }));
  // createApp copies the allowed set, so supply the configured Vite port in advance.
  await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
  const connectorUrl = `http://127.0.0.1:${connector.address().port}`;
  vite = await createServer({ configFile: false, plugins: [react()],
    define: { "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(connectorUrl) },
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  await vite.listen();
  const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  // Recreate the handler with the actual ephemeral UI origin.
  connector.removeAllListeners("request");
  connector.on("request", createApp({ engine: { browserOpen: false }, jobManager: { hasActiveJob: false }, version: "0.5.0",
    allowedOrigins: new Set([appUrl]), getEvaluationStore: async () => store,
    managedFiles: { resolveFileId: async id => ({ id, name: "ficticio.pdf" }) },
  }));
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.route("**/api/tts/configuration", route => route.fulfill({ json: configuration }));
  await context.route("**/api/tts/synthesize", async route => {
    ttsCalls++;
    if (delayTts) await new Promise(resolve => { finishTts = resolve; });
    await route.fulfill({ contentType: "audio/mpeg", headers: {
      "X-TTS-Configuration": encodeURIComponent(JSON.stringify(configuration)),
      "Content-Disposition": 'attachment; filename="ficticio.mp3"',
    }, body: Buffer.from("ID3synthetic-functional-check") });
  });
  await context.route("https://wa.me/**", route => route.fulfill({ contentType: "text/html", body: "Chat simulado" }));
  const page = await context.newPage();
  const recover = async name => {
    const row = page.locator(".detail-actions").filter({ hasText: name });
    await row.getByRole("button", { name: "Recuperar lote" }).click();
    await page.getByLabel("Texto final editable PDF").waitFor();
    await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor();
  };
  await page.goto(appUrl);
  await recover("ficticio-pdf.pdf");
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  assert.ok((await page.getByLabel("Texto final editable PDF").inputValue()).length > 0);
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  await page.getByRole("button", { name: "Generar audio", exact: true }).click();
  await page.locator("audio").waitFor();
  assert.equal(ttsCalls, 1);
  reports.push("Fase00: borrador visible, importación sin aprobación, aprobación explícita y TTS individual simulado.");
  await page.reload();
  store = await new EvaluationStore({ directory }).initialize();
  await recover("ficticio-pdf.pdf");
  await page.locator("audio").waitFor();
  await page.getByRole("button", { name: "Regenerar audio", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor();
  assert.equal(ttsCalls, 1);
  reports.push("Reinicio del almacenamiento y recarga: aprobación y MP3 recuperados; reutilización sin otra llamada TTS.");
  await page.getByLabel("Texto final editable PDF").fill("Buenos días. Texto ficticio editado.");
  assert.equal(await page.getByRole("button", { name: "Regenerar audio", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  delayTts = true;
  await page.getByRole("button", { name: "Regenerar audio", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Generando audio..."));
  while (!finishTts) await new Promise(resolve => setTimeout(resolve, 50));
  await page.getByLabel("Texto final editable PDF").fill("Buenos días. Cambio durante solicitud.");
  finishTts();
  await page.getByText("El texto fue editado despues del ultimo audio.", { exact: false }).waitFor();
  assert.equal(ttsCalls, 2);
  reports.push("Edición durante TTS: respuesta obsoleta y nueva aprobación requerida.");
  delayTts = false;
  await recover("ficticio-mediweb.pdf");
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Abrir WhatsApp para comprobar número" }).click();
  await page.getByRole("button", { name: "Sí, puedo escribirle" }).click();
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  await page.locator('input[type="datetime-local"]').fill("2099-01-01T12:00");
  await page.getByRole("checkbox", { name: /Confirmo la identidad del destinatario/ }).check();
  await page.getByRole("button", { name: "Generar audio", exact: true }).click();
  await page.locator("audio").waitFor();
  assert.equal(ttsCalls, 3);
  await page.getByRole("checkbox", { name: /Confirmo la identidad del destinatario/ }).uncheck();
  assert.equal(await page.getByRole("button", { name: "Regenerar audio", exact: true }).isDisabled(), true);
  reports.push("MediWeb simulado: WhatsApp no sustituye autorización; fecha/identidad/PDF exigidos; revocación bloquea TTS.");
  // Real browser upload of a minimal digital PDF with entirely fictitious data.
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pdfPage = pdf.addPage();
  ["RESULTADO DE EVALUACION MEDICA", "DATOS DEL TRABAJADOR", "Apellidos y Nombres: FICTICIA PERSONA", "DNI: 00000000 Edad: 30 Sexo: F", "Empresa: PRUEBA Area: PRUEBA", "FECHA DE EVALUACION: 17/10/2026", "RESUMEN DE RESULTADOS", "PRUEBAS DE LABORATORIO", "APTITUD: APTO", "RECOMENDACIONES: CONTROL"].forEach((line, index) => pdfPage.drawText(line, { x: 40, y: 780 - index * 22, size: 10, font }));
  await page.getByRole("button", { name: "Cargar PDF", exact: false }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "importacion-ficticia.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByLabel("Texto final editable PDF").waitFor();
  assert.equal(await page.getByRole("button", { name: "Generar audio", exact: true }).isDisabled(), true);
  reports.push("Carga manual de PDF digital ficticio en navegador: extracción y guardado sin aprobación automática.");
  assert.equal((await store.load(manual.id)).snapshot.workers.length, 1);
  assert.equal((await store.load(mediweb.id)).snapshot.workers.length, 1);
  for (const report of reports) process.stdout.write(`OK: ${report}\n`);
  process.stdout.write(`TTS simulado: ${ttsCalls} solicitudes; cero llamadas a proveedores o MediWeb reales.\n`);
} finally {
  await browser?.close();
  await vite?.close();
  if (connector) await new Promise(resolve => connector.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
