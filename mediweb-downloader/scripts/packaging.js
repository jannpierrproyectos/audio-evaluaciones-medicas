import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

const FORBIDDEN_DIRECTORIES = new Set([".auth", "downloads", "logs", "tmp", "test", "tests", "coverage", ".git"]);
const FORBIDDEN_FILES = new Set([".env", ".env.local", "manifest.json", "resultados.csv"]);

export async function validateStaging(stagingRoot) {
  const required = [
    "AudioEvaluacionesConnector.exe",
    "assets/AudioEvaluacionesConnector.ico",
    "runtime/node.exe",
    "app/package.json",
    "app/src/trayService.js",
    "app/src/service.js",
    "app/src/phoneExtractor.js",
    "app/node_modules/playwright-core/package.json",
    "app/node_modules/pdfjs-dist/package.json",
    "config/default-config.json",
    "licenses/PACKAGING-NOTICES.txt",
  ];
  for (const relative of required) await access(path.join(stagingRoot, ...relative.split("/")));

  const violations = [];
  await walk(stagingRoot, async (absolute, entry) => {
    const lowerName = entry.name.toLowerCase();
    if (entry.isDirectory() && FORBIDDEN_DIRECTORIES.has(lowerName)) violations.push(absolute);
    if (entry.isFile() && (FORBIDDEN_FILES.has(lowerName) || lowerName.startsWith(".env."))) violations.push(absolute);
    if (entry.isFile() && [".pdf", ".csv"].includes(path.extname(lowerName))) violations.push(absolute);
  });
  if (violations.length > 0) throw new Error(`El staging contiene rutas prohibidas:\n${violations.join("\n")}`);

  const runtime = await stat(path.join(stagingRoot, "runtime", "node.exe"));
  if (runtime.size < 1_000_000) throw new Error("runtime/node.exe no parece ser un runtime Node válido.");
  return true;
}

export async function directorySize(directory) {
  let total = 0;
  await walk(directory, async (absolute, entry) => {
    if (entry.isFile()) total += (await stat(absolute)).size;
  });
  return total;
}

export function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function walk(directory, visitor) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    await visitor(absolute, entry);
    if (entry.isDirectory()) await walk(absolute, visitor);
  }
}
