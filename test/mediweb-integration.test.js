import test from "node:test";
import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import {
  MediwebServiceError,
  cancelMediwebJob,
  checkMediwebHealth,
  checkConnectorUpdate,
  downloadConnectorUpdate,
  installConnectorUpdate,
  classifyConnectorError,
  createMediwebJob,
  detectMediwebEvaluations,
  diagnoseConnector,
  getConnectorDiagnosticMessage,
  getMediwebFirstPages,
  getMediwebJob,
  openMediweb,
} from "../src/services/mediwebService.js";
import { importMediwebPdfIntoExistingFlow } from "../src/lib/importMediwebPdf.js";
import {
  createNewImportSnapshot,
  createSingleFlight,
  deriveMediwebPhase,
  focusPdfResults,
  getMediwebCompletionSummary,
  getMediwebStartLabel,
} from "../src/lib/mediwebUiState.js";
import { classifyConnectorCompatibility, validateConnectorReleaseManifest } from "../src/lib/connectorRelease.js";

const originalFetch = globalThis.fetch;
const originalFile = globalThis.File;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withFetch(fakeFetch, callback) {
  globalThis.fetch = fakeFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("health distingue conector conectado y desconectado con timeout corto", async () => {
  await withFetch(async (url) => {
    assert.equal(url, "http://127.0.0.1:8765/health");
    return jsonResponse({ ok: true, service: "mediweb-downloader", browserOpen: false, activeJob: false });
  }, async () => {
    assert.equal((await checkMediwebHealth()).ok, true);
  });

  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")), { once: true });
  }), async () => {
    await assert.rejects(
      checkMediwebHealth({ timeoutMs: 5 }),
      (error) => error instanceof MediwebServiceError && error.code === "CONNECTOR_TIMEOUT",
    );
  });
});

test("diagnostica health de producción, timeout, rechazo de origen y fallo recuperable", async () => {
  let attempt = 0;
  await withFetch(async (_url, options) => {
    assert.equal(options.credentials, "omit");
    attempt += 1;
    if (attempt === 1) return jsonResponse({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origin no permitido." }, 403);
    return jsonResponse({ ok: true, service: "mediweb-downloader", browserOpen: false, activeJob: false });
  }, async () => {
    const rejected = await diagnoseConnector();
    assert.equal(rejected.status, "origin_rejected");
    assert.match(getConnectorDiagnosticMessage(rejected.status), /no tiene permiso/);

    const retried = await diagnoseConnector();
    assert.equal(retried.status, "connected");
    assert.equal(retried.health.ok, true);
  });

  const blocked = new MediwebServiceError("NETWORK_ERROR", "Bloqueado", {
    cause: new DOMException("Acceso local denegado", "NotAllowedError"),
  });
  assert.equal(classifyConnectorError(blocked), "network_blocked");
  assert.match(getConnectorDiagnosticMessage("network_blocked"), /permisos de acceso local/);
  assert.equal(classifyConnectorError(new MediwebServiceError("NETWORK_ERROR", "Sin conexión")), "unavailable");
  assert.match(getConnectorDiagnosticMessage("unavailable"), /no está disponible en esta computadora/);

  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")), { once: true });
  }), async () => {
    const timedOut = await diagnoseConnector({ timeoutMs: 5 });
    assert.equal(timedOut.status, "timeout");
    assert.match(getConnectorDiagnosticMessage(timedOut.status), /no respondió a tiempo/);
  });
});

test("detecta conteos agregados y traduce RESULTS_NOT_READY", async () => {
  let attempt = 0;
  await withFetch(async () => {
    attempt += 1;
    if (attempt === 1) {
      return jsonResponse({
        ok: true,
        page: 1,
        detected: 100,
        eligible: 84,
        excluded: { observado: 8, pendiente: 6, noApto: 2, otros: 0 },
      });
    }
    return jsonResponse({ ok: false, code: "RESULTS_NOT_READY", message: "Realiza la búsqueda." }, 409);
  }, async () => {
    const detection = await detectMediwebEvaluations();
    assert.equal(detection.detected, 100);
    assert.equal(detection.eligible, 84);
    assert.equal("paciente" in detection, false);
    await assert.rejects(
      detectMediwebEvaluations(),
      (error) => error.code === "RESULTS_NOT_READY" && error.status === 409,
    );
  });
});

test("abre o recupera MediWeb mediante el service layer", async () => {
  await withFetch(async (url, options) => {
    assert.equal(new URL(url).pathname, "/mediweb/open");
    assert.equal(options.method, "POST");
    return jsonResponse({ ok: true, browserOpen: true });
  }, async () => {
    assert.equal((await openMediweb()).browserOpen, true);
  });
});

test("inicia job, consulta progreso/completed/failed y solicita cancelación", async () => {
  const jobOptions = { mode: "first", limit: null, maxPages: null, perPageLimit: null, singlePage: false };
  let statusRead = 0;
  await withFetch(async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/jobs" && options.method === "POST") {
      assert.deepEqual(JSON.parse(options.body), jobOptions);
      return jsonResponse({ ok: true, jobId: "job-1" }, 202);
    }
    if (pathname === "/jobs/job-1/cancel") {
      assert.equal(options.method, "POST");
      return jsonResponse({ id: "job-1", status: "cancelled", mode: "first", processed: 4 });
    }
    if (pathname === "/jobs/job-1") {
      statusRead += 1;
      if (statusRead === 1) return jsonResponse({ id: "job-1", status: "running", mode: "first", currentPage: 2, detected: 200, eligible: 167, processed: 73, firstPagesAdded: 73, fullReportsGenerated: 0, errors: 0 });
      if (statusRead === 2) return jsonResponse({ id: "job-1", status: "completed", mode: "first", processed: 167, firstPagesAdded: 167, errors: 0 });
      return jsonResponse({ id: "job-1", status: "failed", mode: "first", processed: 80, errors: 1 });
    }
    throw new Error(`Solicitud inesperada: ${pathname}`);
  }, async () => {
    assert.equal((await createMediwebJob(jobOptions)).jobId, "job-1");
    const progress = await getMediwebJob("job-1");
    assert.equal(progress.status, "running");
    assert.equal(progress.processed, 73);
    assert.equal((await getMediwebJob("job-1")).status, "completed");
    assert.equal((await getMediwebJob("job-1")).status, "failed");
    assert.equal((await cancelMediwebJob("job-1")).status, "cancelled");
  });
});

test("obtiene first-pages como Blob/File y lo entrega al handler PDF existente", async () => {
  globalThis.File = globalThis.File || NodeFile;
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\n% prueba local");
  try {
    await withFetch(async () => new Response(pdfBytes, { status: 200, headers: { "Content-Type": "application/pdf" } }), async () => {
      const blob = await getMediwebFirstPages("job-pdf");
      assert.equal(blob.type, "application/pdf");

      let receivedFile = null;
      const existingPdfHandler = async (file) => {
        receivedFile = file;
      };
      const { file, processingResult } = await importMediwebPdfIntoExistingFlow("job-pdf", async (selectedFile) => {
        await existingPdfHandler(selectedFile);
        return { workers: [{ id: "local-test" }] };
      });
      assert.equal(receivedFile, file);
      assert.equal(processingResult.workers.length, 1);
      assert.equal(file.name, "primeras-hojas-mediweb.pdf");
      assert.equal(file.type, "application/pdf");
      assert.match(await file.text(), /^%PDF/);
    });
  } finally {
    globalThis.File = originalFile;
  }
});

test("preview y progreso del job permanecen separados", async () => {
  let read = 0;
  await withFetch(async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/mediweb/detect") {
      return jsonResponse({ ok: true, detected: 100, eligible: 63, excluded: { observado: 23, pendiente: 7, noApto: 1, otros: 6 } });
    }
    if (pathname === "/jobs/job-counter") {
      read += 1;
      return jsonResponse({ id: "job-counter", status: read === 1 ? "running" : "completed", mode: "first", currentPage: 1, detected: 100, eligible: 63, processed: 1, firstPagesAdded: 1, fullReportsGenerated: 0, errors: 0 });
    }
    throw new Error(`Solicitud inesperada: ${pathname}`);
  }, async () => {
    const preview = await detectMediwebEvaluations();
    const progress = await getMediwebJob("job-counter");
    const completed = await getMediwebJob("job-counter");
    assert.equal(preview.detected, 100);
    assert.equal(progress.detected, 100);
    assert.equal(completed.detected, 100);
    assert.notEqual(completed.detected, preview.detected + progress.detected);
    assert.equal(completed.eligible, 63);
    assert.equal(completed.processed, 1);
  });
});

test("la experiencia MediWeb deriva estados y acciones sin depender de estilos", () => {
  const base = { connectorStatus: "connected", browserOpen: false, detectionSummary: null, jobProgress: null };
  assert.equal(deriveMediwebPhase({ ...base, connectorStatus: "disconnected" }), "connector_unavailable");
  assert.equal(deriveMediwebPhase(base), "ready");
  assert.equal(deriveMediwebPhase({ ...base, browserOpen: true }), "mediweb_open");
  assert.equal(deriveMediwebPhase({ ...base, browserOpen: true, detectionSummary: { detected: 100 } }), "detected");
  assert.equal(deriveMediwebPhase({ ...base, jobProgress: { status: "running" } }), "processing");
  assert.equal(deriveMediwebPhase({ ...base, jobProgress: { status: "completed" } }), "completed");
  assert.equal(deriveMediwebPhase({ ...base, jobProgress: { status: "failed" } }), "failed");
  assert.equal(deriveMediwebPhase({ ...base, jobProgress: { status: "cancelled" } }), "cancelled");
  assert.equal(deriveMediwebPhase({ ...base, jobProgress: { status: "completed" }, importCompleted: true }), "imported");

  assert.equal(getMediwebStartLabel("first"), "Preparar evaluaciones");
  assert.equal(getMediwebStartLabel("full"), "Generar reportes completos");
  assert.equal(getMediwebStartLabel("both"), "Preparar y generar reportes");
});

test("completed first/full/both expone el resultado y acción correctos", () => {
  const first = getMediwebCompletionSummary({ mode: "first", firstPagesAdded: 1, fullReportsGenerated: 0 });
  const full = getMediwebCompletionSummary({ mode: "full", firstPagesAdded: 0, fullReportsGenerated: 3 });
  const both = getMediwebCompletionSummary({ mode: "both", firstPagesAdded: 2, fullReportsGenerated: 2 });
  assert.deepEqual(first, { title: "Evaluaciones listas", message: "Se preparó 1 evaluación para AudioEvaluaciones.", canImport: true });
  assert.equal(full.title, "Reportes completos generados");
  assert.equal(full.canImport, false);
  assert.equal(both.title, "Proceso completado");
  assert.equal(both.canImport, true);
});

test("Nueva importación conserva el navegador y limpia solo el estado MediWeb", () => {
  const reset = createNewImportSnapshot(true);
  assert.equal(reset.detectionSummary, null);
  assert.equal(reset.jobId, null);
  assert.equal(reset.jobProgress, null);
  assert.equal(reset.mode, "first");
  assert.match(reset.feedback, /sigue abierto/);
});

test("first-pages usa single-flight y evita el doble procesamiento", async () => {
  const guard = createSingleFlight();
  let calls = 0;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = guard.run(async () => {
    calls += 1;
    await held;
    return "done";
  });
  const second = guard.run(async () => {
    calls += 1;
    return "duplicate";
  });
  assert.equal(await second, null);
  release();
  assert.equal(await first, "done");
  assert.equal(calls, 1);
});

test("tras importar desplaza y enfoca el lote de trabajadores", () => {
  const calls = [];
  const target = {
    scrollIntoView(options) { calls.push(["scroll", options]); },
    focus(options) { calls.push(["focus", options]); },
  };
  focusPdfResults({
    documentRef: { getElementById: (id) => id === "pdf-workers-results" ? target : null },
    schedule: (callback) => callback(),
  });
  assert.deepEqual(calls, [
    ["scroll", { behavior: "smooth", block: "start" }],
    ["focus", { preventScroll: true }],
  ]);
});

test("la indisponibilidad del Connector no elimina la carga PDF manual", async () => {
  const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /setPdfSource\("manual"\)/);
  assert.match(appSource, /id="pdf-primary-input"[\s\S]*accept="\.pdf,application\/pdf"/);
  assert.match(appSource, /<MediwebImporter onPdfSelected=\{handlePdfSelected\}/);
});

test("frontend clasifica Connector actualizado, update opcional, obligatorio y manifest caído", () => {
  const release = {
    product: "AudioEvaluaciones Connector",
    latestVersion: "0.3.0",
    minimumSupportedVersion: "0.2.0",
    windows: {
      architecture: "x64",
      fileName: "AudioEvaluacionesConnector-0.3.0-Setup.exe",
      downloadUrl: "https://github.com/jannpierrproyectos/audio-evaluaciones-medicas/releases/download/v0.3.0/AudioEvaluacionesConnector-0.3.0-Setup.exe",
      sha256: "a".repeat(64),
    },
  };
  assert.equal(validateConnectorReleaseManifest(release), release);
  assert.equal(classifyConnectorCompatibility("0.3.0", release), "up_to_date");
  assert.equal(classifyConnectorCompatibility("0.2.0", release), "update_available");
  assert.equal(classifyConnectorCompatibility("0.1.0", release), "update_required");
  assert.equal(classifyConnectorCompatibility("0.3.0", null), "unknown");
  assert.throws(() => validateConnectorReleaseManifest({ ...release, windows: { ...release.windows, downloadUrl: "http://evil.example/setup.exe" } }));
});

test("frontend pide check, download e install al Connector sin enviar una URL", async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push({ path: new URL(url).pathname, method: options.method, body: options.body });
    return jsonResponse({ ok: true, compatibility: "update_available" }, options.method === "POST" ? 200 : 405);
  }, async () => {
    await checkConnectorUpdate();
    await downloadConnectorUpdate();
    await installConnectorUpdate();
  });
  assert.deepEqual(calls.map(({ path }) => path), ["/update/check", "/update/download", "/update/install"]);
  assert.ok(calls.every((call) => call.method === "POST" && call.body === undefined));
});

test("update obligatorio bloquea solo el panel MediWeb y conserva PDF manual y Sheets", async () => {
  const importer = await readFile(new URL("../src/components/MediwebImporter.jsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(importer, /connectorIncompatible[\s\S]*connector_incompatible/);
  assert.match(importer, /La carga manual de PDF y Sheets siguen disponibles/);
  assert.match(app, /setPdfSource\("manual"\)/);
  assert.match(app, /<SheetsWorkspace/);
});
