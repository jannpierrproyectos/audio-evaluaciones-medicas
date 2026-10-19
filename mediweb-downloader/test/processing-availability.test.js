import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../src/evaluationStore.js";
import { ProcessingFlow } from "../src/processingFlow.js";

test("completed downloads do not imply an available batch; read-only status verifies eight saved evaluations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-availability-"));
  try {
    const store = await new EvaluationStore({ directory, protection: { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() } }).initialize();
    const batch = await store.import({ workers: Array.from({ length: 8 }, (_, index) => ({ identificacion: { dni: `0000000${index}` } })) }, "c".repeat(64));
    await store.processingState(state => {
      state.runs.push({ id: "download-only", status: "completed", checkpoint: null });
      state.runs.push({ id: "stored", status: "completed", batch_id: batch.id, checkpoint: null });
      state.runs.push({ id: "missing", status: "completed", batch_id: crypto.randomUUID(), checkpoint: null });
    });
    const before = await readFile(path.join(directory, "catalogue.enc"));
    const flow = new ProcessingFlow({ engine: {}, jobManager: { jobs: new Map(), hasActiveJob: false }, getStore: async () => store });
    const result = await flow.status();
    assert.equal(result.runs[0].availability.status, "awaiting_import");
    assert.deepEqual(result.runs[1].availability, { status: "stored", evaluation_count: 8 });
    assert.equal(result.runs[2].availability.status, "error");
    assert.equal(result.runs[2].availability.diagnostic_code, "STORE_NOT_FOUND");
    assert.deepEqual(await readFile(path.join(directory, "catalogue.enc")), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
