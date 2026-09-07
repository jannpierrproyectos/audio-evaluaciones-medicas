import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createApp } from "../src/http/app.js";
import { createManagedFileService } from "../src/managedFiles.js";

async function withServer(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "audioevaluaciones-http-files-"));
  const fullDir = path.join(root, "2026-09-07", "reportes-completos");
  const pdfPath = path.join(fullDir, "reporte.pdf");
  await mkdir(fullDir, { recursive: true });
  await writeFile(pdfPath, "%PDF-1.4");
  const revealed = [];
  const managedFiles = createManagedFileService({
    downloadsDir: root,
    revealFile: async (file) => revealed.push(file),
  });
  const jobManager = {
    hasActiveJob: false,
    workerMetadata() {
      return {
        mode: "both",
        workers: [{
          numeroDocumento: "12345678",
          paginaConsolidado: 1,
          telefono: "999999999",
          archivoPdfCompleto: "reporte.pdf",
        }],
      };
    },
    workerFullPdfPath() { return pdfPath; },
  };
  const server = createServer(createApp({
    engine: { browserOpen: false },
    jobManager,
    managedFiles,
    version: "files-test",
    allowedOrigins: new Set(["http://localhost:5173"]),
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      revealed,
      pdfPath,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test("metadata entrega un ID relativo controlado para el PDF existente", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/jobs/job/worker-metadata`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.workers[0].archivoPdfCompletoId, "2026-09-07/reportes-completos/reporte.pdf");
    assert.equal(body.workers[0].archivoPdfCompletoDisponible, true);
    assert.doesNotMatch(JSON.stringify(body), /audioevaluaciones-http-files-/i);
  });
});

test("API guarda MP3 y revela PDF/audio solo con Origin autorizado", async () => {
  await withServer(async ({ baseUrl, revealed, pdfPath }) => {
    const withoutOrigin = await fetch(`${baseUrl}/files/audio`, {
      method: "POST",
      headers: { "Content-Type": "audio/mpeg", "X-Audio-Filename": "audio.mp3" },
      body: Buffer.from("ID3audio"),
    });
    assert.equal(withoutOrigin.status, 403);
    assert.equal((await withoutOrigin.json()).code, "ORIGIN_REQUIRED");

    const saved = await fetch(`${baseUrl}/files/audio`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "audio/mpeg",
        "X-Audio-Filename": encodeURIComponent("02_Audio_Juan_12345678.mp3"),
      },
      body: Buffer.from("ID3audio"),
    });
    assert.equal(saved.status, 201);
    const savedBody = await saved.json();
    assert.equal(savedBody.file.name, "02_Audio_Juan_12345678.mp3");
    assert.match(savedBody.file.id, /^audio-whatsapp\//);
    assert.equal("absolutePath" in savedBody.file, false);

    const pdfValidation = await fetch(`${baseUrl}/files/validate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: "2026-09-07/reportes-completos/reporte.pdf" }),
    });
    assert.equal(pdfValidation.status, 200);
    assert.equal(revealed.length, 0);

    const pdfReveal = await fetch(`${baseUrl}/files/reveal`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: "2026-09-07/reportes-completos/reporte.pdf" }),
    });
    assert.equal(pdfReveal.status, 200);

    const audioReveal = await fetch(`${baseUrl}/files/reveal`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: savedBody.file.id }),
    });
    assert.equal(audioReveal.status, 200);
    assert.equal(revealed[0], pdfPath);
    assert.match(revealed[1], /audio-whatsapp[\\/]02_Audio_Juan_12345678\.mp3$/);
  });
});

test("API rechaza traversal, ruta absoluta, extensión y MIME no permitidos", async () => {
  await withServer(async ({ baseUrl }) => {
    const headers = { Origin: "http://localhost:5173", "Content-Type": "application/json" };
    for (const fileId of ["../externo.pdf", "C:\\Windows\\archivo.pdf", "\\\\servidor\\archivo.mp3"]) {
      const response = await fetch(`${baseUrl}/files/reveal`, {
        method: "POST",
        headers,
        body: JSON.stringify({ fileId }),
      });
      assert.equal(response.status, 400, fileId);
    }

    const extension = await fetch(`${baseUrl}/files/reveal`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fileId: "2026-09-07/reporte.txt" }),
    });
    assert.equal(extension.status, 415);
    assert.equal((await extension.json()).code, "FILE_TYPE_NOT_ALLOWED");

    const mime = await fetch(`${baseUrl}/files/audio`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/octet-stream", "X-Audio-Filename": "audio.mp3" },
      body: Buffer.from("ID3audio"),
    });
    assert.equal(mime.status, 415);
    assert.equal((await mime.json()).code, "INVALID_AUDIO_TYPE");
  });
});
