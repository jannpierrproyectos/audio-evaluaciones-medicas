import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DocumentLibrary } from "../src/documentLibrary.js";
import { EvaluationStore } from "../src/evaluationStore.js";
import { createEncryptedOutput } from "../src/encryptedOutput.js";

const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-normal-documents-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const pdf = Buffer.from("%PDF-1.7 FICTICIOUS PDF CONTENT");
const mp3 = Buffer.from("ID3FICTICIOUS MP3 CONTENT");

test("normal patient-named PDF/MP3 persist, reopen without Connector, and never overwrite another version", async () => fixture(async directory => {
  const library = new DocumentLibrary({ downloadsDir: directory, protect: async () => {} });
  const file = await library.publish(pdf, "Persona Ficticia", ".pdf");
  assert.equal(path.basename(file.file), "01_Evaluacion_Persona_Ficticia.pdf");
  assert.deepEqual(await readFile(file.file), pdf);
  assert.equal((await library.publish(pdf, "Persona Ficticia", ".pdf")).reused, true);
  const changed = await library.publish(Buffer.from("%PDF-1.7 REVISED FICTITIOUS"), "Persona Ficticia", ".pdf");
  assert.notEqual(changed.file, file.file);
  assert.deepEqual(await readFile(file.file), pdf);
  const audio = await library.publish(mp3, "Persona Ficticia", ".mp3");
  assert.deepEqual(await readFile(audio.file), mp3);
  const restarted = new DocumentLibrary({ downloadsDir: directory, protect: async () => {} });
  assert.equal((await restarted.publish(mp3, "Persona Ficticia", ".mp3")).file, audio.file);
  assert.equal((await readdir(path.dirname(audio.file))).length, 1);
  await assert.rejects(library.publish(Buffer.from("NOT PDF"), "Persona", ".pdf"));
}));

test("old encrypted PDF/MP3 become normal named documents without changing originals, keys, or catalogue", async () => fixture(async directory => {
  const store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection }).initialize();
  const root = path.join(directory, "downloads"), run = path.join(root, "2026-10-20_15-09-15_1234abcd");
  await mkdir(path.join(run, "control"), { recursive: true });
  await mkdir(path.join(run, "reportes-completos"), { recursive: true });
  await mkdir(path.join(run, "audioevaluaciones"));
  const output = createEncryptedOutput({ downloadsDir: root, getStore: async () => store, protect: async () => {}, verify: async () => {} });
  const source = path.join(run, "reportes-completos", "opaque.pdf");
  await output.write(source, pdf);
  await output.write(path.join(run, "audioevaluaciones", "primeras-hojas.pdf"), pdf);
  await output.write(path.join(run, "control", "manifest.json"), JSON.stringify({ atenciones: [{ estado: "correcto", paciente: "Persona Ficticia", numeroDocumento: "00000001", paginaConsolidado: 1, telefono: "999111111", archivoPdfCompleto: "opaque.pdf", archivoCompleto: "reportes-completos/opaque.pdf" }, { estado: "correcto", paciente: "INVALID", archivoCompleto: "../outside.pdf" }] }));
  const batch = await store.import({ workers: [{ identificacion: { nombres: "Persona", apellidos: "Ficticia" } }] }, "a".repeat(64));
  const worker = batch.snapshot.workers[0];
  const op = await store.reserve(batch.id, worker.evaluation_id, "b".repeat(64));
  await store.complete(op.id, mp3, { evaluation_id: worker.evaluation_id, fingerprint: op.fingerprint });
  const before = await readFile(source), catalogue = await readFile(path.join(store.directory, "catalogue.enc")), key = await readFile(path.join(store.directory, "key.dpapi"));
  const library = new DocumentLibrary({ downloadsDir: root, protect: async () => {}, readOutput: (_root, file) => output.read(file) });
  const result = await library.restore({ store, roots: [root], logger: { log() {} } });
  assert.deepEqual(result, { pdf: 1, audio: 1, errors: 1 });
  assert.deepEqual(await readFile(path.join(root, "Documentos", "PDF", "01_Evaluacion_Persona_Ficticia.pdf")), pdf);
  assert.deepEqual(await readFile(path.join(root, "Documentos", "MP3", "02_Audio_Persona_Ficticia.mp3")), mp3);
  assert.deepEqual(await readFile(source), before);
  assert.deepEqual(await readFile(path.join(store.directory, "catalogue.enc")), catalogue);
  assert.deepEqual(await readFile(path.join(store.directory, "key.dpapi")), key);
  const recovered = await library.findImport(createHash("sha256").update(pdf).digest("hex"), { store, roots: [root] });
  assert.equal(recovered.matched, true);
  assert.equal(recovered.workers[0].numeroDocumento, "00000001");
  assert.equal(recovered.workers[0].telefono, "999111111");
  assert.equal(recovered.workers[0].archivoPdfCompletoId, "2026-10-20_15-09-15_1234abcd/reportes-completos/opaque.pdf");
  assert.equal(recovered.workers[1].archivoPdfCompletoId, "");
  assert.equal((await library.findImport("0".repeat(64), { store, roots: [root] })).matched, false);
}));

test("new report files are normal PDFs, while encrypted legacy reports and control metadata remain readable", async () => fixture(async directory => {
  const store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection }).initialize();
  const root = path.join(directory, "downloads"); await mkdir(root);
  const legacy = createEncryptedOutput({ downloadsDir: root, getStore: async () => store, verify: async () => {} });
  const output = createEncryptedOutput({ downloadsDir: root, getStore: async () => store, verify: async () => {}, readableDocuments: true });
  await legacy.write(path.join(root, "old.pdf"), pdf);
  await output.write(path.join(root, "new.pdf"), pdf);
  await output.write(path.join(root, "manifest.json"), "{\"safe\":true}");
  assert.deepEqual(await readFile(path.join(root, "new.pdf")), pdf);
  assert.equal((await readFile(path.join(root, "old.pdf"))).subarray(0, 4).toString(), "AED1");
  assert.deepEqual(await output.read(path.join(root, "old.pdf")), pdf);
  assert.equal((await readFile(path.join(root, "manifest.json"))).subarray(0, 4).toString(), "AED1");
}));
