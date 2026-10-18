import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createManagedFileService } from "../src/managedFiles.js";
import { launchBrowser } from "../src/browser.js";

test("Fase06: revelado heredado también bloquea EFS denegado antes de abrir Explorer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-reveal-security-")); let reveals = 0;
  try {
    await writeFile(path.join(directory, "ficticio.pdf"), "%PDF-1.4 FICTICIO");
    const files = createManagedFileService({ downloadsDir: directory, ensureProtectedFile: async () => { throw new Error("denegado"); }, revealFile: async () => { reveals++; } });
    await assert.rejects(files.reveal("ficticio.pdf"), error => error.code === "FILE_PROTECTION_UNAVAILABLE");
    assert.equal(reveals, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Fase06: perfil requiere directorio protegible antes de lanzar navegador", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-profile-security-")); let launches = 0;
  try {
    const file = path.join(directory, "no-es-directorio"); await writeFile(file, "ficticio");
    await assert.rejects(launchBrowser({ authDir: file, packaged: true }, { browserType: { launchPersistentContext: async () => { launches++; } } }));
    assert.equal(launches, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Fase06: desinstalación conserva datos y DPAPI; instalador sin compilador falla explícitamente", async () => {
  const installer = await readFile(new URL("../installer/AudioEvaluacionesConnector.iss", import.meta.url), "utf8");
  assert.doesNotMatch(installer, /\[UninstallDelete\]/i);
  const builder = await readFile(new URL("../scripts/build-windows-installer.js", import.meta.url), "utf8");
  assert.match(builder, /if \(!iscc\)[\s\S]*?process\.exit\(1\)/);
});
