import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const distDirectory = path.join(projectRoot, "dist-windows");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
const releaseConfig = JSON.parse(await readFile(path.join(projectRoot, "release", "release-config.json"), "utf8"));
const version = packageJson.version;
if (!semver.valid(version)) throw new Error(`package.json contiene una versión SemVer inválida: ${version}`);
if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) throw new Error("package-lock.json no coincide con la versión de package.json.");

const minimumSupportedVersion = process.env.CONNECTOR_MINIMUM_SUPPORTED_VERSION || releaseConfig.minimumSupportedVersion;
if (!semver.valid(minimumSupportedVersion) || semver.gt(minimumSupportedVersion, version)) {
  throw new Error(`Versión mínima incompatible con ${version}: ${minimumSupportedVersion}`);
}

const fileName = `AudioEvaluacionesConnector-${version}-Setup.exe`;
const setupPath = path.join(distDirectory, fileName);
await access(setupPath).catch(() => { throw new Error(`No existe el Setup esperado: ${setupPath}`); });
const matchingSetups = (await readdir(distDirectory)).filter((name) => name.startsWith(`AudioEvaluacionesConnector-${version}-`) && name.endsWith(".exe"));
if (matchingSetups.length !== 1 || matchingSetups[0] !== fileName) throw new Error(`El nombre del Setup no coincide exactamente con package.json: ${matchingSetups.join(", ")}`);

const sha256 = createHash("sha256").update(await readFile(setupPath)).digest("hex");
const releaseNotes = (await readFile(path.join(projectRoot, "release", "RELEASE_NOTES.template.md"), "utf8"))
  .replaceAll("{{VERSION}}", version)
  .replaceAll("{{SHA256}}", sha256);
const repository = releaseConfig.repository;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("release-config.json contiene un repositorio inválido.");
const tag = `v${version}`;
const downloadUrl = `https://github.com/${repository}/releases/download/${tag}/${fileName}`;
const releaseNotesUrl = `https://github.com/${repository}/releases/tag/${tag}`;
const publishedAt = process.env.RELEASE_PUBLISHED_AT || new Date().toISOString();
if (new URL(downloadUrl).protocol !== "https:" || !downloadUrl.includes(`/releases/download/${tag}/`)) throw new Error("La URL versionada del asset no es válida.");

const manifest = {
  product: "AudioEvaluaciones Connector",
  latestVersion: version,
  minimumSupportedVersion,
  publishedAt,
  windows: { architecture: "x64", fileName, downloadUrl, sha256 },
  releaseNotesUrl,
};

await mkdir(distDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(distDirectory, "SHA256SUMS.txt"), `${sha256}  ${fileName}\n`, "utf8"),
  writeFile(path.join(distDirectory, "connector-release.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(path.join(repositoryRoot, "public", "connector-release.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(path.join(distDirectory, `RELEASE_NOTES-${version}.md`), releaseNotes, "utf8"),
]);

const generated = JSON.parse(await readFile(path.join(distDirectory, "connector-release.json"), "utf8"));
if (generated.latestVersion !== version || generated.windows.fileName !== fileName || generated.windows.sha256 !== sha256) {
  throw new Error("El manifest generado no coincide con package.json, Setup y SHA-256.");
}
console.log(`Release ${tag} preparado sin publicar.`);
console.log(`Setup: ${setupPath}`);
console.log(`SHA-256: ${sha256}`);
console.log(`Manifest público: ${path.join(repositoryRoot, "public", "connector-release.json")}`);
