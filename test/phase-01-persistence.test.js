import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { createManagedFileService } from "../mediweb-downloader/src/managedFiles.js";
import { protectKey, restrictDirectory } from "../mediweb-downloader/src/windowsProtection.js";
import { EvaluationRepository, audioFingerprint, generatePersistentAudio, recoverAudio, restoreWorker, sha256, whatsappVerification } from "../src/lib/evaluationPersistence.js";
import { approveClinicalText, getAudioAuthorization, reconcileWorkerReview, recipientVersion } from "../src/lib/clinicalApproval.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";

const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
const text = "Buenos días. Texto ficticio para pruebas de persistencia.";
const configuration = { provider: "simulado", model: "modelo-prueba", voice_ref: "voz-prueba", settings: { speed: 0.9 }, language: "es", format: "mp3", contract: 1 };
const syntheticMp3 = Buffer.from("ID3synthetic-fixture-not-clinical");
const snapshot = () => ({ ...prepareAnalysisForReview({ file_name: "ficticio.pdf", workers: [{
  identificacion: { nombres: "Persona", apellidos: "Ficticia", dni: "00000000", fecha_evaluacion: "17/10/2026" },
  aptitud_y_recomendaciones: { aptitud_final: "APTO" }, raw_text: "RAW_DEBUG_NOT_RETAINED",
}] }, "pdf"), greeting: "Buenos días" });

async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-state-test-"));
  const store = await new EvaluationStore({ directory, protection }).initialize();
  const request = async (body, binary) => {
    switch (body.action) {
      case "list": return store.list();
      case "import": return store.import(body.snapshot, body.importKey);
      case "load": return store.load(body.id);
      case "save": return store.save(body.id, body.snapshot, body.revision);
      case "reserve": return store.reserve(body.batchId, body.evaluationId, body.fingerprint);
      case "operation": return store.operation(body.evaluationId, body.fingerprint);
      case "cancel-unsent": return store.cancelUnsent(body.operationId);
      case "complete": return store.complete(body.operationId, Buffer.from(body.audio, "base64"), body.metadata);
      case "audio": {
        const result = await store.audio(body.batchId, body.evaluationId, body.operationId);
        assert.equal(binary, true);
        return new Blob([result.bytes], { type: "audio/mpeg" });
      }
      default: assert.fail("Accion inesperada");
    }
  };
  try { await callback({ store, directory, repository: new EvaluationRepository(request), request }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("persistencia cifrada: reinicio, minimización, copia y aprobación exacta", async () => fixture(async ({ store, directory }) => {
  const batch = await store.import(snapshot(), await sha256("pdf-ficticio"));
  const worker = approveClinicalText(batch.snapshot.workers[0], text);
  batch.snapshot.workers[0] = worker;
  await store.save(batch.id, batch.snapshot, batch.revision);
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  const restored = await restarted.load(batch.id);
  assert.equal(restored.snapshot.workers[0].raw_text, undefined);
  assert.equal(getAudioAuthorization(restoreWorker(restored.snapshot.workers[0]), text).canGenerateAudio, true);
  for (const name of await readdir(directory)) {
    const bytes = await readFile(path.join(directory, name));
    assert.equal(bytes.includes(Buffer.from("Ficticia")), false);
    assert.equal(bytes.includes(Buffer.from(text)), false);
    assert.equal(bytes.includes(Buffer.from("RAW_DEBUG_NOT_RETAINED")), false);
  }
  await writeFile(path.join(directory, "catalogue.enc"), "corrupt");
  assert.equal((await restarted.load(batch.id)).recovered, true);
  await writeFile(path.join(directory, "catalogue.enc.bak"), "corrupt");
  await assert.rejects(restarted.load(batch.id), error => error.code === "STORE_CORRUPT");
}));

test("lotes duplicados se recuperan; evaluaciones distintas e IDs ajenos no se mezclan", async () => fixture(async ({ store }) => {
  const first = await store.import(snapshot(), await sha256("same-pdf"));
  const again = await store.import(snapshot(), await sha256("same-pdf"));
  assert.equal(first.id, again.id);
  const nextSnapshot = snapshot(); nextSnapshot.workers[0].identificacion.fecha_evaluacion = "18/10/2026";
  const next = await store.import(nextSnapshot, await sha256("another-evaluation"));
  assert.notEqual(first.snapshot.workers[0].evaluation_id, next.snapshot.workers[0].evaluation_id);
  await assert.rejects(store.save(first.id, { ...first.snapshot, workers: next.snapshot.workers }, first.revision), error => error.code === "STORE_IDENTITY_CONFLICT");
  assert.throws(() => store.load("../../etc/passwd"), error => error.code === "STORE_INVALID_ID");
}));

test("revisiones concurrentes no sobrescriben cambios y las reservas son idempotentes", async () => fixture(async ({ store, directory }) => {
  const batch = await store.import(snapshot(), await sha256("revision"));
  await store.save(batch.id, batch.snapshot, batch.revision);
  await assert.rejects(store.save(batch.id, batch.snapshot, batch.revision), error => error.code === "STORE_REVISION_CONFLICT");
  const worker = batch.snapshot.workers[0];
  const fingerprint = await sha256("operation");
  const reservations = await Promise.all([store.reserve(batch.id, worker.evaluation_id, fingerprint), store.reserve(batch.id, worker.evaluation_id, fingerprint)]);
  assert.equal(reservations[0].id, reservations[1].id);
  assert.equal(reservations[1].reused, true);
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  assert.equal((await restarted.reserve(batch.id, worker.evaluation_id, fingerprint)).status, "solicitado");
  await assert.rejects(restarted.reserve(batch.id, worker.evaluation_id, await sha256("different")), error => error.code === "STORE_AUDIO_UNCERTAIN");
}));

test("MP3 cifrado se recupera tras reinicio y reutiliza sin segunda solicitud TTS", async () => fixture(async ({ repository, store, directory }) => {
  const batch = await repository.import(snapshot(), await sha256("audio"));
  let current = approveClinicalText(batch.snapshot.workers[0], text);
  batch.snapshot.workers[0] = current;
  await repository.save(batch.snapshot);
  const update = async change => {
    current = reconcileWorkerReview(current, change(current));
    batch.snapshot.workers[0] = current;
    await repository.save(batch.snapshot);
  };
  let calls = 0;
  const synthesize = async () => {
    calls++;
    const audioBlob = new Blob([syntheticMp3], { type: "audio/mpeg" });
    return { mimeType: "audio/mpeg", audioBlob, audioUrl: URL.createObjectURL(audioBlob), audioFilename: "test.mp3", ttsText: text, configuration };
  };
  const options = { repository, worker: current, text, configuration, synthesize, update, current: () => current };
  await generatePersistentAudio(options);
  assert.equal(calls, 1);
  assert.equal(current.app_fields.audio_stale, false);
  await generatePersistentAudio({ ...options, worker: current });
  assert.equal(calls, 1);
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  const saved = await restarted.load(batch.id);
  assert.equal(saved.snapshot.workers[0].app_fields.audio_url, undefined);
  const recovered = await recoverAudio(restoreWorker(saved.snapshot.workers[0]), "Buenos días", repository, configuration);
  assert.equal(recovered.app_fields.audio_status, "listo");
  assert.equal(recovered.app_fields.audio_stale, false);
  const bytes = Buffer.from(await (await fetch(recovered.app_fields.audio_url)).arrayBuffer());
  assert.deepEqual(bytes, syntheticMp3);
  const op = await store.reserve(batch.id, current.evaluation_id, current.app_fields.audio_record.fingerprint);
  await assert.rejects(store.audio(batch.id, globalThis.crypto.randomUUID(), op.id));
  const changedVoice = await recoverAudio(current, "Buenos días", repository, { ...configuration, voice_ref: "another-voice" });
  assert.equal(changedVoice.app_fields.audio_stale, true);
  assert.notEqual(await audioFingerprint(current, text, configuration), await audioFingerprint(current, text, { ...configuration, settings: { speed: 1 } }));
}));

test("recuperación invalida identidad, texto y saludo discrepantes y autorización vencida", async () => fixture(async ({ store }) => {
  const batch = await store.import(snapshot(), await sha256("validation"));
  const original = approveClinicalText(batch.snapshot.workers[0], text);
  assert.equal(restoreWorker(original).clinical_approval.status, "aprobada");
  for (const modified of [{ ...original, identificacion: { ...original.identificacion, dni: "11111111" } }, { ...original, evaluation_id: globalThis.crypto.randomUUID() }, { ...original, app_fields: { ...original.app_fields, texto_final: "cambio" } }]) {
    assert.equal(restoreWorker(modified).clinical_approval.status, "invalidada");
  }
  assert.equal(restoreWorker(original, "Buenas noches").clinical_approval.status, "invalidada");
  const recipient = { ...original, source_mode: "mediweb", datos_operativos: { telefono: "999888777", archivo_pdf_completo: "test.pdf", archivo_pdf_completo_id: "test/test.pdf" } };
  recipient.app_fields = { ...recipient.app_fields, whatsapp_confirmed_phone: "51999888777", whatsapp_verification: whatsappVerification(recipient, true), recipient_authorization: { status: "confirmada", version: recipientVersion(recipient), expires_at: "2000-01-01T00:00:00Z" } };
  const restored = restoreWorker(recipient);
  assert.equal(restored.app_fields.recipient_authorization.status, "vencida");
  assert.equal(getAudioAuthorization(restored, text).canGenerateAudio, false);
  assert.equal(whatsappVerification(recipient, false).status, "no_disponible");
}));

test("DPAPI CurrentUser y ACL reales protegen la clave en Windows", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-dpapi-test-"));
  try {
    await restrictDirectory(directory);
    await restrictDirectory(directory);
    const key = Buffer.alloc(32, 19);
    const encrypted = await protectKey(key);
    assert.notDeepEqual(encrypted, key);
    assert.deepEqual(await protectKey(encrypted, true), key);
    await new EvaluationStore({ directory }).initialize();
    await new EvaluationStore({ directory }).initialize();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("referencia de atención deduplica entre PDFs; distinta atención conserva identidad estable", async () => fixture(async ({ store }) => {
  const input = snapshot(); input.workers[0].identificacion.n_ficha = "FICTICIA-1";
  const first = await store.import(input, await sha256("encounter-pdf-one"));
  const duplicate = await store.import(input, await sha256("encounter-pdf-two"));
  assert.equal(first.id, duplicate.id);
  const other = structuredClone(input); other.workers[0].identificacion.n_ficha = "FICTICIA-2";
  const second = await store.import(other, await sha256("another-encounter"));
  assert.notEqual(first.snapshot.workers[0].evaluation_id, second.snapshot.workers[0].evaluation_id);
  assert.equal(first.snapshot.workers[0].worker_id, second.snapshot.workers[0].worker_id);
  const discrepancy = structuredClone(input); discrepancy.workers[0].aptitud_y_recomendaciones.aptitud_final = "PENDIENTE";
  await assert.rejects(store.import(discrepancy, await sha256("different-content")), error => error.code === "STORE_EVALUATION_CONFLICT");
}));

test("exportación denegada no escribe MP3 en claro", async () => fixture(async ({ directory }) => {
  const service = createManagedFileService({ downloadsDir: directory, beforeSaveAudioDirectory: async () => { throw new Error("EFS unavailable"); } });
  await assert.rejects(service.saveMp3(syntheticMp3, "test.mp3"), error => error.code === "AUDIO_EXPORT_PROTECTION_UNAVAILABLE");
  assert.deepEqual(await readdir(path.join(directory, "audio-whatsapp")), []);
}));

for (const scenario of ["texto", "revocacion", "destinatario", "otro lote"]) {
  test(`TTS persistente: respuesta tardía tras ${scenario} no se aplica como audio vigente`, async () => fixture(async ({ repository, store }) => {
    const batch = await repository.import(snapshot(), await sha256(`race-${scenario}`));
    let current = approveClinicalText(batch.snapshot.workers[0], text);
    let active = true;
    batch.snapshot.workers[0] = current;
    await repository.save(batch.snapshot);
    const update = async change => {
      if (!active) return;
      current = reconcileWorkerReview(current, change(current));
      batch.snapshot.workers[0] = current;
      await repository.save(batch.snapshot);
    };
    let finish;
    const pending = generatePersistentAudio({ repository, worker: current, text, configuration,
      current: () => active ? current : null, update,
      synthesize: async () => new Promise(resolve => { finish = () => {
        const audioBlob = new Blob([syntheticMp3], { type: "audio/mpeg" });
        resolve({ audioBlob, audioUrl: URL.createObjectURL(audioBlob), audioFilename: "test.mp3", mimeType: "audio/mpeg", ttsText: text, configuration });
      }; }),
    });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    if (scenario === "texto") await update(value => ({ ...value, app_fields: { ...value.app_fields, texto_final: "Cambio" } }));
    if (scenario === "revocacion") await update(value => ({ ...value, app_fields: { ...value.app_fields, recipient_authorization: { status: "revocada" } } }));
    if (scenario === "destinatario") await update(value => ({ ...value, datos_operativos: { telefono: "988777666" } }));
    if (scenario === "otro lote") active = false;
    finish();
    const result = await pending;
    assert.equal(result.stale, true);
    const persisted = await store.load(batch.id);
    const operation = await store.operation(current.evaluation_id, current.app_fields.audio_request.fingerprint);
    assert.equal(operation.status, "listo");
    if (active) assert.equal(persisted.snapshot.workers[0].app_fields.audio_stale, true);
  }));
}

test("recuperar una intención aún no enviada no crea reservas ni consume TTS", async () => fixture(async ({ repository, store }) => {
  const batch = await repository.import(snapshot(), await sha256("not-sent"));
  const worker = approveClinicalText(batch.snapshot.workers[0], text);
  const fingerprint = await audioFingerprint(worker, text, configuration);
  worker.app_fields.audio_request = { evaluation_id: worker.evaluation_id, fingerprint };
  const recovered = await recoverAudio(worker, "Buenos días", repository, configuration);
  assert.equal(recovered.app_fields.audio_status, "pendiente");
  assert.equal((await store.operation(worker.evaluation_id, fingerprint)).status, "no_solicitado");
}));

test("recupera MP3 atómico si el proceso cae antes de actualizar el catálogo", async () => fixture(async ({ store, directory }) => {
  const batch = await store.import(snapshot(), await sha256("binary-before-journal"));
  const evaluationId = batch.snapshot.workers[0].evaluation_id;
  const fingerprint = await sha256("crash-fingerprint");
  const operation = await store.reserve(batch.id, evaluationId, fingerprint);
  await store.complete(operation.id, syntheticMp3, { evaluation_id: evaluationId, fingerprint, configuration });
  const catalogue = JSON.parse(store.unseal(await readFile(path.join(directory, "catalogue.enc")), "catalogue").toString());
  const saved = catalogue.operations[`${evaluationId}:${fingerprint}`];
  saved.status = "solicitado"; delete saved.metadata; delete saved.sha256;
  await writeFile(path.join(directory, "catalogue.enc"), store.seal(Buffer.from(JSON.stringify(catalogue)), "catalogue"));
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  assert.equal((await restarted.operation(evaluationId, fingerprint)).status, "listo");
  assert.deepEqual((await restarted.audio(batch.id, evaluationId, operation.id)).bytes, syntheticMp3);
}));
