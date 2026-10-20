import test from "node:test";
import assert from "node:assert/strict";
import { canConfirmDeliveryRecipient, confirmDeliveryRecipient, deliveryState, deliveryTaskLabel, matchesDeliveryFilter, nextPendingDelivery } from "../src/lib/deliveryUx.js";
import { EvaluationRepository } from "../src/lib/evaluationPersistence.js";
import { deliveryFixture } from "../mediweb-downloader/test-support/deliveryFixture.js";

async function pendingRecipient(f) {
  await f.update(0, worker => ({ ...worker, app_fields: { ...worker.app_fields, recipient_authorization: null } }));
  return (await f.service.list()).rows.find(row => row.evaluation_id === f.batch.snapshot.workers[0].evaluation_id);
}
function repository(f) {
  return new EvaluationRepository(async ({ action, id, snapshot, revision }) => {
    if (action === "load") return f.store.load(id);
    if (action === "save") return f.store.save(id, snapshot, revision);
    throw new Error("Unexpected operation");
  });
}
const request = f => async (action, body) => { assert.equal(action, "detail"); return f.service.detail(body.evaluationId); };

test("delivery declaration persists once without expiry, reuses WhatsApp and approved MP3", async () => deliveryFixture(async f => {
  const row = await pendingRecipient(f);
  const before = (await f.store.load(row.batch_id)).snapshot.workers[0];
  assert.equal(canConfirmDeliveryRecipient(row), true);
  assert.equal(deliveryState(row), "pendientes");
  assert.equal(deliveryTaskLabel(row), "Confirmar destinatario");
  assert.equal(matchesDeliveryFilter(row, "preparables"), true);
  assert.equal(matchesDeliveryFilter({ ...row, checks: { ...row.checks, whatsapp: false } }, "preparables"), false);
  assert.equal(matchesDeliveryFilter({ ...row, delivery: { state: "incierta" } }, "preparables"), false);
  let validations = 0;
  await confirmDeliveryRecipient(row, repository(f), request(f), async id => { assert.equal(id, before.datos_operativos.archivo_pdf_completo_id); validations++; });
  const after = (await f.store.load(row.batch_id)).snapshot.workers[0];
  assert.deepEqual(after.clinical_approval, before.clinical_approval);
  assert.deepEqual(after.app_fields.audio_record, before.app_fields.audio_record);
  assert.deepEqual(after.app_fields.whatsapp_verification, before.app_fields.whatsapp_verification);
  assert.equal(after.app_fields.recipient_authorization.scope, "evaluation");
  assert.equal(after.app_fields.recipient_authorization.expires_at, null);
  assert.equal(validations, 1);
  const updated = (await f.service.list()).rows.find(value => value.evaluation_id === row.evaluation_id);
  assert.equal(updated.checks.authorized, true);
  assert.equal(canConfirmDeliveryRecipient(updated), false);
  assert.deepEqual(updated.reasons, []);
  assert.equal(nextPendingDelivery([{ evaluation_id: "done", reasons: [], delivery: { state: "completada" } }, row], "done"), row.evaluation_id);
}));

test("recipient flow refuses stale binding and missing protected PDF without saving consent", async () => deliveryFixture(async f => {
  const row = await pendingRecipient(f);
  await assert.rejects(confirmDeliveryRecipient({ ...row, binding: "obsolete" }, repository(f), request(f), async () => {}), /cambio/);
  await assert.rejects(confirmDeliveryRecipient(row, repository(f), request(f), async () => { throw new Error("PDF unavailable"); }), /PDF unavailable/);
  assert.equal((await f.store.load(row.batch_id)).snapshot.workers[0].app_fields.recipient_authorization, null);
  for (const blocked of [{ checks: { ...row.checks, whatsapp: false } }, { audio: false }, { approval: false }]) {
    assert.equal(canConfirmDeliveryRecipient({ ...row, ...blocked }), false);
  }
}));

test("recipient change during file validation never records the old declaration", async () => deliveryFixture(async f => {
  const row = await pendingRecipient(f);
  await assert.rejects(confirmDeliveryRecipient(row, repository(f), request(f), async () => {
    await f.update(0, worker => ({ ...worker, datos_operativos: { ...worker.datos_operativos, telefono: "999888777" } }));
  }), /cambio/);
  const worker = (await f.store.load(row.batch_id)).snapshot.workers[0];
  assert.equal(worker.datos_operativos.telefono, "999888777");
  assert.equal(worker.app_fields.recipient_authorization, null);
  assert.equal(worker.clinical_approval.status, "aprobada");
}));

test("shared phone requires the explicit contextual identity declaration for that evaluation", async () => deliveryFixture(async f => {
  await f.update(1, worker => ({ ...worker, datos_operativos: { ...worker.datos_operativos, telefono: "999111111" } }));
  const row = await pendingRecipient(f);
  assert.equal(row.checks.whatsapp, true);
  assert.equal(row.checks.duplicateResolved, false);
  assert.equal(canConfirmDeliveryRecipient(row), true);
  await confirmDeliveryRecipient(row, repository(f), request(f), async () => {});
  const updated = (await f.service.list()).rows.find(value => value.evaluation_id === row.evaluation_id);
  assert.equal(updated.checks.duplicateResolved, true);
  assert.equal(updated.checks.authorized, true);
  const other = (await f.store.load(row.batch_id)).snapshot.workers[1];
  assert.notEqual(other.app_fields.recipient_authorization?.duplicate_signature, (await f.store.load(row.batch_id)).snapshot.workers[0].app_fields.recipient_authorization.duplicate_signature);
}));

test("a real PDF link or audio mismatch cannot be resolved by declaring consent", async () => deliveryFixture(async f => {
  const row = await pendingRecipient(f);
  for (const reason of ["El MP3 no corresponde a esta version.", "No se pudo vincular documento y pagina del PDF."]) {
    assert.equal(canConfirmDeliveryRecipient({ ...row, reasons: [...row.reasons, reason] }), false);
  }
}));
