import test from "node:test";
import assert from "node:assert/strict";
import { deliveryState, nextDelivery, nextPendingDelivery, deliveryPreflight } from "../src/lib/deliveryUx.js";
import { deliveryFixture, configuration } from "../mediweb-downloader/test-support/deliveryFixture.js";

test("Fase05: navegación consecutiva, filtros y avance omiten completados e inciertos", () => {
  const rows = [
    { evaluation_id: "1", reasons: [], delivery: { state: "completada" } },
    { evaluation_id: "2", reasons: [], delivery: { state: "incierta" } },
    { evaluation_id: "3", reasons: [], delivery: { state: "listo" } },
    { evaluation_id: "4", reasons: ["Sin autorización"], delivery: null },
    { evaluation_id: "5", reasons: [], delivery: null },
  ];
  assert.deepEqual(rows.map(deliveryState), ["enviados", "incidencias", "listos", "incidencias", "pendientes"]);
  assert.equal(nextDelivery(rows, "3", "todos"), "4"); assert.equal(nextDelivery(rows, "3", "todos", -1), "2");
  assert.equal(nextPendingDelivery(rows, "1"), "3"); assert.equal(nextPendingDelivery(rows, "3"), "5");
  assert.equal(nextDelivery([], "1"), null);
});

test("Fase05: preflight reutiliza autorización clínica central y nunca llama TTS", async () => deliveryFixture(async f => {
  const id = f.batch.snapshot.workers[0].evaluation_id;
  const request = async (action, body) => { assert.equal(action, "detail"); return f.service.detail(body.evaluationId); };
  const proof = await deliveryPreflight(id, request, async () => configuration);
  assert.ok(proof.expectedBinding); assert.equal(proof.configuration, configuration);
  await f.update(0, worker => ({ ...worker, clinical_approval: { status: "invalidada" } }));
  let configurationCalls = 0;
  await assert.rejects(deliveryPreflight(id, request, async () => { configurationCalls++; return configuration; }));
  assert.equal(configurationCalls, 0);
}));
