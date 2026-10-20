import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { EvaluationStore } from "../src/evaluationStore.js";
import { TemporaryAttachments, removeAttachmentSession, ATTACHMENT_TTL_MS } from "../src/temporaryAttachments.js";
import { createManagedFileService } from "../src/managedFiles.js";
import { deliveryFixture, configuration } from "../test-support/deliveryFixture.js";
import { createEncryptedOutput } from "../src/encryptedOutput.js";
import { saveControl } from "../src/manifest.js";
import { createServer } from "node:http";
import { createApp } from "../src/http/app.js";
import { deliveryAttachmentName, isDeliveryAttachmentName } from "../src/fileNames.js";

test("nombres de adjuntos: nombre del trabajador, extension fija y sin rutas ni controles", () => {
  assert.equal(deliveryAttachmentName("Persona Ficticia", ".pdf"), "01_Evaluacion_Persona_Ficticia.pdf");
  assert.equal(deliveryAttachmentName("Persona Ficticia", ".mp3"), "02_Audio_Persona_Ficticia.mp3");
  for (const patient of ['../Persona: Ficticia\\carpeta', "CON", "Persona\nFicticia\u0000", "Ángela Muñoz", "A".repeat(200)]) {
    for (const extension of [".pdf", ".mp3"]) {
      const name = deliveryAttachmentName(patient, extension);
      assert.equal(path.basename(name), name);
      assert.equal(isDeliveryAttachmentName(name), true);
      assert.equal(path.extname(name), extension);
    }
  }
  for (const name of ["../01_Evaluacion_Persona.pdf", "02_Audio_Persona.pdf", "01_Evaluacion_Persona.exe", "01_Evaluacion_Persona\u0000.pdf"]) assert.equal(isDeliveryAttachmentName(name), false);
});

test("adjuntos con nombre: entrega real, vencimiento y reinicio conservan originales cifrados", async () => deliveryFixture(async f => {
  let clock = Date.now();
  const settings = { directory: path.join(f.directory, "named-attachments"), getStore: f.getStore, protect: async () => {}, verify: async () => {}, watchdog: async () => {}, now: () => clock };
  const temporary = new TemporaryAttachments(settings), revealed = [];
  const files = createManagedFileService({ downloadsDir: f.downloads, temporaryAttachments: temporary, ensureProtectedFile: async () => {}, revealFile: async file => revealed.push(file) });
  f.service.managedFiles = files;
  const record = await f.prepare();
  const stored = (await f.store.catalogue()).data.deliveries[0];
  await f.effect(record, "conversation");
  const original = await readFile(path.join(f.downloads, "informe-1.pdf"));
  await f.service.reveal({ id: record.id, kind: "pdf", configuration });
  await f.service.reveal({ id: record.id, kind: "mp3", configuration });
  assert.equal(path.basename(revealed[0]), deliveryAttachmentName(record.recipient_name, ".pdf"));
  assert.equal(path.basename(revealed[1]), deliveryAttachmentName(record.recipient_name, ".mp3"));
  assert.notEqual(path.basename(revealed[0]), "adjunto.pdf");
  assert.deepEqual(await readFile(revealed[0]), original);
  assert.equal((await f.store.catalogue()).data.deliveries[0].confirmations.pdf, undefined);
  const sourceAudio = (await files.inspectFile(stored.mp3.id, ".mp3")).bytes;
  assert.equal((await readFile(revealed[1])).equals(sourceAudio), true);
  clock += ATTACHMENT_TTL_MS + 1;
  const restarted = new TemporaryAttachments(settings);
  await restarted.initialize();
  await assert.rejects(readFile(revealed[0]), { code: "ENOENT" });
  await assert.rejects(readFile(revealed[1]), { code: "ENOENT" });
  const recovered = createManagedFileService({ downloadsDir: f.downloads, temporaryAttachments: restarted, ensureProtectedFile: async () => {}, revealFile: async file => revealed.push(file) });
  await recovered.revealPinned(stored.pdf.id, stored.pdf.sha256, ".pdf", record.recipient_name);
  await recovered.revealPinned(stored.mp3.id, stored.mp3.sha256, ".mp3", record.recipient_name);
  assert.deepEqual(await readFile(revealed[2]), original);
  assert.deepEqual(await readFile(revealed[3]), sourceAudio);
  assert.deepEqual(await readFile(path.join(f.downloads, "informe-1.pdf")), original);
  await restarted.release();
  assert.deepEqual(await readdir(settings.directory), []);
}));

test("limpieza de adjuntos con nombre rechaza archivos no declarados en la sesion", async () => fixture(async f => {
  await mkdir(f.settings.directory);
  const directory = path.join(f.settings.directory, randomUUID()); await mkdir(directory);
  await writeFile(path.join(directory, "lease.json"), JSON.stringify({ pid: process.pid, expires: 0, file_name: "01_Evaluacion_Persona.pdf" }));
  await writeFile(path.join(directory, "01_Evaluacion_Persona.pdf"), "%PDF-FICTICIO");
  await writeFile(path.join(directory, "01_Evaluacion_Ajeno.pdf"), "NO BORRAR");
  await assert.rejects(removeAttachmentSession(directory));
  assert.equal((await readFile(path.join(directory, "01_Evaluacion_Ajeno.pdf"))).toString(), "NO BORRAR");
  assert.equal((await readFile(path.join(directory, "01_Evaluacion_Persona.pdf"))).toString(), "%PDF-FICTICIO");
}));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const fakeProtection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };

test("UX scenario 5: expired readable PDF is recreated from its protected original without downloading", async () => fixture(async f => {
  let now = Date.now();
  const temporary = new TemporaryAttachments({ ...f.settings, now: () => now });
  const downloads = path.join(f.directory, "downloads"); await mkdir(downloads);
  const bytes = Buffer.from("%PDF-1.4 FICTICIO");
  await writeFile(path.join(downloads, "original.pdf"), bytes);
  const revealed = [];
  const files = createManagedFileService({ downloadsDir: downloads, temporaryAttachments: temporary,
    ensureProtectedFile: async () => {}, revealFile: async file => revealed.push(file) });
  await files.revealPinned("original.pdf", sha256(bytes), ".pdf");
  now += ATTACHMENT_TTL_MS + 1;
  await files.revealPinned("original.pdf", sha256(bytes), ".pdf");
  assert.equal(revealed.length, 2);
  assert.notEqual(revealed[0], revealed[1]);
  await assert.rejects(readFile(revealed[0]), { code: "ENOENT" });
  assert.deepEqual(await readFile(revealed[1]), bytes);
  assert.deepEqual(await readFile(path.join(downloads, "original.pdf")), bytes);
  await temporary.release();
}));

async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-attachments-test-"));
  try {
    const store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection: fakeProtection }).initialize();
    const settings = { directory: path.join(directory, "temporary"), getStore: async () => store, protect: async () => {}, verify: async () => {}, watchdog: async () => {} };
    const temporary = new TemporaryAttachments(settings);
    await callback({ directory, store, settings, temporary });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Home: MP3 persistente cifrado, referencia opaca y recuperación sin regeneración", async () => fixture(async f => {
  const bytes = Buffer.from("ID3FICTICIO solo prueba");
  const first = await f.temporary.storeAudio(bytes), again = await f.temporary.storeAudio(bytes);
  assert.equal(first.id, again.id); assert.doesNotMatch(first.id, /DNI|Persona/);
  const encrypted = await readFile(path.join(f.store.directory, "attachments-v1", `${sha256(bytes)}.enc`));
  assert.equal(encrypted.includes(bytes), false); assert.equal(encrypted.subarray(0, 4).toString(), "AE01");
  const restarted = new TemporaryAttachments(f.settings); await restarted.initialize();
  assert.deepEqual((await restarted.readAudio(first.id)).bytes, bytes);
  await assert.rejects(restarted.readAudio("attachments/../../archivo.mp3"));
}));

test("Home: preparación no escribe MP3 legible; revelar crea copia acotada y finalizar la elimina", async () => fixture(async f => {
  const downloads = path.join(f.directory, "downloads"); await mkdir(downloads);
  const revealed = [], files = createManagedFileService({ downloadsDir: downloads, temporaryAttachments: f.temporary, ensureProtectedFile: async () => {}, revealFile: async file => revealed.push(file) });
  const audio = await files.saveMp3(Buffer.from("ID3MP3FICTICIO"), "DNI_NO_USAR.mp3");
  assert.deepEqual(await readdir(downloads), []); assert.deepEqual(await readdir(f.settings.directory), []);
  await files.revealPinned(audio.id, audio.sha256, ".mp3");
  assert.equal(revealed.length, 1); assert.equal(path.basename(revealed[0]), "adjunto.mp3");
  assert.match(path.basename(path.dirname(revealed[0])), /^[a-f0-9-]{36}$/);
  assert.equal((await readFile(revealed[0])).toString(), "ID3MP3FICTICIO");
  await files.releaseTemporary([audio.id]); assert.deepEqual(await readdir(f.settings.directory), []);
  assert.equal((await files.inspectFile(audio.id)).sha256, audio.sha256);
}));

test("Home: hash de PDF comprobado antes de revelar, sin revelar archivo fuente", async () => fixture(async f => {
  const downloads = path.join(f.directory, "downloads"); await mkdir(downloads);
  const bytes = Buffer.from("%PDF-1.4 FICTICIO"); await writeFile(path.join(downloads, "fuente.pdf"), bytes);
  const revealed = [], files = createManagedFileService({ downloadsDir: downloads, temporaryAttachments: f.temporary, ensureProtectedFile: async () => {}, revealFile: async file => revealed.push(file) });
  await assert.rejects(files.revealPinned("fuente.pdf", "0".repeat(64), ".pdf")); assert.equal(revealed.length, 0);
  await files.revealPinned("fuente.pdf", sha256(bytes), ".pdf");
  assert.notEqual(revealed[0], path.join(downloads, "fuente.pdf")); assert.deepEqual(await readFile(revealed[0]), bytes);
  await f.temporary.release();
}));

test("Home: permisos o vigilante no disponibles impiden escribir contenido legible", async () => fixture(async f => {
  const bytes = Buffer.from("ID3FICTICIO"), file = { id: "test", extension: ".mp3", bytes, sha256: sha256(bytes) };
  for (const overrides of [{ verify: async () => { throw Error("ACL"); } }, { watchdog: async () => { throw Error("watchdog"); } }]) {
    const temporary = new TemporaryAttachments({ ...f.settings, ...overrides }); let revealed = false;
    await assert.rejects(temporary.reveal(file, async () => { revealed = true; })); assert.equal(revealed, false);
    for (const directory of await readdir(f.settings.directory)) assert.deepEqual((await readdir(path.join(f.settings.directory, directory))).filter(name => name.endsWith(".mp3")), []);
  }
}));

test("Home: inicio recupera restos vencidos y rechaza sesión viva o contenido desconocido", async () => fixture(async f => {
  await mkdir(f.settings.directory);
  const abandoned = path.join(f.settings.directory, randomUUID()); await mkdir(abandoned);
  await writeFile(path.join(abandoned, "lease.json"), JSON.stringify({ pid: process.pid, expires: 0 }));
  await writeFile(path.join(abandoned, "adjunto.pdf"), "%PDF-FICTICIO");
  await f.temporary.initialize(); assert.deepEqual(await readdir(f.settings.directory), []);
  const live = path.join(f.settings.directory, randomUUID()); await mkdir(live);
  await writeFile(path.join(live, "lease.json"), JSON.stringify({ pid: process.pid, expires: Date.now() + 10000 }));
  await assert.rejects(new TemporaryAttachments(f.settings).initialize());
  await removeAttachmentSession(live);
  const unknown = path.join(f.settings.directory, randomUUID()); await mkdir(unknown); await writeFile(path.join(unknown, "ajeno.txt"), "NO BORRAR");
  await assert.rejects(new TemporaryAttachments(f.settings).initialize());
  assert.equal((await readFile(path.join(unknown, "ajeno.txt"))).toString(), "NO BORRAR");
}));

test("Home: caducidad y sustitución no dejan copias previas disponibles", async () => fixture(async f => {
  let clock = Date.now(); const temporary = new TemporaryAttachments({ ...f.settings, now: () => clock, ttl: 100 });
  const bytes = Buffer.from("%PDF-FICTICIO"), file = { id: "original", extension: ".pdf", bytes, sha256: sha256(bytes) }, paths = [];
  await temporary.reveal(file, async file => paths.push(file));
  clock += 101;
  await temporary.reveal(file, async file => paths.push(file));
  await assert.rejects(readFile(paths[0]), error => error.code === "ENOENT"); assert.deepEqual(await readFile(paths[1]), bytes);
  assert.throws(() => new TemporaryAttachments({ ...f.settings, ttl: ATTACHMENT_TTL_MS + 1 }));
  await temporary.release();
}));

test("Home: limpieza no sigue junction ni borra archivos externos", async () => fixture(async f => {
  const outside = path.join(f.directory, "outside"); await mkdir(outside); await writeFile(path.join(outside, "adjunto.pdf"), "NO BORRAR");
  const junction = path.join(f.directory, randomUUID()); await symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(removeAttachmentSession(junction)); assert.equal((await readFile(path.join(outside, "adjunto.pdf"))).toString(), "NO BORRAR");
}));

test("Home: confirmación humana elimina solo su temporal, conserva persistencia y bloqueos", async () => deliveryFixture(async f => {
  const released = []; f.files.releaseTemporary = async ids => released.push(ids);
  const record = await f.prepare(); await f.effect(record, "conversation"); await f.effect(record, "pdf");
  await f.service.confirm({ id: record.id, part: "pdf", confirmed: true, configuration });
  assert.equal(released.length, 1); assert.match(released[0][0], /informe-1.pdf/);
  assert.equal((await f.service.list()).rows[0].delivery.state, "listo");
  await f.update(0, worker => ({ ...worker, app_fields: { ...worker.app_fields, recipient_authorization: null } }));
  await f.service.list(); assert.ok(released.length > 1);
  await assert.rejects(f.service.reveal({ id: record.id, kind: "mp3", configuration }));
}));

test("Home: PDF y controles descargados se cifran antes de escribir y se recuperan con DPAPI", async () => fixture(async f => {
  const root = path.join(f.directory, "downloads"), control = path.join(root, "control"); await mkdir(control, { recursive: true });
  const output = createEncryptedOutput({ downloadsDir: root, getStore: async () => f.store, protect: async () => {}, verify: async () => {} });
  await output.protectOutput({ root, control });
  const pdf = path.join(control, "ficticio.pdf"), bytes = Buffer.from("%PDF-FICTICIO-PRIVADO");
  await output.write(pdf, bytes);
  assert.equal((await readFile(pdf)).includes(bytes), false);
  assert.deepEqual(await output.read(pdf), bytes);
  await saveControl({ atenciones: [] }, { manifest: path.join(control, "manifest.json"), csv: path.join(control, "resultados.csv") }, output.write);
  assert.equal((await readFile(path.join(control, "manifest.json"))).subarray(0, 4).toString(), "AED1");
  assert.deepEqual(JSON.parse((await output.read(path.join(control, "manifest.json"))).toString()), { atenciones: [] });
  const moved = path.join(control, "otro.pdf"); await writeFile(moved, await readFile(pdf)); await assert.rejects(output.read(moved));
  await assert.rejects(output.write(path.join(f.directory, "outside.pdf"), bytes));
}));

test("Home HTTP: finalizar solo retira sesiones por referencia, exige Origin y rechaza rutas extra", async () => {
  const released = [], server = createServer(createApp({ engine: {}, jobManager: {}, version: "test", allowedOrigins: new Set(["http://localhost:5173"]), managedFiles: { releaseTemporary: async ids => released.push(ids) } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/files/release`, body = { fileIds: ["run/ficticio.pdf"] };
    const post = (body, origin) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post(body)).status, 403);
    assert.equal((await post(body, "https://ajeno.invalid")).status, 403);
    assert.equal((await post({ ...body, path: "C:/ajeno" }, "http://localhost:5173")).status, 400);
    assert.equal((await post({ fileIds: [] }, "http://localhost:5173")).status, 400);
    assert.equal((await post(body, "http://localhost:5173")).status, 200); assert.deepEqual(released, [["run/ficticio.pdf"]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Home: refrescar una intención en curso no retira el adjunto antes de poder enviarlo", async () => deliveryFixture(async f => {
  const released = []; f.files.releaseTemporary = async ids => released.push(ids);
  const record = await f.prepare(), begun = await f.service.begin({ id: record.id, kind: "conversation", configuration });
  assert.equal((await f.service.list()).rows[0].delivery.state, "incierta");
  assert.equal(released.length, 0);
  await f.service.settle({ id: record.id, intent: begun.intent, success: true, configuration });
  assert.equal((await f.service.list()).rows[0].delivery.state, "listo");
}));
