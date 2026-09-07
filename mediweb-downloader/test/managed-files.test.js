import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import {
  MAX_AUDIO_BYTES,
  ManagedFileError,
  createManagedFileService,
  revealInWindowsExplorer,
  sanitizeAudioFilename,
} from "../src/managedFiles.js";

async function withManagedFiles(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "audioevaluaciones-files-"));
  const revealed = [];
  const service = createManagedFileService({
    downloadsDir: root,
    revealFile: async (file) => revealed.push(file),
  });
  try {
    await callback({ root, service, revealed });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("identifica y muestra PDF y MP3 permitidos sin abrir Explorer real", async () => {
  await withManagedFiles(async ({ root, service, revealed }) => {
    const reportDir = path.join(root, "lote", "reportes-completos");
    await mkdir(reportDir, { recursive: true });
    const pdf = path.join(reportDir, "reporte.pdf");
    const mp3 = path.join(root, "audio.mp3");
    await writeFile(pdf, "%PDF-1.4");
    await writeFile(mp3, Buffer.from("ID3audio"));

    const pdfFile = await service.identifyAbsoluteFile(pdf, ".pdf");
    const mp3File = await service.identifyAbsoluteFile(mp3, ".mp3");
    assert.equal(pdfFile.id, "lote/reportes-completos/reporte.pdf");
    assert.equal(mp3File.id, "audio.mp3");
    await service.reveal(pdfFile.id);
    await service.reveal(mp3File.id);
    assert.deepEqual(revealed, [pdf, mp3]);
  });
});

test("rechaza archivo inexistente, traversal, ruta absoluta, UNC y extensión no permitida", async () => {
  await withManagedFiles(async ({ root, service }) => {
    const txt = path.join(root, "dato.txt");
    await writeFile(txt, "no permitido");
    await assert.rejects(() => service.resolveFileId("inexistente.pdf"), hasCode("FILE_NOT_FOUND"));
    await assert.rejects(() => service.resolveFileId("../externo.pdf"), hasCode("FILE_OUTSIDE_MANAGED_DIRECTORY"));
    await assert.rejects(() => service.resolveFileId(path.resolve(root, "reporte.pdf")), hasCode("INVALID_FILE_ID"));
    await assert.rejects(() => service.resolveFileId("\\\\servidor\\reporte.pdf"), hasCode("INVALID_FILE_ID"));
    await assert.rejects(() => service.resolveFileId("dato.txt"), hasCode("FILE_TYPE_NOT_ALLOWED"));
  });
});

test("rechaza una ruta externa incluso al identificarla desde backend", async () => {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "audioevaluaciones-outside-"));
  try {
    const outside = path.join(outsideRoot, "externo.pdf");
    await writeFile(outside, "%PDF-1.4");
    await withManagedFiles(async ({ service }) => {
      await assert.rejects(() => service.identifyAbsoluteFile(outside, ".pdf"), hasCode("FILE_OUTSIDE_MANAGED_DIRECTORY"));
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("guarda MP3 con nombre sanitizado, deduplica por contenido y no sobrescribe otro audio", async () => {
  await withManagedFiles(async ({ service }) => {
    const firstAudio = Buffer.from("ID3audio-uno");
    const otherAudio = Buffer.from("ID3audio-dos");
    const first = await service.saveMp3(firstAudio, '02_Audio_Juan:<Pérez>_123.mp3');
    const repeated = await service.saveMp3(firstAudio, '02_Audio_Juan:<Pérez>_123.mp3');
    const other = await service.saveMp3(otherAudio, '02_Audio_Juan:<Pérez>_123.mp3');
    assert.equal(first.name, "02_Audio_Juan_Pérez_123.mp3");
    assert.equal(repeated.id, first.id);
    assert.equal(repeated.reused, true);
    assert.notEqual(other.id, first.id);
    assert.match(other.name, /_[a-f0-9]{10}\.mp3$/);
  });
});

test("limita tamaño y valida firma del contenido MP3", async () => {
  await withManagedFiles(async ({ service }) => {
    await assert.rejects(() => service.saveMp3(Buffer.from("no-es-mp3"), "audio.mp3"), hasCode("INVALID_AUDIO"));
    await assert.rejects(
      () => service.saveMp3(Buffer.alloc(MAX_AUDIO_BYTES + 1, 0xff), "audio.mp3"),
      hasCode("AUDIO_TOO_LARGE"),
    );
  });
});

test("sanitiza nombres reservados e inválidos de Windows", () => {
  assert.equal(sanitizeAudioFilename("CON.mp3"), "_CON.mp3");
  assert.equal(sanitizeAudioFilename('02 Audio: Juan / Pérez?.mp3'), "02_Audio_Juan_Pérez.mp3");
});

test("Explorer se invoca sin shell y con /select como un argumento", async () => {
  const calls = [];
  const child = new EventEmitter();
  child.unref = () => { child.unrefCalled = true; };
  const promise = revealInWindowsExplorer("C:\\Reportes\\reporte.pdf", {
    platform: "win32",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  await promise;
  assert.deepEqual(calls, [{
    command: "explorer.exe",
    args: ["/select,C:\\Reportes\\reporte.pdf"],
    options: { detached: true, shell: false, stdio: "ignore" },
  }]);
  assert.equal(child.unrefCalled, true);
});

function hasCode(code) {
  return (error) => error instanceof ManagedFileError && error.code === code;
}
