import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  UpdateError,
  UpdateService,
  classifyConnectorVersion,
  fetchWithValidatedRedirects,
  validateReleaseManifest,
} from "../src/updateService.js";

const allowedHosts = ["github.com", "objects.githubusercontent.com", "githubusercontent.com"];

function manifest({ latest = "0.3.0", minimum = "0.2.0", sha256 = "a".repeat(64), downloadUrl } = {}) {
  return {
    product: "AudioEvaluaciones Connector",
    latestVersion: latest,
    minimumSupportedVersion: minimum,
    publishedAt: "2026-08-12T00:00:00Z",
    windows: {
      architecture: "x64",
      fileName: `AudioEvaluacionesConnector-${latest}-Setup.exe`,
      downloadUrl: downloadUrl || `https://github.com/jannpierrproyectos/audio-evaluaciones-medicas/releases/download/v${latest}/AudioEvaluacionesConnector-${latest}-Setup.exe`,
      sha256,
    },
    releaseNotesUrl: `https://github.com/jannpierrproyectos/audio-evaluaciones-medicas/releases/tag/v${latest}`,
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

async function withService(options, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-updates-"));
  const service = new UpdateService({
    installedVersion: "0.2.0",
    manifestUrl: "https://audio-evaluaciones-medicas.vercel.app/connector-release.json",
    allowedHosts,
    updatesDir: directory,
    logger: { log() {}, warn() {} },
    ...options,
  });
  try { return await operation(service, directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("clasifica SemVer sin comparar texto", () => {
  assert.equal(classifyConnectorVersion("0.10.0", manifest({ latest: "0.9.9" })), "up_to_date");
  assert.equal(classifyConnectorVersion("0.2.0", manifest()), "update_available");
  assert.equal(classifyConnectorVersion("0.1.9", manifest()), "update_required");
  assert.equal(classifyConnectorVersion("invalid", manifest()), "unknown");
});

test("valida formato, versión, HTTPS y allowlist del manifest", () => {
  assert.equal(validateReleaseManifest(manifest(), { allowedHosts }).latestVersion, "0.3.0");
  assert.throws(() => validateReleaseManifest(manifest({ downloadUrl: "http://github.com/update.exe" }), { allowedHosts }), /origen/);
  assert.throws(() => validateReleaseManifest(manifest({ downloadUrl: "https://evil.example/update.exe" }), { allowedHosts }), /origen/);
  assert.throws(() => validateReleaseManifest(manifest({ downloadUrl: "https://github.com/otro/repo/releases/download/v0.3.0/AudioEvaluacionesConnector-0.3.0-Setup.exe" }), { allowedHosts }), /repositorio/);
  assert.throws(() => validateReleaseManifest({ ...manifest(), latestVersion: "not-semver" }, { allowedHosts }), /manifiesto/);
  assert.throws(() => validateReleaseManifest(manifest({ latest: "0.2.0", minimum: "0.3.0" }), { allowedHosts }), /manifiesto/);
});

test("check cubre no update, update disponible y update obligatorio", async () => {
  for (const [installedVersion, expected] of [["0.3.0", "up_to_date"], ["0.2.0", "update_available"], ["0.1.0", "update_required"]]) {
    await withService({ installedVersion, fetchImpl: async () => jsonResponse(manifest()) }, async (service) => {
      assert.equal((await service.check()).compatibility, expected);
    });
  }
});

test("manifest no disponible o inválido falla sin borrar el último manifest válido", async () => {
  let fail = false;
  await withService({ cacheMs: 0, fetchImpl: async () => fail ? new Response("caído", { status: 503 }) : jsonResponse(manifest()) }, async (service) => {
    await service.check();
    fail = true;
    await assert.rejects(service.check({ force: true }), (error) => error.code === "UPDATE_MANIFEST_UNAVAILABLE");
    assert.equal(service.publicStatus().compatibility, "update_available");
  });
  await withService({ fetchImpl: async () => jsonResponse({ nope: true }) }, async (service) => {
    await assert.rejects(service.check(), (error) => error.code === "INVALID_UPDATE_MANIFEST");
  });
});

test("download falla de forma controlada si un check fallido está cacheado", async () => {
  await withService({ fetchImpl: async () => new Response("caído", { status: 503 }) }, async (service) => {
    await assert.rejects(service.check(), (error) => error.code === "UPDATE_MANIFEST_UNAVAILABLE");
    await assert.rejects(service.downloadUpdate(), (error) => error.code === "UPDATE_MANIFEST_UNAVAILABLE");
  });
});

test("timeout de conexión cancela un check colgado", async () => {
  await withService({ connectTimeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true });
  }) }, async (service) => {
    await assert.rejects(service.check(), (error) => error.code === "UPDATE_TIMEOUT");
  });
});

test("redirect permitido llega al asset y redirect prohibido se rechaza", async () => {
  const seen = [];
  const allowed = await fetchWithValidatedRedirects("https://github.com/file.exe", {
    fetchImpl: async (url) => {
      seen.push(url);
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { Location: "https://objects.githubusercontent.com/file.exe" } })
        : new Response("ok");
    },
    timeoutMs: 100,
    validateUrl: (url) => allowedHosts.some((host) => new URL(url).hostname === host),
  });
  assert.equal(await allowed.text(), "ok");
  await assert.rejects(fetchWithValidatedRedirects("https://github.com/file.exe", {
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/file.exe" } }),
    timeoutMs: 100,
    validateUrl: (url) => allowedHosts.some((host) => new URL(url).hostname === host),
  }), (error) => error.code === "DOWNLOAD_ORIGIN_NOT_ALLOWED");
});

test("descarga, calcula SHA-256, verifica y prepara install", async () => {
  const bytes = Buffer.from("setup local simulado");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await withService({ fetchImpl: async () => new Response(bytes, { headers: { "Content-Length": String(bytes.length) } }) }, async (service, directory) => {
    service.manifest = validateReleaseManifest(manifest({ sha256 }), { allowedHosts });
    const result = await service.downloadUpdate();
    assert.equal(result.download.state, "verified");
    assert.equal(result.readyToInstall, true);
    await access(path.join(directory, "0.3.0", "AudioEvaluacionesConnector-0.3.0-Setup.exe"));
    let requested = null;
    service.events = new EventEmitter();
    service.events.once("update:install-requested", (details) => { requested = details; });
    assert.equal((await service.requestInstall()).accepted, true);
    assert.equal(requested.version, "0.3.0");
  });
});

test("SHA incorrecto descarta el instalador", async () => {
  await withService({ fetchImpl: async () => new Response("contenido alterado") }, async (service, directory) => {
    service.manifest = validateReleaseManifest(manifest(), { allowedHosts });
    await assert.rejects(service.downloadUpdate(), (error) => error.code === "UPDATE_SHA256_MISMATCH");
    assert.deepEqual(await readdir(path.join(directory, "0.3.0")), []);
  });
});

test("rechaza por Content-Length y por crecimiento real sobre el límite", async () => {
  await withService({ maxBytes: 5, fetchImpl: async () => new Response("123456", { headers: { "Content-Length": "6" } }) }, async (service) => {
    service.manifest = validateReleaseManifest(manifest(), { allowedHosts });
    await assert.rejects(service.downloadUpdate(), (error) => error.code === "UPDATE_TOO_LARGE");
  });
  await withService({ maxBytes: 5, fetchImpl: async () => new Response("123456") }, async (service) => {
    service.manifest = validateReleaseManifest(manifest(), { allowedHosts });
    await assert.rejects(service.downloadUpdate(), (error) => error.code === "UPDATE_TOO_LARGE");
  });
});

test("una descarga puede cancelarse sin dejar .partial", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("12")); } });
  await withService({ timeoutMs: 1000, fetchImpl: async () => new Response(body) }, async (service, directory) => {
    service.manifest = validateReleaseManifest(manifest(), { allowedHosts });
    const pending = service.downloadUpdate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.cancelDownload();
    await assert.rejects(pending, (error) => error.code === "UPDATE_CANCELLED");
    assert.deepEqual(await readdir(path.join(directory, "0.3.0")), []);
  });
});

test("job activo bloquea install y no se cancela automáticamente", async () => {
  await withService({ hasActiveJob: () => true }, async (service) => {
    service.pending = { version: "0.3.0", filePath: "unused" };
    await assert.rejects(service.requestInstall(), (error) => error.code === "UPDATE_JOB_ACTIVE");
  });
});

test("limpieza conserva pendiente y como máximo una versión anterior", async () => {
  await withService({}, async (service, directory) => {
    for (const version of ["0.1.0", "0.2.0", "0.3.0"]) { await mkdir(path.join(directory, version)); await writeFile(path.join(directory, version, "old.exe"), "x"); }
    service.pending = { version: "0.3.0", filePath: path.join(directory, "0.3.0", "old.exe") };
    await service.cleanupOldUpdates();
    assert.deepEqual((await readdir(directory)).sort(), ["0.2.0", "0.3.0"]);
  });
});
