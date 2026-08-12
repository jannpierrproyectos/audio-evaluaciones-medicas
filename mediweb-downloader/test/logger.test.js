import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileLogger, rotateLogs, sanitizeLogMessage } from "../src/logger.js";

test("logs rotan con límite y sanitizan URL/DNI sin fixtures clínicos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "connector-logs-"));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "connector.log"), "x".repeat(50));
    await rotateLogs(directory, { maxFiles: 3, maxBytes: 10 });
    assert.ok((await readdir(directory)).includes("connector.1.log"));
    const logger = await createFileLogger(directory, { maxFiles: 3, maxBytes: 1000 });
    await logger.log("Diagnóstico https://local.invalid/reporte?id=123 y 12345678");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const content = await readFile(path.join(directory, "connector.log"), "utf8");
    assert.doesNotMatch(content, /local\.invalid|12345678/);
    assert.match(sanitizeLogMessage("https://example.invalid 12345678"), /\[URL\].*\[IDENTIFICADOR\]/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
