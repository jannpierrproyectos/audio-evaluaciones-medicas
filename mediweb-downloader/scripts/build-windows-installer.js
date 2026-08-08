import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const script = path.join(projectRoot, "installer", "AudioEvaluacionesConnector.iss");
const output = path.join(projectRoot, "dist-windows", `AudioEvaluacionesConnector-${packageJson.version}-Setup.exe`);
await access(path.join(projectRoot, "build-windows", "staging", "runtime", "node.exe"));
await mkdir(path.dirname(output), { recursive: true });

const iscc = await findIscc();
if (!iscc) {
  console.log("Inno Setup 6 no está instalado o ISCC.exe no fue encontrado.");
  console.log("Instálalo con: winget install JRSoftware.InnoSetup");
  console.log("Después ejecuta: npm run build:windows:installer");
  process.exit(0);
}

const result = spawnSync(iscc, [`/DAppVersion=${packageJson.version}`, script], { cwd: projectRoot, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
await access(output);
console.log(`Instalador generado: ${output}`);

async function findIscc() {
  const candidates = [
    process.env.ISCC_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Inno Setup 6", "ISCC.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* probar siguiente */ }
  }
  return null;
}
