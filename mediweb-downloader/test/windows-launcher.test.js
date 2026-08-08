import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWindowsLauncher } from "../src/windowsLauncher.js";

test("un segundo lanzamiento detecta /health y no inicia otro servidor", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-launcher-"));
  const messages = [];
  let starts = 0;
  try {
    const result = await runWindowsLauncher({
      env: { LOCALAPPDATA: path.join(directory, "local"), USERPROFILE: path.join(directory, "user") },
      logger: { log: (message) => messages.push(message) },
      probe: async () => true,
      startService: async () => { starts += 1; },
    });
    assert.equal(result.alreadyRunning, true);
    assert.equal(starts, 0);
    assert.ok(messages.some((message) => message.includes("ya está activo")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
