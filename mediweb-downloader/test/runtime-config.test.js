import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, loadConnectorConfig } from "../src/config.js";
import { createOutputPaths, getRuntimePaths } from "../src/paths.js";
import { parseAllowedOrigins } from "../src/http/app.js";

test("default config versionada coincide con defaults y autoriza solo los tres origins exactos", async () => {
  const versioned = JSON.parse(await readFile(new URL("../config/default-config.json", import.meta.url), "utf8"));
  assert.deepEqual(versioned, DEFAULT_CONFIG);
  const origins = parseAllowedOrigins();
  assert.deepEqual([...origins], DEFAULT_CONFIG.allowedOrigins);
  assert.equal(origins.has("https://preview.vercel.app"), false);
});

test("resuelve rutas de desarrollo dentro del proyecto sin depender de cwd", () => {
  const paths = getRuntimePaths({ moduleRoot: "C:\\repo\\mediweb-downloader", packaged: false });
  assert.equal(paths.authDir, "C:\\repo\\mediweb-downloader\\.auth\\mediweb-profile");
  assert.equal(paths.downloadsDir, "C:\\repo\\mediweb-downloader\\downloads");
  assert.equal(paths.packaged, false);
});

test("resuelve auth/config/tmp/logs en LocalAppData y descargas en Documents para packaged", () => {
  const paths = getRuntimePaths({
    moduleRoot: "C:\\Program Files\\AudioEvaluaciones Connector\\app",
    packaged: true,
    env: { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: "C:\\Users\\Ana" },
  });
  assert.equal(paths.authDir, "C:\\Users\\Ana\\AppData\\Local\\AudioEvaluacionesConnector\\auth");
  assert.equal(paths.configPath, "C:\\Users\\Ana\\AppData\\Local\\AudioEvaluacionesConnector\\config.json");
  assert.equal(paths.tmpDir, "C:\\Users\\Ana\\AppData\\Local\\AudioEvaluacionesConnector\\tmp");
  assert.equal(paths.logsDir, "C:\\Users\\Ana\\AppData\\Local\\AudioEvaluacionesConnector\\logs");
  assert.equal(paths.downloadsDir, "C:\\Users\\Ana\\Documents\\AudioEvaluaciones\\Descargas");
});

test("crea config inicial segura y respeta precedencia env > config > defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-config-"));
  const runtimePaths = {
    packaged: true,
    authDir: path.join(directory, "auth"),
    downloadsDir: path.join(directory, "documents"),
    tmpDir: path.join(directory, "tmp"),
    logsDir: path.join(directory, "logs"),
    configDir: directory,
    configPath: path.join(directory, "config.json"),
  };
  try {
    const initial = await loadConnectorConfig({ runtimePaths, env: {}, createIfMissing: true });
    assert.equal(initial.port, DEFAULT_CONFIG.port);
    assert.deepEqual(initial.allowedOrigins.split(","), DEFAULT_CONFIG.allowedOrigins);
    assert.deepEqual(JSON.parse(await readFile(runtimePaths.configPath, "utf8")), DEFAULT_CONFIG);

    await writeFile(runtimePaths.configPath, JSON.stringify({ port: 9001, allowedOrigins: ["https://configured.example"] }));
    const configured = await loadConnectorConfig({ runtimePaths, env: {} });
    assert.deepEqual(configured, { port: 9001, allowedOrigins: "https://configured.example" });

    const overridden = await loadConnectorConfig({
      runtimePaths,
      env: { MEDIWEB_SERVICE_PORT: "9002", MEDIWEB_ALLOWED_ORIGINS: "https://env.example" },
    });
    assert.deepEqual(overridden, { port: 9002, allowedOrigins: "https://env.example" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("salidas packaged separan reportes de temporales", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-paths-"));
  const runtimePaths = {
    packaged: true,
    downloadsDir: path.join(directory, "Documents", "AudioEvaluaciones", "Descargas"),
    tmpDir: path.join(directory, "LocalAppData", "tmp"),
  };
  try {
    const output = await createOutputPaths(directory, null, "both", runtimePaths);
    assert.ok(output.root.startsWith(runtimePaths.downloadsDir));
    assert.ok(output.tmp.startsWith(runtimePaths.tmpDir));
    assert.equal(output.tmp.startsWith(output.root), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
