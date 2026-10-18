import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EvaluationStore } from "../src/evaluationStore.js";

const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-bulk-store-"));
  try {
    const store = await new EvaluationStore({ directory, protection }).initialize();
    const batch = await store.import({ workers: [{ identificacion: { nombres: "FICTICIO_BULK_PRIVATE" } }] }, "b".repeat(64));
    await callback({ directory, store, batch });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("cola masiva e historial sobreviven reinicio cifrados y conflictos de revisión no los sobrescriben", async () => fixture(async ({ directory, store, batch }) => {
  const queue = { id: "cola-ficticia", status: "pausada", concurrency: 2, items: [{ evaluation_id: batch.snapshot.workers[0].evaluation_id, status: "pendiente", fingerprint: "a".repeat(64) }] };
  const snapshot = { ...batch.snapshot, bulk_audio_queue: queue, bulk_audio_history: [{ ...queue, id: "anterior", status: "cancelada" }] };
  await store.save(batch.id, snapshot, batch.revision);
  await assert.rejects(store.save(batch.id, batch.snapshot, batch.revision), error => error.code === "STORE_REVISION_CONFLICT");
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  const recovered = await restarted.load(batch.id);
  assert.deepEqual(recovered.snapshot.bulk_audio_queue, queue);
  assert.equal(recovered.snapshot.bulk_audio_history[0].status, "cancelada");
  for (const name of await readdir(directory)) {
    const bytes = await readFile(path.join(directory, name));
    for (const sensitive of ["FICTICIO_BULK_PRIVATE", "cola-ficticia", batch.id]) assert.equal(bytes.includes(Buffer.from(sensitive)), false);
  }
}));

test("fallo de escritura MP3 mantiene reserva incierta; recuperación concilia binario sin nueva solicitud", async () => fixture(async ({ directory, store, batch }) => {
  const evaluationId = batch.snapshot.workers[0].evaluation_id, fingerprint = "c".repeat(64);
  const op = await store.reserve(batch.id, evaluationId, fingerprint);
  const atomic = store.atomic.bind(store);
  // Crash after committing the immutable encrypted binary, before catalogue commit.
  store.atomic = async (file, bytes) => {
    if (file.endsWith("catalogue.enc.bak")) throw new Error("simulated disk failure");
    return atomic(file, bytes);
  };
  await assert.rejects(store.complete(op.id, Buffer.from("ID3synthetic-bulk-store"), { evaluation_id: evaluationId, fingerprint, configuration: { model: "simulado" } }));
  const restarted = await new EvaluationStore({ directory, protection }).initialize();
  const reconciled = await restarted.operation(evaluationId, fingerprint);
  assert.equal(reconciled.id, op.id); assert.equal(reconciled.status, "listo");
  assert.equal((await restarted.reserve(batch.id, evaluationId, fingerprint)).reused, true);
  const audio = await restarted.audio(batch.id, evaluationId, op.id);
  assert.equal(audio.bytes.toString(), "ID3synthetic-bulk-store");
  await assert.rejects(restarted.audio(batch.id, crypto.randomUUID(), op.id));
}));
