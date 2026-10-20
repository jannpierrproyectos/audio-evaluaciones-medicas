import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../src/http/app.js";
import { deliveryFixture, configuration, pdfBytes } from "../test-support/deliveryFixture.js";

test("abrir entrega devuelve el saludo validado sin declarar mensaje enviado", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  const begun = await f.service.begin({ id: record.id, kind: "conversation", configuration });
  assert.equal(begun.message, record.message);
  assert.match(begun.message, /^Buenas tardes, Persona1 Ficticia/);
  assert.deepEqual((await f.store.catalogue()).data.deliveries[0].confirmations, {});
  await f.service.settle({ id: record.id, intent: begun.intent, success: true, configuration });
  assert.deepEqual((await f.store.catalogue()).data.deliveries[0].confirmations, {});
}));

test("Fase05: prepara PDF/MP3 de la misma evaluación y reutiliza sin TTS ni duplicar exportación", async () => deliveryFixture(async f => {
  const [first, again] = await Promise.all([f.prepare(), f.prepare()]);
  assert.equal(first.id, again.id); assert.equal(first.state, "listo");
  assert.equal(first.confirmations.message, undefined);
  assert.equal(first.phone, "51999111111"); assert.match(first.message, /Persona1 Ficticia/);
  assert.equal((await f.prepare()).id, first.id);
  assert.equal((await readdir(path.join(f.downloads, "audio-whatsapp"))).length, 1);
  const other = await f.prepare(1); assert.notEqual(other.id, first.id); assert.notEqual(other.mp3.sha256, first.mp3.sha256);
  assert.equal(f.revealed.length, 0);
}));

test("Fase05: abrir, copiar y mostrar archivos no son confirmaciones ni completan la entrega", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  await assert.rejects(f.service.complete({ id: record.id, confirmed: true, configuration }), error => error.code === "DELIVERY_CONFIRMATION_REQUIRED");
  await f.effect(record, "conversation"); await f.effect(record, "message");
  await f.service.reveal({ id: record.id, kind: "pdf", configuration }); await f.service.reveal({ id: record.id, kind: "mp3", configuration });
  const row = (await f.service.list()).rows[0]; assert.equal(row.delivery.state, "listo"); assert.deepEqual(row.delivery.confirmations, {});
  assert.equal(f.revealed.length, 2);
}));

test("Fase05: confirmaciones parciales, final explícito, duplicados y reapertura motivada", async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.effect(record, "conversation");
  for (const part of ["message", "pdf", "mp3"]) {
    await f.effect(record, part);
    await assert.rejects(f.service.confirm({ id: record.id, part, confirmed: false, configuration }));
    await f.service.confirm({ id: record.id, part, confirmed: true, configuration });
    assert.equal((await f.service.list()).rows[0].delivery.state, "listo");
    await assert.rejects(f.service.begin({ id: record.id, kind: part, configuration }), error => error.code === "DELIVERY_PART_ALREADY_SENT");
  }
  const completed = await f.service.complete({ id: record.id, confirmed: true, configuration }); assert.equal(completed.state, "completada");
  assert.equal((await f.service.complete({ id: record.id, confirmed: true, configuration })).completed_at, completed.completed_at);
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_ALREADY_COMPLETED");
  await assert.rejects(f.service.reopen({ id: record.id, confirmed: true, reason: "" }));
  await f.service.reopen({ id: record.id, confirmed: true, reason: "Reenvío expresamente solicitado en prueba ficticia" });
  const reopened = await f.prepare(); assert.notEqual(reopened.id, record.id); assert.deepEqual(reopened.confirmations, {});
  assert.equal(reopened.events.some(event => event.action === "reapertura"), true);
}));

for (const scenario of ["telefono", "identidad", "texto", "revocacion", "vencimiento"]) test(`Fase05: ${scenario} invalida preparación y bloquea toda confirmación`, async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.effect(record, "conversation");
  await f.update(0, worker => {
    if (scenario === "telefono") return { ...worker, datos_operativos: { ...worker.datos_operativos, telefono: "999999999" } };
    if (scenario === "identidad") return { ...worker, identificacion: { ...worker.identificacion, dni: "11111111" } };
    if (scenario === "texto") return { ...worker, app_fields: { ...worker.app_fields, texto_final: "Cambio ficticio" } };
    return { ...worker, app_fields: { ...worker.app_fields, recipient_authorization: scenario === "revocacion" ? null : { ...worker.app_fields.recipient_authorization, expires_at: "2000-01-01T00:00:00Z" } } };
  });
  await assert.rejects(f.service.confirm({ id: record.id, part: "message", confirmed: true, configuration }));
  assert.equal((await f.service.list()).rows[0].delivery.state, "incierta");
  await assert.rejects(f.prepare());
}));

test("Fase05: PDF incorrecto para la identidad o para otra fecha bloquea preparación", async () => deliveryFixture(async f => {
  await writeFile(path.join(f.downloads, "informe-1.pdf"), await pdfBytes(2));
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_PDF_IDENTITY");
  await writeFile(path.join(f.downloads, "informe-1.pdf"), await pdfBytes(1, "16/10/2026"));
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_PDF_IDENTITY");
  await writeFile(path.join(f.downloads, "informe-1.pdf"), await pdfBytes(1, "17/10/2026", 2));
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_PDF_IDENTITY");
}));

test("Fase05: modificación silenciosa o ausencia de PDF/MP3 bloquea revelar y confirmar", async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.effect(record, "conversation");
  await writeFile(path.join(f.downloads, "informe-1.pdf"), await pdfBytes(2));
  await assert.rejects(f.service.reveal({ id: record.id, kind: "pdf", configuration })); assert.equal(f.revealed.length, 0);
  assert.equal((await f.service.list()).rows[0].delivery.state, "incierta");
  await unlink(path.join(f.downloads, "informe-1.pdf"));
  await assert.rejects(f.service.confirm({ id: record.id, part: "pdf", confirmed: true, configuration }));
}));

test("Fase05: no acepta PDF sustituido antes de nueva revisión clínica y autorización", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  await writeFile(path.join(f.downloads, "informe-1.pdf"), Buffer.concat([await pdfBytes(1), Buffer.from("\n% fixture changed\n")]));
  // PDF generation changes its authenticated bytes even with the same document/date.
  await assert.rejects(f.service.begin({ id: record.id, kind: "conversation", configuration }));
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_PDF_REVIEW_REQUIRED");
}));

test("Fase05: reinicio con intención pendiente queda incierto; conciliación nunca inventa envío", async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.service.begin({ id: record.id, kind: "conversation", configuration });
  await f.restart(); assert.equal((await f.service.list()).rows[0].delivery.state, "incierta");
  await assert.rejects(f.prepare());
  await assert.rejects(f.service.reconcile({ id: record.id, confirmed: true, reason: "Comprobación ficticia", outcomes: { message: "incierto", pdf: "no_enviado", mp3: "no_enviado" }, configuration }));
  const resolved = await f.service.reconcile({ id: record.id, confirmed: true, reason: "Operador comprueba que no se envió ningún elemento", outcomes: { message: "no_enviado", pdf: "no_enviado", mp3: "no_enviado" }, configuration });
  assert.equal(resolved.state, "cancelada"); assert.deepEqual(resolved.confirmations, {});
  assert.equal((await f.prepare()).state, "listo");
}));

test("Fase05: cancelación y reanudación conservan archivos y confirmaciones parciales tras reinicio", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  await f.service.cancel({ evaluationId: f.batch.snapshot.workers[0].evaluation_id });
  assert.equal((await f.prepare()).id, record.id);
  await f.effect(record, "conversation"); await f.effect(record, "message");
  await f.service.confirm({ id: record.id, part: "message", confirmed: true, configuration });
  await assert.rejects(f.service.cancel({ evaluationId: f.batch.snapshot.workers[0].evaluation_id }));
  await f.restart(); const restored = (await f.service.list()).rows[0].delivery;
  assert.ok(restored.confirmations.message); assert.equal(restored.confirmations.pdf, undefined); assert.equal(restored.state, "listo");
  for (const file of (await readdir(path.join(f.directory, "vault"))).filter(file => file.endsWith(".enc") || file.endsWith(".bak"))) {
    const bytes = await readFile(path.join(f.directory, "vault", file));
    for (const raw of ["Persona1", "INNOMEDIC", "51999111111", record.id]) assert.equal(bytes.includes(Buffer.from(raw)), false);
  }
}));

test("Fase05: EFS denegado impide preparación y revelado; no exporta MP3 sin protección", async () => deliveryFixture(async f => {
  f.deny(); await assert.rejects(f.prepare(), error => error.code === "FILE_PROTECTION_UNAVAILABLE");
  assert.equal(f.revealed.length, 0); await assert.rejects(readdir(path.join(f.downloads, "audio-whatsapp")), error => error.code === "ENOENT");
}));

test("Fase05: cambios de voz y MP3 obsoleto no permiten nueva preparación", async () => deliveryFixture(async f => {
  const detail = await f.service.detail(f.batch.snapshot.workers[0].evaluation_id);
  await assert.rejects(f.service.prepare({ evaluationId: detail.worker.evaluation_id, expectedBinding: detail.binding, configuration: { ...configuration, voice_ref: "otra" } }), error => error.code === "DELIVERY_CONFIGURATION_CHANGED");
  await f.update(0, worker => ({ ...worker, app_fields: { ...worker.app_fields, audio_stale: true } }));
  await assert.rejects(f.prepare(), error => error.code === "DELIVERY_BLOCKED");
}));

test("Fase05: MP3 alterado o eliminado nunca se revela ni se confirma", async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.effect(record, "conversation");
  const audioDir = path.join(f.downloads, "audio-whatsapp"), filename = (await readdir(audioDir))[0];
  await writeFile(path.join(audioDir, filename), Buffer.from("ID3otro-trabajador"));
  await assert.rejects(f.service.reveal({ id: record.id, kind: "mp3", configuration }));
  assert.equal(f.revealed.length, 0);
  await unlink(path.join(audioDir, filename));
  await assert.rejects(f.service.confirm({ id: record.id, part: "mp3", confirmed: true, configuration }));
}));

test("Fase05: fallo de acción bloquea repetición; conciliación no borra declaraciones previas", async () => deliveryFixture(async f => {
  const record = await f.prepare(); await f.effect(record, "conversation"); await f.effect(record, "message");
  await f.service.confirm({ id: record.id, part: "message", confirmed: true, configuration });
  const pending = await f.service.begin({ id: record.id, kind: "pdf", configuration });
  await assert.rejects(f.service.begin({ id: record.id, kind: "pdf", configuration }));
  await f.service.settle({ id: record.id, intent: pending.intent, success: false, configuration });
  await assert.rejects(f.service.reconcile({ id: record.id, confirmed: true, reason: "Intento contradictorio ficticio", outcomes: { message: "no_enviado", pdf: "no_enviado", mp3: "no_enviado" }, configuration }));
  assert.ok((await f.service.list()).rows[0].delivery.confirmations.message);
  const reconciled = await f.service.reconcile({ id: record.id, confirmed: true, reason: "Comprobación manual ficticia", outcomes: { message: "enviado", pdf: "no_enviado", mp3: "no_enviado" }, configuration });
  assert.equal(reconciled.state, "listo"); assert.equal(reconciled.confirmations.pdf, undefined);
  await assert.rejects(f.service.complete({ id: record.id, confirmed: true, configuration }));
}));

test("Fase05 HTTP: exige origen, rechaza rutas y acciones arbitrarias y no expone rutas en errores", async () => deliveryFixture(async f => {
  const server = createServer(createApp({ engine: {}, jobManager: {}, version: "prueba", allowedOrigins: new Set(["http://localhost:5173"]), getEvaluationStore: f.getStore, managedFiles: f.files }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = (body, origin = "http://localhost:5173") => fetch(`http://127.0.0.1:${server.address().port}/deliveries`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await request({ action: "list" }, null)).status, 403);
    assert.equal((await request({ action: "list" }, "https://externo.invalid")).status, 403);
    assert.equal((await request({ action: "reveal", path: "C:/privado/dato.pdf" })).status, 400);
    assert.equal((await request({ action: "__proto__" })).status, 400);
    const listed = await request({ action: "list" }); assert.equal(listed.status, 200); assert.equal(listed.headers.get("cache-control"), "no-store");
    const evaluationId = f.batch.snapshot.workers[0].evaluation_id, detail = await f.service.detail(evaluationId);
    await unlink(path.join(f.downloads, "informe-1.pdf"));
    const failed = await request({ action: "prepare", evaluationId, expectedBinding: detail.binding, configuration });
    assert.equal(failed.status, 409); assert.equal((await failed.text()).includes(f.directory), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test("Fase05: eliminar un lote no deja preparaciones huérfanas ni borra historial de acciones", async () => {
  await deliveryFixture(async f => {
    await f.prepare(); const loaded = await f.store.load(f.batch.id);
    await f.store.remove(loaded.id, loaded.revision);
    assert.equal((await f.service.list()).rows.length, 0);
    assert.equal(await f.store.exclusive(async data => ({ value: data.deliveries.length })), 0);
  });
  await deliveryFixture(async f => {
    const record = await f.prepare(); await f.effect(record, "conversation");
    const loaded = await f.store.load(f.batch.id);
    await assert.rejects(f.store.remove(loaded.id, loaded.revision), error => error.code === "STORE_DELIVERY_HISTORY_PRESENT");
    assert.equal((await f.service.list()).rows.length, 2);
  });
});

test("Fase05: preparación interrumpida después de exportar se recupera con el mismo identificador y archivo", async () => deliveryFixture(async f => {
  const record = await f.prepare();
  await f.store.exclusive(async data => {
    const interrupted = data.deliveries.find(value => value.id === record.id);
    interrupted.state = "preparando"; delete interrupted.pdf; delete interrupted.mp3; delete interrupted.message;
    return { write: true };
  });
  await f.restart(); assert.equal((await f.service.list()).rows[0].delivery.state, "preparando");
  const recovered = await f.prepare(); assert.equal(recovered.id, record.id); assert.equal(recovered.state, "listo");
  assert.equal((await readdir(path.join(f.downloads, "audio-whatsapp"))).length, 1);
  assert.deepEqual(recovered.confirmations, {});
}));
