import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { directorySize, formatMegabytes, validateStaging } from "./packaging.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(projectRoot, "build-windows");
const stagingRoot = path.join(buildRoot, "staging");
const appRoot = path.join(stagingRoot, "app");

if (process.platform !== "win32") throw new Error("El staging Windows debe construirse desde Windows.");
if (process.arch !== "x64") throw new Error(`Este script genera actualmente el paquete x64; arquitectura detectada: ${process.arch}.`);

const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) throw new Error(`Node.js 20 o posterior es obligatorio; se detectó ${process.version}.`);

await rm(buildRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(path.join(stagingRoot, "runtime"), { recursive: true }),
  mkdir(appRoot, { recursive: true }),
  mkdir(path.join(stagingRoot, "config"), { recursive: true }),
  mkdir(path.join(stagingRoot, "licenses"), { recursive: true }),
]);

await Promise.all([
  cp(process.execPath, path.join(stagingRoot, "runtime", "node.exe")),
  cp(path.join(projectRoot, "src"), path.join(appRoot, "src"), { recursive: true }),
  cp(path.join(projectRoot, "package.json"), path.join(appRoot, "package.json")),
  cp(path.join(projectRoot, "package-lock.json"), path.join(appRoot, "package-lock.json")),
  cp(path.join(projectRoot, "config", "default-config.json"), path.join(stagingRoot, "config", "default-config.json")),
  cp(path.join(projectRoot, "licenses", "PACKAGING-NOTICES.txt"), path.join(stagingRoot, "licenses", "PACKAGING-NOTICES.txt")),
]);

const npmCommand = process.env.npm_execpath
  ? { command: process.execPath, args: [process.env.npm_execpath] }
  : { command: "npm.cmd", args: [] };
const install = spawnSync(npmCommand.command, [...npmCommand.args, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: appRoot,
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  encoding: "utf8",
});
if (install.status !== 0) {
  throw new Error(`npm ci --omit=dev falló al preparar staging.\n${install.error?.message ?? ""}\n${install.stdout ?? ""}\n${install.stderr ?? ""}`);
}

await pruneTestDirectories(path.join(appRoot, "node_modules"));
await copyDependencyLicenses(path.join(appRoot, "node_modules"), path.join(stagingRoot, "licenses", "npm"));
await validateStaging(stagingRoot);

const size = await directorySize(stagingRoot);
console.log(`Staging Windows ${packageJson.version} generado en ${stagingRoot}`);
console.log(`Runtime incluido: ${process.version} (${process.arch})`);
console.log(`Tamaño: ${formatMegabytes(size)}`);

async function pruneTestDirectories(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(directory, entry.name);
    if (["test", "tests"].includes(entry.name.toLowerCase())) await rm(absolute, { recursive: true, force: true });
    else await pruneTestDirectories(absolute);
  }
}

async function copyDependencyLicenses(nodeModules, destination) {
  await mkdir(destination, { recursive: true });
  const packages = await productionPackageDirectories(nodeModules);
  for (const packageDirectory of packages) {
    const metadata = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
    const safeName = metadata.name.replaceAll("/", "_").replaceAll("@", "");
    for (const candidate of ["LICENSE", "LICENSE.md", "NOTICE", "ThirdPartyNotices.txt"]) {
      try {
        await cp(path.join(packageDirectory, candidate), path.join(destination, `${safeName}-${candidate.replaceAll(".", "-")}.txt`));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
}

async function productionPackageDirectories(nodeModules) {
  const result = [];
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const absolute = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const child of await readdir(absolute, { withFileTypes: true })) if (child.isDirectory()) result.push(path.join(absolute, child.name));
    } else result.push(absolute);
  }
  return result;
}
