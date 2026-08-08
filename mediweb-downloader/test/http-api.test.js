import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createApp } from "../src/http/app.js";
import { JobManager } from "../src/http/jobManager.js";

class FakeEngine {
  constructor(directory) {
    this.directory = directory;
    this.browserOpen = false;
    this.hold = true;
  }

  async open() {
    this.browserOpen = true;
    return { browserOpen: true };
  }

  async detectSummary() {
    return { page: 1, detected: 10, eligible: 7, excluded: { observado: 1, pendiente: 1, noApto: 1, otros: 0 } };
  }

  cancel() {}

  async run(options, { isCancelled, onProgress }) {
    const manifest = {
      totalPaginasVisitadas: 1,
      totalDetectado: 10,
      totalElegible: 7,
      totalExcluido: 3,
      totalSeleccionado: 7,
      totalProcesado: 0,
      reportesCompletosGenerados: 0,
      primerasHojasAgregadas: 0,
      errores: 0,
      pagination: { motivoFinalizacion: null },
    };
    onProgress({ type: "page_started", currentPage: 1, totals: {
      totalDetectado: 10, totalElegible: 7, totalSeleccionado: 7, totalProcesado: 0,
    }, manifest });
    while (this.hold && !isCancelled()) await new Promise((resolve) => setTimeout(resolve, 5));
    if (isCancelled()) {
      manifest.pagination.motivoFinalizacion = "cancelado";
      return { status: "cancelled", manifest, paths: {} };
    }
    manifest.totalProcesado = 7;
    manifest.reportesCompletosGenerados = options.mode === "full" || options.mode === "both" ? 7 : 0;
    manifest.primerasHojasAgregadas = options.mode === "first" || options.mode === "both" ? 7 : 0;
    manifest.pagination.motivoFinalizacion = "ultima_pagina";
    const paths = {};
    if (options.mode === "first" || options.mode === "both") {
      paths.consolidated = path.join(this.directory, `primeras-hojas-${Date.now()}.pdf`);
      await writeFile(paths.consolidated, Buffer.from("%PDF-1.4\n% fake local test\n"));
    }
    return { status: "completed", manifest, paths };
  }
}

async function waitForStatus(baseUrl, id, status) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${id}`);
    const body = await response.json();
    if (body.status === status) return body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`El job no alcanzó el estado ${status}.`);
}

test("API HTTP local: health, CORS, jobs, PDF y cancelación con motor falso", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mediweb-http-test-"));
  const engine = new FakeEngine(directory);
  const jobManager = new JobManager({ engine });
  const server = createServer(createApp({
    engine,
    jobManager,
    version: "0.1.0-test",
    allowedOrigins: new Set(["http://localhost:5173"]),
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true, service: "mediweb-downloader", version: "0.1.0-test", browserOpen: false, activeJob: false,
    });

    const opened = await fetch(`${baseUrl}/mediweb/open`, { method: "POST" });
    assert.deepEqual(await opened.json(), { ok: true, browserOpen: true });
    const detected = await fetch(`${baseUrl}/mediweb/detect`, { method: "POST" }).then((response) => response.json());
    assert.deepEqual(detected, {
      ok: true, page: 1, detected: 10, eligible: 7,
      excluded: { observado: 1, pendiente: 1, noApto: 1, otros: 0 },
    });
    assert.equal("paciente" in detected, false);

    const allowed = await fetch(`${baseUrl}/health`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const rejected = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, "ORIGIN_NOT_ALLOWED");
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${baseUrl}/jobs`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

    const invalid = await fetch(`${baseUrl}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "invalid" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_MODE");

    const created = await fetch(`${baseUrl}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "first" }),
    });
    assert.equal(created.status, 202);
    const { jobId } = await created.json();

    const conflict = await fetch(`${baseUrl}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "full" }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "JOB_ALREADY_RUNNING");

    const missingJob = await fetch(`${baseUrl}/jobs/not-a-job`);
    assert.equal(missingJob.status, 404);

    const earlyPdf = await fetch(`${baseUrl}/jobs/${jobId}/first-pages`);
    assert.equal(earlyPdf.status, 409);

    const cancelled = await fetch(`${baseUrl}/jobs/${jobId}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, "cancelled");
    assert.equal((await fetch(`${baseUrl}/jobs/${jobId}`).then((response) => response.json())).status, "cancelled");

    engine.hold = false;
    const fullCreated = await fetch(`${baseUrl}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "full" }),
    }).then((response) => response.json());
    await waitForStatus(baseUrl, fullCreated.jobId, "completed");
    const absentPdf = await fetch(`${baseUrl}/jobs/${fullCreated.jobId}/first-pages`);
    assert.equal(absentPdf.status, 404);
    assert.equal((await absentPdf.json()).code, "FIRST_PAGES_NOT_FOUND");

    const missingPdfJob = await fetch(`${baseUrl}/jobs/unknown/first-pages`);
    assert.equal(missingPdfJob.status, 404);

    const firstCreated = await fetch(`${baseUrl}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "first" }),
    }).then((response) => response.json());
    await waitForStatus(baseUrl, firstCreated.jobId, "completed");
    const pdf = await fetch(`${baseUrl}/jobs/${firstCreated.jobId}/first-pages`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(pdf.headers.get("cache-control"), "no-store");
    assert.match(Buffer.from(await pdf.arrayBuffer()).toString("utf8"), /^%PDF/);

    const sanitized = await fetch(`${baseUrl}/jobs/${firstCreated.jobId}/manifest`).then((response) => response.json());
    assert.equal(sanitized.totalProcesado, 7);
    assert.equal(sanitized.motivoFinalizacion, "ultima_pagina");
    assert.equal("atenciones" in sanitized, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
