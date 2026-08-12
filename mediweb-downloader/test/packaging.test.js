import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateStaging } from "../scripts/packaging.js";

test("validador exige runtime/app/config y rechaza datos sensibles o tests", async () => {
  const staging = await mkdtemp(path.join(os.tmpdir(), "connector-staging-"));
  try {
    const requiredFiles = [
      "AudioEvaluacionesConnector.exe",
      "assets/AudioEvaluacionesConnector.ico",
      "app/package.json",
      "app/src/trayService.js",
      "app/src/service.js",
      "app/node_modules/playwright-core/package.json",
      "config/default-config.json",
      "licenses/PACKAGING-NOTICES.txt",
    ];
    for (const relative of requiredFiles) {
      const absolute = path.join(staging, ...relative.split("/"));
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, "{}");
    }
    const runtime = path.join(staging, "runtime", "node.exe");
    await mkdir(path.dirname(runtime), { recursive: true });
    const handle = await open(runtime, "w");
    await handle.truncate(1_000_001);
    await handle.close();
    assert.equal(await validateStaging(staging), true);

    await mkdir(path.join(staging, "app", "test"));
    await assert.rejects(validateStaging(staging), /rutas prohibidas/);
    await rm(path.join(staging, "app", "test"), { recursive: true });
    await writeFile(path.join(staging, ".env.local"), "SECRET=fake");
    await assert.rejects(validateStaging(staging), /rutas prohibidas/);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});
