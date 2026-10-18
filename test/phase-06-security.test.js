import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/tts/synthesize.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { approveClinicalText } from "../src/lib/clinicalApproval.js";
import { planBulkAudio, recoverBulkQueue } from "../src/lib/bulkAudio.js";

test("Fase06: un error del proveedor no expone texto, secretos ni cuerpo remoto en respuesta o logs", async () => {
  const originalFetch = globalThis.fetch, originalLog = console.error, originalUrl = process.env.TTS_SERVICE_URL;
  const logs = []; process.env.TTS_SERVICE_URL = "https://tts.ficticio.invalid";
  const proxy = process.env.INSTITUTIONAL_PROXY_TOKEN, service = process.env.TTS_SERVICE_ACCESS_TOKEN;
  process.env.INSTITUTIONAL_PROXY_TOKEN = "ficticio-proxy-".repeat(4); process.env.TTS_SERVICE_ACCESS_TOKEN = "ficticio-service-".repeat(4);
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "MARCADOR_PRIVADO clave_ficticia" }), { status: 429 });
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const response = await POST(new Request("http://localhost/api/tts/synthesize", { method: "POST", headers: { Authorization: `Bearer ${process.env.INSTITUTIONAL_PROXY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: "MARCADOR_PRIVADO" }) }));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /MARCADOR_PRIVADO|clave_ficticia/);
    assert.deepEqual(logs, ["TTS_REQUEST_FAILED"]);
  } finally {
    globalThis.fetch = originalFetch; console.error = originalLog;
    if (originalUrl === undefined) delete process.env.TTS_SERVICE_URL; else process.env.TTS_SERVICE_URL = originalUrl;
    if (proxy === undefined) delete process.env.INSTITUTIONAL_PROXY_TOKEN; else process.env.INSTITUTIONAL_PROXY_TOKEN = proxy;
    if (service === undefined) delete process.env.TTS_SERVICE_ACCESS_TOKEN; else process.env.TTS_SERVICE_ACCESS_TOKEN = service;
  }
});

test("Fase06: lote de 500 evaluaciones clasifica bloqueos y recuperación incierta sin sintetizar", async () => {
  const batchId = crypto.randomUUID(), text = "Buenos días. Narrativa ficticia para prueba de volumen.";
  const analysis = prepareAnalysisForReview({ workers: Array.from({ length: 500 }, (_, i) => ({
    identificacion: { dni: String(i).padStart(8, "0"), nombres: `Ficticia${i}` }, aptitud_y_recomendaciones: { aptitud_final: "APTO" },
  })) }, "pdf");
  const workers = analysis.workers.map((worker, i) => {
    const bound = { ...worker, batch_id: batchId, evaluation_id: crypto.randomUUID() };
    return i % 5 ? approveClinicalText(bound, text) : bound;
  });
  let queries = 0;
  const queue = await planBulkAudio({ ...analysis, batch_id: batchId, greeting: "Buenos días", workers }, { provider: "simulado", format: "mp3", model: "ficticio" }, {
    request: async body => { assert.equal(body.action, "operation"); queries++; return { status: "nuevo" }; },
  });
  assert.equal(queue.items.length, 500); assert.equal(queries, 400);
  assert.equal(queue.items.filter(item => item.status === "bloqueado").length, 100);
  queue.items.find(item => item.status === "pendiente").status = "generando";
  const recovered = recoverBulkQueue(queue, workers);
  assert.equal(recovered.status, "pausada"); assert.equal(recovered.items.filter(item => item.status === "incierto").length, 1);
});
