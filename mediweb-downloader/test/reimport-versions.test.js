import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../src/evaluationStore.js";

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-reimport-versions-"));
  const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
  try { await run(await new EvaluationStore({ directory, protection }).initialize(), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const worker = index => ({ source_mode: "mediweb",
  identificacion: { dni: String(index).padStart(8, "0"), n_ficha: `F-${index}`, fecha_evaluacion: "20/10/2026" },
  laboratorio_numerico: { glucosa: 90 }, datos_operativos: { telefono: "999111111" },
  clinical_approval: { status: "pendiente" }, app_fields: { texto_final: "Texto ficticio para revisión." },
});

test("71 reports with 9 revised encounters open together without changing prior approvals or audio", async () => fixture(async (store, directory) => {
  const old = await store.import({ workers: Array.from({ length: 9 }, (_, index) => worker(index + 1)) }, "1".repeat(64));
  for (const item of old.snapshot.workers) {
    item.clinical_approval = { status: "aprobada", evaluation_id: item.evaluation_id, text: "Texto anterior aprobado" };
    item.app_fields = { ...item.app_fields, audio_record: { fingerprint: "old-approved-audio" }, audio_status: "listo", recipient_authorization: { status: "confirmada" } };
  }
  await store.save(old.id, old.snapshot, old.revision);
  const previous = await store.load(old.id);
  const key = await readFile(path.join(directory, "key.dpapi"));
  const reports = Array.from({ length: 71 }, (_, index) => worker(index + 1));
  for (let index = 0; index < 9; index++) {
    reports[index].laboratorio_numerico.glucosa = 91;
    // Even an incoming stale UI snapshot cannot approve a new clinical version.
    reports[index].clinical_approval = old.snapshot.workers[index].clinical_approval;
    reports[index].app_fields = { ...old.snapshot.workers[index].app_fields, audio_url: "blob:old", whatsapp_confirmed_phone: "51999111111" };
  }
  const imported = await store.import({ workers: reports }, "2".repeat(64));
  assert.equal(imported.snapshot.workers.length, 71);
  assert.deepEqual(await store.load(old.id), previous);
  assert.deepEqual(await readFile(path.join(directory, "key.dpapi")), key);
  for (let index = 0; index < 9; index++) {
    const next = imported.snapshot.workers[index], prior = previous.snapshot.workers[index];
    assert.notEqual(next.evaluation_id, prior.evaluation_id);
    assert.equal(next.worker_id, prior.worker_id);
    assert.equal(next.laboratorio_numerico.glucosa, 91);
    assert.deepEqual(next.clinical_approval, { status: "pendiente" });
    assert.equal(next.derived_states.reviewed_by_user, false);
    assert.equal(next.app_fields.audio_record, undefined);
    assert.equal(next.app_fields.recipient_authorization, null);
  }
  // Search all clinical versions; an older differing version cannot block reuse.
  const repeated = await store.import({ workers: reports }, "3".repeat(64));
  assert.equal(repeated.id, imported.id);
  assert.equal(repeated.snapshot.workers.length, 71);
  assert.equal((await store.list()).batches.length, 2);
  const restarted = await new EvaluationStore({ directory, protection: store.protection }).initialize();
  assert.equal((await restarted.load(imported.id)).snapshot.workers.length, 71);
  assert.deepEqual(await restarted.load(old.id), previous);
}));

test("different versions within one input remain an explicit discrepancy with no partial write", async () => fixture(async (store, directory) => {
  await store.import({ workers: [worker(1)] }, "1".repeat(64));
  const before = await readFile(path.join(directory, "catalogue.enc"));
  const changed = worker(2); changed.laboratorio_numerico.glucosa = 92;
  await assert.rejects(store.import({ workers: [worker(2), changed] }, "2".repeat(64)), { code: "STORE_EVALUATION_CONFLICT" });
  assert.deepEqual(await readFile(path.join(directory, "catalogue.enc")), before);
}));
