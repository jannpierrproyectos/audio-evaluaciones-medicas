import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const targetKind = process.argv[2];
if (!new Set(["host", "setup"]).has(targetKind)) throw new Error("Uso: node scripts/sign-windows.js host|setup");
const target = targetKind === "host"
  ? path.join(projectRoot, "build-windows", "staging", "AudioEvaluacionesConnector.exe")
  : path.join(projectRoot, "dist-windows", `AudioEvaluacionesConnector-${packageJson.version}-Setup.exe`);
await access(target);

const certificate = process.env.WINDOWS_SIGN_CERT_PATH;
const password = process.env.WINDOWS_SIGN_CERT_PASSWORD;
if (!certificate || !password) {
  console.warn(`Advertencia: ${path.basename(target)} generado sin firma digital.`);
  process.exit(0);
}
await access(certificate).catch(() => { throw new Error("WINDOWS_SIGN_CERT_PATH no apunta a un archivo accesible."); });
const signTool = await findSignTool();
if (!signTool) throw new Error("Hay certificado configurado, pero no se encontró signtool.exe del Windows SDK.");
const timestampUrl = process.env.WINDOWS_SIGN_TIMESTAMP_URL || "https://timestamp.digicert.com";
if (new URL(timestampUrl).protocol !== "https:") throw new Error("WINDOWS_SIGN_TIMESTAMP_URL debe usar HTTPS.");
const result = spawnSync(signTool, ["sign", "/fd", "SHA256", "/f", certificate, "/p", password, "/tr", timestampUrl, "/td", "SHA256", target], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Firma Authenticode aplicada: ${target}`);

async function findSignTool() {
  if (process.env.SIGNTOOL_PATH) {
    try { await access(process.env.SIGNTOOL_PATH); return process.env.SIGNTOOL_PATH; } catch { /* continuar */ }
  }
  const kitsRoot = process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin");
  if (!kitsRoot) return null;
  let versions;
  try { versions = await readdir(kitsRoot, { withFileTypes: true }); } catch { return null; }
  for (const entry of versions.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const candidate = path.join(kitsRoot, entry.name, "x64", "signtool.exe");
    try { await access(candidate); return candidate; } catch { /* probar siguiente */ }
  }
  return null;
}
