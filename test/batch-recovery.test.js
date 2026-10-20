import test from "node:test";
import assert from "node:assert/strict";
import { loadReviewableBatch, recoveryDiagnostic, recoveryDescription } from "../src/lib/batchRecovery.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";

const id = crypto.randomUUID();
function fixture() {
  const snapshot = prepareAnalysisForReview({ workers: Array.from({ length: 8 }, (_, index) => ({
    identificacion: { dni: `0000000${index}`, nombres: "Persona ficticia" }, aptitud_y_recomendaciones: { aptitud_final: "APTO" },
  })) }, "mediweb");
  return { id, snapshot: { ...snapshot, batch_id: id, workers: snapshot.workers.map(worker => ({ ...worker, batch_id: id, evaluation_id: crypto.randomUUID() })) } };
}
test("eight saved evaluations open without saving the catalogue or calling TTS", async () => {
  const batch = fixture();
  const before = JSON.stringify(batch);
  const repository = { load: async () => batch, contacts: async () => ({ contacts: [] }), save: () => assert.fail("Recovery must not write") };
  const result = await loadReviewableBatch(repository, id);
  assert.equal(result.snapshot.workers.length, 8);
  assert.deepEqual(result.warnings, []);
  assert.equal(JSON.stringify(batch), before);
});
test("contact service failure does not discard eight readable evaluations", async () => {
  const result = await loadReviewableBatch({ load: async () => fixture(), contacts: async () => { throw Object.assign(new Error("PRIVATE"), { code: "STORE_BUSY" }); } }, id);
  assert.equal(result.snapshot.workers.length, 8);
  assert.equal(result.warnings[0].code, "BATCH_CONTACTS_STORE_BUSY");
});
test("original safe storage error survives the opening boundary", async () => {
  await assert.rejects(loadReviewableBatch({ load: async () => { throw Object.assign(new Error("PRIVATE CLINICAL CONTENT"), { code: "STORE_CORRUPT" }); } }, id), error => {
    assert.equal(error.diagnostic.code, "BATCH_LOAD_STORE_CORRUPT");
    assert.doesNotMatch(error.message, /PRIVATE/); return true;
  });
});
test("empty and mismatched batches never advertise successful recovery", async () => {
  for (const batch of [{ ...fixture(), snapshot: { batch_id: id, workers: [] } }, { ...fixture(), id: crypto.randomUUID() }]) {
    await assert.rejects(loadReviewableBatch({ load: async () => batch }, id), error => ["BATCH_LOAD_BATCH_EMPTY", "BATCH_LOAD_BATCH_INVALID"].includes(error.diagnostic.code));
  }
});
test("diagnostics discard arbitrary exception messages and unknown codes", () => {
  assert.deepEqual(recoveryDiagnostic({ message: "patient medical data", code: "PATIENT_PRIVATE" }), { stage: "BATCH_LOAD", code: "BATCH_LOAD_FAILED" });
});

test("import errors retain the safe discrepancy code and explain it without clinical details", () => {
  const diagnostic = recoveryDiagnostic({ code: "STORE_EVALUATION_CONFLICT", message: "PRIVATE CLINICAL DATA" }, "PDF_IMPORT");
  assert.equal(diagnostic.code, "PDF_IMPORT_STORE_EVALUATION_CONFLICT");
  assert.match(recoveryDescription(diagnostic), /versiones diferentes/);
  assert.doesNotMatch(JSON.stringify(diagnostic) + recoveryDescription(diagnostic), /PRIVATE/);
});
