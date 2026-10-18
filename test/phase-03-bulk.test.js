import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { EvaluationRepository, generatePersistentAudio, sha256, recoverAudio } from "../src/lib/evaluationPersistence.js";
import { approveClinicalText, reconcileWorkerReview } from "../src/lib/clinicalApproval.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { BulkAudioRunner, planBulkAudio, recoverBulkQueue, estimateCredits } from "../src/lib/bulkAudio.js";
import { recordWhatsAppDecision } from "../src/lib/whatsappReview.js";

const text = "Buenos días. Texto ficticio de prueba sin información médica real.";
const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-bulk-test-"));
  let store = await new EvaluationStore({ directory, protection }).initialize();
  const request = async (body, binary) => {
    if (body.action === "import") return store.import(body.snapshot, body.importKey);
    if (body.action === "save") return store.save(body.id, body.snapshot, body.revision);
    if (body.action === "load") return store.load(body.id);
    if (body.action === "reserve") return store.reserve(body.batchId, body.evaluationId, body.fingerprint);
    if (body.action === "operation") return store.operation(body.evaluationId, body.fingerprint);
    if (body.action === "cancel-unsent") return store.cancelUnsent(body.operationId);
    if (body.action === "complete") return store.complete(body.operationId, Buffer.from(body.audio, "base64"), body.metadata);
    if (body.action === "audio") { assert.equal(binary, true); return new Blob([(await store.audio(body.batchId, body.evaluationId, body.operationId)).bytes], { type: "audio/mpeg" }); }
    assert.fail(body.action);
  };
  let repository = new EvaluationRepository(request);
  const input = prepareAnalysisForReview({ workers: Array.from({ length: 4 }, (_, index) => ({
    identificacion: { nombres: `Ficticia${index}`, dni: `0000000${index}`, fecha_evaluacion: "17/10/2026" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
  })) }, "pdf");
  const imported = await repository.import({ ...input, greeting: "Buenos días" }, await sha256("bulk-ficticio"));
  let snapshot = { ...imported.snapshot, workers: imported.snapshot.workers.map(worker => approveClinicalText(worker, text)) };
  await repository.save(snapshot);
  let calls = 0, implementation = async () => {
    const audioBlob = new Blob(["ID3bulk-synthetic-not-real-audio"], { type: "audio/mpeg" });
    return { audioBlob, audioUrl: URL.createObjectURL(audioBlob), audioFilename: "ficticio.mp3", mimeType: "audio/mpeg", ttsText: text, configuration };
  };
  const save = async queue => { snapshot = { ...snapshot, bulk_audio_queue: queue }; await repository.save(snapshot); };
  const update = async (id, change) => {
    snapshot = { ...snapshot, workers: snapshot.workers.map(worker => worker.evaluation_id === id ? reconcileWorkerReview(worker, change(worker)) : worker) };
    await repository.save(snapshot);
  };
  const run = async item => {
    const current = () => snapshot.workers.find(worker => worker.evaluation_id === item.evaluation_id);
    return generatePersistentAudio({ repository, worker: current(), text, configuration,
      current, update: change => update(item.evaluation_id, change), synthesize: async () => { calls++; return implementation(); } });
  };
  const plan = async () => { const queue = await planBulkAudio(snapshot, configuration, repository); await save(queue); return queue; };
  const runner = () => new BulkAudioRunner({ getSnapshot: () => snapshot, save, run, configuration });
  try { await callback({ get snapshot() { return snapshot; }, get calls() { return calls; }, get repository() { return repository; },
    directory, plan, runner, update, save, run, setSynthesize: value => { implementation = value; },
    restart: async () => { store = await new EvaluationStore({ directory, protection }).initialize(); repository = new EvaluationRepository(request); snapshot = (await repository.load(imported.id)).snapshot;
      snapshot.workers = await Promise.all(snapshot.workers.map(worker => recoverAudio(worker, snapshot.greeting, repository, configuration)));
      snapshot.bulk_audio_queue = recoverBulkQueue(snapshot.bulk_audio_queue, snapshot.workers); await repository.save(snapshot); },
  }); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Fase03: lote mixto excluye sin aprobación y destinatario incompleto; generación y reutilización sin créditos reales", async () => fixture(async f => {
  await f.update(f.snapshot.workers[2].evaluation_id, worker => ({ ...worker, clinical_approval: { status: "pendiente" } }));
  await f.update(f.snapshot.workers[3].evaluation_id, worker => ({ ...worker, datos_operativos: { telefono: "123" } }));
  const queue = await f.plan();
  assert.equal(queue.items.filter(item => item.status === "bloqueado").length, 2);
  await f.runner().start(queue); assert.equal(f.calls, 2);
  assert.equal(f.snapshot.bulk_audio_queue.items.filter(item => item.status === "completado").length, 2);
  const next = await f.plan(); assert.equal(next.items.filter(item => item.reusable).length, 2);
  assert.equal(next.estimate.characters, 0);
  await f.runner().start(next); assert.equal(f.calls, 2);
  assert.equal(f.snapshot.bulk_audio_queue.items.filter(item => item.status === "reutilizado").length, 2);
}));

test("Fase03: concurrencia limitada y doble inicio no duplica solicitudes", async () => fixture(async f => {
  const queue = await f.plan(); queue.concurrency = 2; await f.save(queue);
  const gate = deferred(), entered = deferred(); let simultaneous = 0, max = 0;
  f.setSynthesize(async () => { simultaneous++; max = Math.max(max, simultaneous); if (simultaneous === 2) entered.resolve(); await gate.promise; simultaneous--; throw new Error("simulated timeout"); });
  const runner = f.runner(); const started = runner.start(queue); await entered.promise;
  await runner.start(queue); assert.equal(f.calls, 2);
  gate.resolve(); await started; assert.equal(max, 2); assert.equal(f.calls, 4);
  assert.equal(f.snapshot.bulk_audio_queue.items.every(item => item.status === "incierto"), true);
  const next = await f.plan(); assert.equal(next.items.every(item => item.status === "bloqueado"), true);
  await f.runner().start(next); assert.equal(f.calls, 4);
}));

for (const scenario of ["texto", "identidad", "aprobacion"]) {
  test(`Fase03: cambio de ${scenario} después de estimar bloquea sin TTS`, async () => fixture(async f => {
    const queue = await f.plan();
    for (const worker of f.snapshot.workers) await f.update(worker.evaluation_id, value => scenario === "texto"
      ? { ...value, app_fields: { ...value.app_fields, texto_final: `${text} Cambio.` } }
      : scenario === "identidad" ? { ...value, identificacion: { ...value.identificacion, dni: "11111111" } }
        : approveClinicalText(value, text));
    await f.runner().start(queue); assert.equal(f.calls, 0);
    assert.equal(f.snapshot.bulk_audio_queue.items.every(item => item.status === "bloqueado"), true);
  }));
}

for (const action of ["pause", "cancel"]) {
  test(`Fase03: ${action} conserva respuesta iniciada y controla pendientes; reinicio cifrado`, async () => fixture(async f => {
    const original = await f.plan(), gate = deferred(), entered = deferred();
    f.setSynthesize(async () => { entered.resolve(); await gate.promise; throw new Error("fallo simulado"); });
    const runner = f.runner(); const started = runner.start(original); await entered.promise;
    await runner[action](); gate.resolve(); await started;
    assert.equal(f.calls, 1);
    assert.equal(f.snapshot.bulk_audio_queue.items.filter(item => item.status === (action === "pause" ? "pendiente" : "cancelado")).length, 3);
    await f.restart(); assert.equal(f.snapshot.bulk_audio_queue.status, "pausada");
    assert.equal(f.snapshot.workers[0].app_fields.audio_status, "incierto");
    if (action === "pause") { await f.runner().start(f.snapshot.bulk_audio_queue); assert.equal(f.calls, 4); }
    else { await f.runner().start(f.snapshot.bulk_audio_queue); assert.equal(f.calls, 1); }
    for (const file of await readdir(f.directory)) {
      const bytes = await readFile(path.join(f.directory, file));
      assert.equal(bytes.includes(Buffer.from(text)), false); assert.equal(bytes.includes(Buffer.from("Ficticia")), false);
    }
  }));
}

test("Fase03: revocación durante síntesis conserva MP3 cifrado obsoleto, no disponible", async () => fixture(async f => {
  const id = f.snapshot.workers[0].evaluation_id;
  await f.update(id, worker => recordWhatsAppDecision({ ...worker, datos_operativos: { telefono: "999111111", archivo_pdf_completo: "ficticio.pdf", archivo_pdf_completo_id: "test/ficticio.pdf" } }, "confirmado_por_operador", { identity: true, consent: true, pdf: true, saveAuthorization: true, expires_at: "2099-01-01T00:00:00Z" }));
  // Operational changes do not change clinical content; explicitly approve the resulting record.
  await f.update(id, worker => approveClinicalText(worker, text));
  // reconcile intentionally invalidates recipient evidence on identity/phone changes: confirm on the final identity.
  await f.update(id, worker => recordWhatsAppDecision(worker, "confirmado_por_operador", { identity: true, consent: true, pdf: true, saveAuthorization: true, expires_at: "2099-01-01T00:00:00Z" }));
  const queue = await f.plan(); queue.items = queue.items.filter(item => item.evaluation_id === id); await f.save(queue);
  const gate = deferred(), entered = deferred();
  f.setSynthesize(async () => { entered.resolve(); await gate.promise; const audioBlob = new Blob(["ID3late-synthetic"], { type: "audio/mpeg" }); return { audioBlob, audioUrl: URL.createObjectURL(audioBlob), mimeType: "audio/mpeg", audioFilename: "late.mp3", configuration }; });
  const started = f.runner().start(queue); await entered.promise;
  await f.update(id, worker => ({ ...worker, app_fields: { ...worker.app_fields, recipient_authorization: null } }));
  gate.resolve(); await started;
  assert.equal(f.calls, 1); assert.equal(f.snapshot.workers[0].app_fields.audio_stale, true);
  assert.equal(f.snapshot.bulk_audio_queue.items[0].status, "bloqueado");
}));

test("Fase03: recuperación nunca reenvía elementos que estaban generando", () => {
  const queue = { status: "ejecutando", items: [{ evaluation_id: "1", status: "generando" }, { evaluation_id: "2", status: "pendiente" }] };
  const restored = recoverBulkQueue(queue, []);
  assert.equal(restored.status, "pausada"); assert.equal(restored.items[0].status, "incierto"); assert.equal(restored.items[1].status, "pendiente");
});

test("Fase03: tarifa verificable por modelo y caracteres, sin inventar coste de proveedores desconocidos", () => {
  const rate = estimateCredits(100, { provider: "elevenlabs", model: "eleven_flash_v2_5" });
  assert.equal(rate.credits, 50); assert.match(rate.source, /^https:\/\/help.elevenlabs.io\//);
  assert.equal(estimateCredits(100, configuration).credits, null);
  assert.equal(estimateCredits(100, { provider: "elevenlabs", model: "desconocido" }).credits, null);
});

test("Fase03: dos solicitudes independientes de la misma evaluación comparten reserva y no sintetizan dos veces", async () => fixture(async f => {
  const queue = await f.plan(), gate = deferred(), entered = deferred();
  f.setSynthesize(async () => { entered.resolve(); await gate.promise; throw new Error("fallo de transporte simulado"); });
  const results = Promise.allSettled([f.run(queue.items[0]), f.run(queue.items[0])]);
  await entered.promise; gate.resolve();
  const settled = await results;
  assert.equal(settled.every(value => value.status === "rejected"), true);
  assert.equal(f.calls, 1);
}));

test("Fase03: un fallo de ElevenLabs simulado no detiene los otros trabajadores ni reintenta al afectado", async () => fixture(async f => {
  const queue = await f.plan();
  f.setSynthesize(async () => {
    if (f.calls === 1) throw new Error("HTTP 503 simulado");
    const audioBlob = new Blob(["ID3synthetic-success"], { type: "audio/mpeg" });
    return { audioBlob, audioUrl: URL.createObjectURL(audioBlob), mimeType: "audio/mpeg", audioFilename: "test.mp3", configuration };
  });
  await f.runner().start(queue);
  assert.equal(f.calls, 4);
  assert.equal(f.snapshot.bulk_audio_queue.items[0].status, "incierto");
  assert.equal(f.snapshot.bulk_audio_queue.items.filter(item => item.status === "completado").length, 3);
}));

test("Fase03: fallo al persistir el inicio impide cualquier solicitud pagada", async () => fixture(async f => {
  const queue = await f.plan();
  const runner = new BulkAudioRunner({ getSnapshot: () => f.snapshot, save: async () => { throw new Error("Disco no disponible"); }, run: f.run, configuration });
  await assert.rejects(runner.start(queue)); assert.equal(f.calls, 0);
}));

test("Fase03: recuperación no atribuye a la cola un MP3 de otra versión", () => {
  const queue = { items: [{ evaluation_id: "1", fingerprint: "anterior", status: "generando" }] };
  const workers = [{ evaluation_id: "1", app_fields: { audio_status: "listo", audio_stale: false, audio_record: { fingerprint: "otra" } } }];
  assert.equal(recoverBulkQueue(queue, workers).items[0].status, "incierto");
});
