import test from "node:test";
import assert from "node:assert/strict";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { approveClinicalText, reconcileWorkerReview, getAudioAuthorization } from "../src/lib/clinicalApproval.js";
import { recordWhatsAppDecision, synchronizeRecipients } from "../src/lib/whatsappReview.js";
import { getRecipientChecks, isWhatsAppConfirmed } from "../mediweb-downloader/src/authorizationPolicy.js";
import { audioFingerprint, restoreWorker } from "../src/lib/evaluationPersistence.js";
import { deliveryPreflight } from "../src/lib/deliveryUx.js";
import { deliveryFixture, configuration, text } from "../mediweb-downloader/test-support/deliveryFixture.js";
import { createServer } from "node:http";
import { createApp } from "../mediweb-downloader/src/http/app.js";

function person() {
  return approveClinicalText({ ...prepareAnalysisForReview({ workers: [{
    identificacion: { nombres: "Persona", apellidos: "Ficticia", dni: "00000001" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
    datos_operativos: { telefono: "999111111", archivo_pdf_completo: "ficticio.pdf", archivo_pdf_completo_id: "ficticio.pdf" },
  }] }, "mediweb").workers[0], evaluation_id: crypto.randomUUID(), batch_id: crypto.randomUUID() }, text);
}
const evidence = { saveAuthorization: true, identity: true, consent: true, pdf: true, authorizationScope: "evaluation", expires_at: null };

test("1/3/8: valid WhatsApp and jointly declared authorization survive restore without another check", () => {
  const original = recordWhatsAppDecision(person(), "confirmado_por_operador", evidence);
  const restored = synchronizeRecipients([restoreWorker(structuredClone(original))])[0];
  assert.equal(isWhatsAppConfirmed(restored), true);
  assert.equal(getRecipientChecks(restored).authorized, true);
  assert.deepEqual(restored.app_fields.whatsapp_verification, original.app_fields.whatsapp_verification);
  const saved = recordWhatsAppDecision(restored, "confirmado_por_operador", evidence);
  assert.deepEqual(saved.app_fields.whatsapp_verification, original.app_fields.whatsapp_verification);
  // A declaration limited to one evaluation never authorizes a different one.
  assert.equal(getRecipientChecks({ ...restored, evaluation_id: crypto.randomUUID() }).authorized, false);
});

test("2/4/6: phone changes invalidate recipient evidence, preserving clinical approval and audio fingerprint", async () => {
  const approved = person();
  assert.equal(getAudioAuthorization(approved, text).canGenerateAudio, true);
  assert.equal(getRecipientChecks(approved).authorized, false);
  const original = recordWhatsAppDecision(approved, "confirmado_por_operador", evidence);
  original.app_fields.audio_url = "blob:fictitious";
  original.app_fields.audio_stale = false;
  const fingerprint = await audioFingerprint(original, text, configuration);
  const changed = reconcileWorkerReview(original, { ...original, datos_operativos: { ...original.datos_operativos, telefono: "999222222" } });
  assert.deepEqual(changed.clinical_approval, original.clinical_approval);
  assert.equal(changed.app_fields.audio_stale, false);
  assert.equal(getRecipientChecks(changed).authorized, false);
  assert.equal(getAudioAuthorization(changed, text).canGenerateAudio, true);
  assert.equal(await audioFingerprint(changed, text, configuration), fingerprint);
});

test("authorization without an expiry requires an explicit evaluation scope; missing evidence is never invented", () => {
  const worker = person();
  assert.throws(() => recordWhatsAppDecision(worker, "confirmado_por_operador", { ...evidence, authorizationScope: undefined }));
  for (const key of ["identity", "consent", "pdf"]) {
    assert.throws(() => recordWhatsAppDecision(worker, "confirmado_por_operador", { ...evidence, [key]: false }));
  }
  const accountOnly = recordWhatsAppDecision(worker, "confirmado_por_operador");
  assert.equal(getRecipientChecks(accountOnly).authorized, false);
  const expiring = recordWhatsAppDecision(worker, "confirmado_por_operador", { ...evidence, expires_at: "2099-01-01T00:00:00Z" });
  assert.equal(getRecipientChecks(expiring, Date.parse("2100-01-01")).consent, false);
});

test("6: legacy encrypted audio retains its operation fingerprint for the same approval, never another text", async () => {
  const worker = person();
  worker.app_fields.audio_record = { fingerprint: "a".repeat(64), approval_id: worker.clinical_approval.approval_id,
    evaluation_id: worker.evaluation_id, text, configuration };
  assert.equal(await audioFingerprint(worker, text, configuration), "a".repeat(64));
  const changed = reconcileWorkerReview(worker, { ...worker, app_fields: { ...worker.app_fields, texto_final: "Otro texto" } });
  assert.notEqual(await audioFingerprint(changed, "Otro texto", configuration), "a".repeat(64));
});

test("partial or uncertain manual result is recorded without declaring any file sent", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  await f.effect(record, "conversation");
  const result = await f.service.uncertain({ id: record.id, confirmed: true, configuration });
  assert.equal(result.state, "incierta");
  assert.deepEqual(result.confirmations, {});
  await assert.rejects(f.service.complete({ id: record.id, confirmed: true, allParts: true, configuration }));
  await assert.rejects(f.prepare());
}));

test("stored approved MP3 permits delivery preflight when TTS metadata is temporarily offline", async () => deliveryFixture(async f => {
  const worker = f.batch.snapshot.workers[0];
  const result = await deliveryPreflight(worker.evaluation_id,
    (action, body) => { assert.equal(action, "detail"); return f.service.detail(body.evaluationId); },
    async () => { throw new Error("TTS offline, no provider call"); });
  assert.deepEqual(result.configuration, configuration);
}));

test("failed extraction and changed clinical content still block audio", () => {
  const worker = person();
  assert.equal(getAudioAuthorization({ ...worker, derived_states: { ...worker.derived_states, extraction_status: "error" } }, text).canGenerateAudio, false);
  const edited = reconcileWorkerReview(worker, { ...worker, app_fields: { ...worker.app_fields, texto_final: "Texto distinto" } });
  assert.equal(getAudioAuthorization(edited, "Texto distinto").canGenerateAudio, false);
});

test("7: joint manual-send declaration uses the real HTTP route, requires preparation and advances atomically", async () => deliveryFixture(async f => {
  const server = createServer(createApp({ engine: {}, jobManager: {}, version: "test", getEvaluationStore: f.getStore,
    managedFiles: f.files, allowedOrigins: new Set(["http://localhost:5173"]) }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const complete = (id, confirmed = true) => fetch(`http://127.0.0.1:${server.address().port}/deliveries`, {
    method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete", id, confirmed, allParts: true, configuration }),
  });
  try {
    const record = await f.prepare();
    assert.equal((await complete(record.id)).status, 409);
    assert.deepEqual((await f.service.list()).rows[0].delivery.confirmations, {});
    for (const part of ["conversation", "message", "pdf", "mp3"]) await f.effect(record, part);
    assert.equal((await complete(record.id, false)).status, 409);
    assert.deepEqual((await f.service.list()).rows[0].delivery.confirmations, {});
    const response = await complete(record.id);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, "completada");
    assert.equal(Object.keys(result.confirmations).length, 3);
    assert.equal(result.events.filter(event => event.evidence === "declaracion_operador_conjunta").length, 3);
    assert.equal((await complete(record.id)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
