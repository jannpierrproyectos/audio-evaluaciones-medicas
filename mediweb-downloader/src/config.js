import { readFile, writeFile } from "node:fs/promises";
import { ensureRuntimeDirectories } from "./paths.js";

export const DEFAULT_CONFIG = Object.freeze({
  port: 8765,
  allowedOrigins: Object.freeze([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://audio-evaluaciones-medicas.vercel.app",
  ]),
});

export async function loadConnectorConfig({ runtimePaths, env = process.env, createIfMissing = runtimePaths.packaged } = {}) {
  if (!runtimePaths) throw new Error("runtimePaths es obligatorio para cargar la configuración.");
  if (createIfMissing) await ensureRuntimeDirectories(runtimePaths);

  let localConfig = {};
  try {
    localConfig = JSON.parse(await readFile(runtimePaths.configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("config.json no contiene JSON válido.");
    if (createIfMissing) {
      await writeFile(runtimePaths.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
        .catch((writeError) => { if (writeError.code !== "EEXIST") throw writeError; });
    }
  }

  const portValue = env.MEDIWEB_SERVICE_PORT ?? localConfig.port ?? DEFAULT_CONFIG.port;
  const originsValue = env.MEDIWEB_ALLOWED_ORIGINS
    ?? (Array.isArray(localConfig.allowedOrigins) ? localConfig.allowedOrigins.join(",") : undefined)
    ?? DEFAULT_CONFIG.allowedOrigins.join(",");
  return {
    port: parsePort(portValue),
    allowedOrigins: originsValue,
  };
}

export function parsePort(value) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error("MEDIWEB_SERVICE_PORT debe ser un puerto válido.");
  const parsed = Number(text);
  if (parsed < 1 || parsed > 65535) throw new Error("MEDIWEB_SERVICE_PORT debe estar entre 1 y 65535.");
  return parsed;
}
