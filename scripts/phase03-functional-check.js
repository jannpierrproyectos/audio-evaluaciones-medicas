// Actual Edge and temporary DPAPI/AES Connector; all voice requests intercepted.
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
import { approveClinicalText } from "../src/lib/clinicalApproval.js";
import { sha256 } from "../src/lib/evaluationPersistence.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "ae-phase03-functional-"));
let store, connector, vite, browser, testPage;
let ttsCalls = 0, delayed = true, release;
const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
const text = "Buenos días. Texto ficticio para comprobar la cola de audio.";
const reports = [];
try {
  store = await new EvaluationStore({ directory }).initialize();
  const input = prepareAnalysisForReview({ file_name: "lote-masivo-ficticio.pdf", workers: Array.from({ length: 5 }, (_, index) => ({
    identificacion: { nombres: `Persona${index}`, apellidos: "Ficticia", dni: `0000000${index}`, fecha_evaluacion: "17/10/2026" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
    ...(index === 4 ? { datos_operativos: { telefono: "123" } } : {}),
  })) }, "pdf");
  const active = await store.import({ ...input, greeting: "Buenos días" }, await sha256("phase03-functional"));
  active.snapshot.workers = active.snapshot.workers.map((worker, index) => index === 3 ? worker : approveClinicalText(worker, text));
  await store.save(active.id, active.snapshot, active.revision);
  connector = createHttpServer(); await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
  vite = await createServer({ configFile: false, plugins: [react()], define: {
    "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(`http://127.0.0.1:${connector.address().port}`),
  }, server: { host: "127.0.0.1", port: 0, strictPort: true } });
  await vite.listen();
  const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  connector.on("request", createApp({ engine: { browserOpen: false }, jobManager: { hasActiveJob: false }, version: "0.5.0",
    allowedOrigins: new Set([appUrl]), getEvaluationStore: async () => store,
    managedFiles: { resolveFileId: async id => ({ id, name: "ficticio.pdf" }) },
  }));
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.route("**/api/tts/configuration", route => route.fulfill({ json: configuration }));
  await context.route("**/api/tts/synthesize", async route => {
    ttsCalls++;
    if (delayed) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: "audio/mpeg", headers: { "X-TTS-Configuration": encodeURIComponent(JSON.stringify(configuration)) }, body: Buffer.from("ID3phase03-synthetic-not-real-voice") });
  });
  const page = await context.newPage(); testPage = page;
  // Deny any accidental request to a real TTS host even if the application changes.
  await context.route(/https?:\/\/(?!127\.0\.0\.1[:/]).*/, route => route.abort());
  const recover = async () => {
    await page.locator(".detail-actions").filter({ hasText: "lote-masivo-ficticio.pdf" }).getByRole("button", { name: "Recuperar lote" }).click();
    await page.getByLabel("Texto final editable PDF").waitFor();
    await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor();
  };
  const panel = page.getByRole("region", { name: "Generación masiva de audios" });
  const start = async (accept = true, resume = false) => {
    page.once("dialog", dialog => accept ? dialog.accept() : dialog.dismiss());
    await panel.getByRole("button", { name: resume ? "Continuar generación" : "Iniciar generación (confirmar)", exact: true }).click();
  };
  const waitPersisted = async predicate => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (predicate((await store.load(active.id)).snapshot)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("No se alcanzó el estado persistido esperado.");
  };
  await page.goto(appUrl); await recover();
  await panel.getByRole("button", { name: "Generar audios autorizados", exact: true }).click();
  await panel.getByText("Nuevos: 3", { exact: false }).waitFor();
  assert.equal(ttsCalls, 0);
  await start(false); assert.equal(ttsCalls, 0);
  reports.push("Preflight mixto: 3 autorizados y 2 bloqueados; estimación y rechazo de confirmación sin TTS.");
  await start();
  await waitPersisted(snapshot => snapshot.workers[0].app_fields.audio_status === "generando");
  await panel.getByRole("button", { name: "Pausar generación", exact: true }).click();
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  delayed = false; release();
  await waitPersisted(snapshot => snapshot.bulk_audio_queue.items[0].status === "completado");
  assert.equal(ttsCalls, 1);
  await page.reload(); store = await new EvaluationStore({ directory }).initialize(); await recover();
  await panel.getByText("Cola: pausada", { exact: false }).waitFor(); assert.equal(ttsCalls, 1);
  await start(true, true);
  await waitPersisted(snapshot => snapshot.bulk_audio_queue.status === "terminada");
  assert.equal(ttsCalls, 3);
  reports.push("Pausa guarda el MP3 iniciado y conserva pendientes; recarga y reinicio del almacén no reenvían; continuación confirmada termina 3 MP3.");
  await panel.getByRole("button", { name: "Generar audios autorizados", exact: true }).click();
  await panel.getByText("Reutilizables: 3", { exact: false }).waitFor();
  await start(); await waitPersisted(snapshot => snapshot.bulk_audio_queue.status === "terminada" && snapshot.bulk_audio_queue.items.filter(item => item.status === "reutilizado").length === 3);
  assert.equal(ttsCalls, 3);
  await page.getByRole("button", { name: "Regenerar audio", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Cambios guardados" }).waitFor(); assert.equal(ttsCalls, 3);
  reports.push("Repetición masiva e individual reutilizan 3 MP3 sin más llamadas; descargas disponibles.");
  await page.getByLabel("Texto final editable PDF").fill(`${text} Editado antes del lote.`);
  await page.getByRole("button", { name: "Aprobar texto clínico", exact: true }).click();
  await panel.getByRole("button", { name: "Generar audios autorizados", exact: true }).click();
  await panel.getByText("Nuevos: 1", { exact: false }).waitFor(); delayed = true; release = null;
  await start(); await waitPersisted(snapshot => snapshot.workers[0].app_fields.audio_status === "generando");
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  await page.getByLabel("Texto final editable PDF").fill(`${text} Cambio durante síntesis.`);
  release(); await waitPersisted(snapshot => snapshot.bulk_audio_queue.status === "terminada");
  const saved = await store.load(active.id);
  assert.equal(saved.snapshot.workers[0].app_fields.audio_stale, true);
  assert.equal(saved.snapshot.bulk_audio_queue.items[0].status, "bloqueado");
  assert.equal(ttsCalls, 4);
  assert.equal(await panel.locator("li").first().getByRole("button", { name: "Ver MP3" }).count(), 0);
  reports.push("Edición durante síntesis: respuesta tardía cifrada y obsoleta; sin descarga ofrecida como vigente.");
  await panel.getByRole("button", { name: "Generar audios autorizados", exact: true }).click();
  await panel.getByText("Reutilizables: 2", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Cancelar pendientes", exact: true }).click();
  await waitPersisted(snapshot => snapshot.bulk_audio_queue.status === "cancelada");
  assert.equal(ttsCalls, 4);
  reports.push("Cancelar una nueva cola preparada conserva el historial y no solicita voz.");
  process.stdout.write(JSON.stringify({ browser: "Microsoft Edge headless real", reports, simulatedTtsRequests: ttsCalls, realTtsRequests: 0 }, null, 2) + "\n");
} catch (error) {
  if (testPage) process.stderr.write((await testPage.locator("body").innerText()).slice(-12000) + "\n");
  throw error;
} finally {
  release?.(); await browser?.close(); await vite?.close();
  if (connector) await new Promise(resolve => connector.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
