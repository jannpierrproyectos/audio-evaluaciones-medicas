import semver from "semver";

export const CONNECTOR_RELEASE_MANIFEST_URL = String(
  import.meta.env?.VITE_CONNECTOR_RELEASE_MANIFEST_URL || "/connector-release.json",
);
export const CONNECTOR_RELEASE_REPOSITORY = String(
  import.meta.env?.VITE_CONNECTOR_RELEASE_REPOSITORY || "jannpierrproyectos/audio-evaluaciones-medicas",
);

export function classifyConnectorCompatibility(installedVersion, manifest) {
  if (!semver.valid(installedVersion) || !manifest) return "unknown";
  if (semver.lt(installedVersion, manifest.minimumSupportedVersion)) return "update_required";
  if (semver.lt(installedVersion, manifest.latestVersion)) return "update_available";
  return "up_to_date";
}

export function validateConnectorReleaseManifest(value) {
  const latest = value?.latestVersion;
  const minimum = value?.minimumSupportedVersion;
  const windows = value?.windows;
  if (value?.product !== "AudioEvaluaciones Connector" || !semver.valid(latest) || !semver.valid(minimum) || semver.gt(minimum, latest)) throw new Error("Manifest inválido");
  if (windows?.architecture !== "x64" || windows.fileName !== `AudioEvaluacionesConnector-${latest}-Setup.exe` || !/^[a-fA-F0-9]{64}$/.test(windows.sha256 ?? "")) throw new Error("Manifest inválido");
  const download = new URL(windows.downloadUrl);
  if (download.protocol !== "https:" || download.hostname !== "github.com" || download.pathname !== `/${CONNECTOR_RELEASE_REPOSITORY}/releases/download/v${latest}/${windows.fileName}`) throw new Error("Manifest inválido");
  return value;
}

export function getLegacyConnectorDownloadUrl(manifest) {
  return validateConnectorReleaseManifest(manifest).windows.downloadUrl;
}

export async function getConnectorReleaseManifest({ signal, url = CONNECTOR_RELEASE_MANIFEST_URL } = {}) {
  const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-cache", signal });
  if (!response.ok) throw new Error("Manifest no disponible");
  return validateConnectorReleaseManifest(await response.json());
}
