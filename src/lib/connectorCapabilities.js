import semver from "semver";
import {
  checkConnectorUpdate,
  downloadConnectorUpdate,
  getConnectorUpdateStatus,
  installConnectorUpdate,
} from "../services/mediwebService.js";
import { getLegacyConnectorDownloadUrl } from "./connectorRelease.js";

export const LOCAL_UPDATER_MIN_VERSION = "0.3.0";

export function supportsLocalUpdater(version) {
  return Boolean(semver.valid(version)) && semver.gte(version, LOCAL_UPDATER_MIN_VERSION);
}

export function getConnectorUpdateMode({ installedVersion, compatibility }) {
  if (!installedVersion) return "none";
  if (compatibility === "up_to_date") return "up_to_date";
  if (!["update_available", "update_required"].includes(compatibility)) return "unknown";
  const required = compatibility === "update_required";
  if (!supportsLocalUpdater(installedVersion)) return required ? "required_legacy" : "legacy_manual";
  return required ? "required_local" : "local_secure";
}

export function classifyLocalUpdaterError(error) {
  if (error?.status === 404) return "updater_unavailable";
  if (error?.code === "CONNECTOR_TIMEOUT") return "timeout";
  if (error?.status === 403 || error?.code === "ORIGIN_NOT_ALLOWED") return "origin_rejected";
  if (error?.code === "NETWORK_ERROR") return "network_error";
  if (error?.status >= 500) return "connector_error";
  return "unknown_error";
}

export async function startConnectorUpdateFlow({ installedVersion, compatibility, manifest, signal, api = DEFAULT_UPDATE_API }) {
  const updateMode = getConnectorUpdateMode({ installedVersion, compatibility });
  if (["legacy_manual", "required_legacy"].includes(updateMode)) {
    return { mode: updateMode, downloadUrl: getLegacyConnectorDownloadUrl(manifest) };
  }
  if (!["local_secure", "required_local"].includes(updateMode)) return { mode: updateMode };

  try {
    await api.getStatus({ signal });
  } catch (error) {
    if (classifyLocalUpdaterError(error) === "updater_unavailable") {
      return {
        mode: compatibility === "update_required" ? "required_legacy" : "legacy_manual",
        reason: "updater_unavailable",
        downloadUrl: getLegacyConnectorDownloadUrl(manifest),
      };
    }
    throw error;
  }

  const status = await api.check({ signal });
  if (status.compatibility === "up_to_date") return { mode: "up_to_date", status };
  if (!["update_available", "update_required"].includes(status.compatibility)) return { mode: "unknown", status };
  await api.download({ signal });
  await api.install({ signal });
  return { mode: "local_install_requested", status };
}

const DEFAULT_UPDATE_API = Object.freeze({
  getStatus: getConnectorUpdateStatus,
  check: checkConnectorUpdate,
  download: downloadConnectorUpdate,
  install: installConnectorUpdate,
});
