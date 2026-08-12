import path from "node:path";
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";

export const MAX_LOG_FILES = 5;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;

export async function createFileLogger(logsDir, { maxFiles = MAX_LOG_FILES, maxBytes = MAX_LOG_BYTES } = {}) {
  await mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, "connector.log");
  await rotateLogs(logsDir, { maxFiles, maxBytes });

  const write = async (level, message, error = null) => {
    const safeMessage = sanitizeLogMessage(message);
    const errorCode = error?.code ? ` code=${sanitizeLogMessage(error.code)}` : "";
    await appendFile(logPath, `${new Date().toISOString()} ${level} ${safeMessage}${errorCode}\n`, "utf8").catch(() => {});
    await rotateLogs(logsDir, { maxFiles, maxBytes }).catch(() => {});
  };
  return {
    log: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message, error) => write("ERROR", message, error),
  };
}

export function sanitizeLogMessage(value) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b\d{8}\b/g, "[IDENTIFICADOR]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

export async function rotateLogs(logsDir, { maxFiles = MAX_LOG_FILES, maxBytes = MAX_LOG_BYTES } = {}) {
  const current = path.join(logsDir, "connector.log");
  try {
    if ((await stat(current)).size >= maxBytes) {
      await rm(path.join(logsDir, `connector.${maxFiles - 1}.log`), { force: true });
      for (let index = maxFiles - 2; index >= 1; index -= 1) {
        const source = path.join(logsDir, `connector.${index}.log`);
        const destination = path.join(logsDir, `connector.${index + 1}.log`);
        await rename(source, destination).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
      await rename(current, path.join(logsDir, "connector.1.log"));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const files = (await readdir(logsDir)).filter((name) => /^connector(?:\.\d+)?\.log$/.test(name));
  const numbered = files.filter((name) => name !== "connector.log").sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  for (const name of numbered.slice(Math.max(0, maxFiles - 1))) await rm(path.join(logsDir, name), { force: true });
}
