import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildWindowsHost() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const outputDir = path.join(projectRoot, "build-windows", "native");
  const output = path.join(outputDir, "AudioEvaluacionesConnector.exe");
  const assemblyInfo = path.join(outputDir, "AssemblyInfo.cs");
  const csc = await findCompiler();
  if (!csc) throw new Error("No se encontró csc.exe de .NET Framework 4.x, requerido para compilar el host nativo Windows.");
  await mkdir(outputDir, { recursive: true });
  const fileVersion = packageJson.version.split(".").length === 3 ? `${packageJson.version}.0` : packageJson.version;
  await writeFile(assemblyInfo, [
    "using System.Reflection;",
    '[assembly: AssemblyTitle("AudioEvaluaciones Connector")]',
    '[assembly: AssemblyProduct("AudioEvaluaciones Connector")]',
    '[assembly: AssemblyCompany("AudioEvaluaciones")]',
    `[assembly: AssemblyVersion("${fileVersion}")]`,
    `[assembly: AssemblyFileVersion("${fileVersion}")]`,
    `[assembly: AssemblyInformationalVersion("${packageJson.version}")]`,
    "",
  ].join("\n"));

  const args = [
    "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/utf8output",
    `/out:${output}`,
    `/win32icon:${path.join(projectRoot, "assets", "AudioEvaluacionesConnector.ico")}`,
    "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
    path.join(projectRoot, "windows-host", "AudioEvaluacionesConnector.cs"), assemblyInfo,
  ];
  const result = spawnSync(csc, args, { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Falló la compilación del host nativo.\n${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  await access(output);
  console.log(`Host nativo sin consola generado: ${output}`);
  return output;
}

async function findCompiler() {
  const windows = process.env.WINDIR || "C:\\Windows";
  const candidates = [
    path.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* probar siguiente */ }
  }
  return null;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await buildWindowsHost();
