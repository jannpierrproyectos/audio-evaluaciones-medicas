import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/http/app.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationStore } from "../src/evaluationStore.js";

test("Fase04 HTTP: exige Origin, acciones explícitas y no acepta rutas ni credenciales", async () => {
  let starts = 0;
  const server = createServer(createApp({ engine: {}, jobManager: {}, version: "prueba", allowedOrigins: new Set(["http://localhost:5173"]),
    processingService: { status: async () => ({ authentication: "unknown", profiles: [], runs: [] }), start: async () => { starts++; return { id: "ficticio" }; } } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/processing`;
  const request = (body, origin = "http://localhost:5173") => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await request({ action: "start" }, null)).status, 403);
    assert.equal((await request({ action: "start" }, "https://externo.invalid")).status, 403);
    assert.equal((await request({ action: "start", password: "NEVER_STORE" })).status, 400);
    assert.equal((await request({ action: "start", paths: { root: "C:/private" } })).status, 400);
    assert.equal((await request({ action: "__proto__" })).status, 400);
    assert.equal((await request({ action: "profile", confirmed: false })).status, 400);
    assert.equal(starts, 0);
    const result = await request({ action: "status" }); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { authentication: "unknown", profiles: [], runs: [] });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Fase04: importar duplicados repartidos conserva referencias a todos sus lotes y revoca evidencia si cambia teléfono", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-related-batches-"));
  const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
  try {
    const store = await new EvaluationStore({ directory, protection }).initialize();
    const person = id => ({ identificacion: { dni: `0000000${id}`, n_ficha: `F${id}`, fecha_evaluacion: "17/10/2026" }, datos_operativos: { telefono: "999111111" } });
    const first = await store.import({ workers: [person(1)] }, "1".repeat(64));
    const second = await store.import({ workers: [person(2)] }, "2".repeat(64));
    first.snapshot.workers[0].clinical_approval = { status: "aprobada", text: "Texto ficticio" };
    first.snapshot.workers[0].app_fields = { recipient_authorization: { status: "confirmada" }, whatsapp_confirmed_phone: "51999111111" };
    await store.save(first.id, first.snapshot, first.revision);
    const changed = person(1); changed.datos_operativos.telefono = "999222222";
    const recovered = await store.import({ workers: [changed, person(2)] }, "3".repeat(64));
    assert.deepEqual(new Set(recovered.recovered_batch_ids), new Set([first.id, second.id]));
    assert.equal((await store.list()).batches.length, 2);
    const worker = (await store.load(first.id)).snapshot.workers[0];
    assert.equal(worker.datos_operativos.telefono, "999222222");
    assert.equal(worker.app_fields.recipient_authorization, null); assert.equal(worker.app_fields.whatsapp_confirmed_phone, "");
    assert.notEqual(worker.app_fields.audio_stale, true); assert.equal(worker.clinical_approval.status, "aprobada");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
