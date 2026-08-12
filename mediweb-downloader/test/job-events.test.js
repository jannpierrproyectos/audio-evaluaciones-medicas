import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { JobManager } from "../src/http/jobManager.js";

test("JobManager emite eventos internos started/completed sin exponer endpoint nuevo", async () => {
  const events = new EventEmitter();
  const observed = [];
  events.on("job:started", () => observed.push("started"));
  events.on("job:completed", () => observed.push("completed"));
  const engine = {
    resetCancellation() {},
    async run() { return { status: "completed", manifest: { pagination: { motivoFinalizacion: "ultima_pagina" } }, paths: {} }; },
  };
  const manager = new JobManager({ engine, events });
  const completed = once(events, "job:completed");
  manager.create({ mode: "first" });
  await completed;
  assert.deepEqual(observed, ["started", "completed"]);
  assert.equal(manager.hasActiveJob, false);
});

test("JobManager emite failed y conserva mensaje genérico en logger", async () => {
  const events = new EventEmitter();
  const logged = [];
  const engine = { resetCancellation() {}, async run() { throw new Error("detalle sensible ficticio"); } };
  const manager = new JobManager({ engine, events, logger: { error: (message) => logged.push(message) } });
  const failed = once(events, "job:failed");
  manager.create({ mode: "first" });
  await failed;
  assert.deepEqual(logged, ["El procesamiento terminó con error."]);
});
