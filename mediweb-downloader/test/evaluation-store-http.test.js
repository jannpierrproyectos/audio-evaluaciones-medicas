import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/http/app.js";
import { EvaluationStore } from "../src/evaluationStore.js";

test("API de persistencia exige Origin permitido, rechaza IDs y no expone rutas internas", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-store-http-"));
  const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
  const store = await new EvaluationStore({ directory, protection }).initialize();
  const server = createServer(createApp({ engine: {}, jobManager: {}, getEvaluationStore: async () => store, allowedOrigins: new Set(["http://localhost:5173"]) }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/state`;
  try {
    for (const origin of [null, "https://malicious.invalid"]) {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ action: "list" }) });
      assert.equal(response.status, 403);
    }
    const request = body => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify(body) });
    const imported = await (await request({ action: "import", importKey: "a".repeat(64), snapshot: { workers: [{ identificacion: { nombres: "Ficticio" }, aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CLINICAL_NOT_IN_CONTACTS" } }] } })).json();
    assert.ok(imported.id);
    assert.equal((await request({ action: "load", id: imported.id })).status, 200);
    const contacts = await (await request({ action: "contacts" })).json();
    assert.equal(contacts.contacts[0].evaluation_id, imported.snapshot.workers[0].evaluation_id);
    assert.equal(JSON.stringify(contacts).includes("CLINICAL_NOT_IN_CONTACTS"), false);
    assert.equal(JSON.stringify(contacts).includes(directory), false);
    const invalid = await request({ action: "load", id: "../../private" });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.stringify(await invalid.json()).includes(directory), false);
    const preflight = await fetch(endpoint, { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" } });
    assert.equal(preflight.status, 204);
    assert.equal((await request({ action: "list" })).headers.get("cache-control"), "no-store");
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
