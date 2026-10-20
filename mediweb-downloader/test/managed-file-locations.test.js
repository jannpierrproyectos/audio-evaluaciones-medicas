import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createManagedFileService } from "../src/managedFiles.js";
import { createEncryptedOutput } from "../src/encryptedOutput.js";
import { EvaluationStore } from "../src/evaluationStore.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-file-locations-"));
  try {
    const current = path.join(directory, "development"), original = path.join(directory, "installed");
    await mkdir(current); await mkdir(path.join(original, "batch"), { recursive: true });
    const store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection: { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() } }).initialize();
    await store.exclusive(() => ({ write: true, value: null }));
    const output = createEncryptedOutput({ downloadsDir: original, getStore: async () => store, protect: async () => {}, verify: async () => {} });
    const id = "batch/full.pdf", bytes = Buffer.from("%PDF-1.4 fictional original");
    const file = path.join(original, id); await output.write(file, bytes);
    const revealed = [];
    const service = createManagedFileService({ downloadsDir: current, ensureProtectedFile: async () => {},
      readFallbacks: [{ downloadsDir: original, readProtectedOutput: output.read }],
      temporaryAttachments: { isReference: () => false, reveal: async value => { revealed.push(value); return { name: "private working copy" }; } } });
    await run({ service, original, current, id, bytes, file, revealed, store });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test("known-location fallback recovers exact encrypted original without download or catalogue change", async () => fixture(async f => {
  const before = await readFile(f.file), catalogue = await readFile(path.join(f.store.directory, "catalogue.enc"));
  const inspected = await f.service.inspectFile(f.id, ".pdf");
  assert.deepEqual(inspected.bytes, f.bytes);
  assert.equal(inspected.sha256, hash(f.bytes));
  assert.equal((await f.service.resolveFileId(f.id)).id, f.id);
  await f.service.revealPinned(f.id, hash(f.bytes), ".pdf");
  assert.deepEqual(f.revealed[0].bytes, f.bytes);
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(path.join(f.store.directory, "catalogue.enc")), catalogue);
}));
test("duplicate relative locations and traversal never choose an arbitrary medical file", async () => fixture(async f => {
  await mkdir(path.dirname(path.join(f.current, f.id)), { recursive: true });
  await writeFile(path.join(f.current, f.id), "%PDF-1.4 different fictional person");
  await assert.rejects(f.service.inspectFile(f.id, ".pdf"), { code: "FILE_LOCATION_AMBIGUOUS" });
  await assert.rejects(f.service.reveal(f.id), { code: "FILE_LOCATION_AMBIGUOUS" });
  await assert.rejects(f.service.inspectFile("../outside.pdf", ".pdf"));
  assert.equal(f.revealed.length, 0);
}));
test("missing original retains an explicit FILE_NOT_FOUND and never creates a replacement", async () => fixture(async f => {
  await assert.rejects(f.service.inspectFile("batch/absent.pdf", ".pdf"), { code: "FILE_NOT_FOUND" });
  assert.equal(f.revealed.length, 0);
}));
