import { HttpError } from "./jobManager.js";
import { createRoutes, json } from "./routes.js";

import { DEFAULT_CONFIG } from "../config.js";

export const DEFAULT_ALLOWED_ORIGINS = [...DEFAULT_CONFIG.allowedOrigins];
const ALLOWED_PREFLIGHT_METHODS = new Set(["GET", "POST"]);

export function parseAllowedOrigins(value) {
  const origins = value === undefined ? DEFAULT_ALLOWED_ORIGINS : value.split(",").map((item) => item.trim()).filter(Boolean);
  return new Set(origins.map(normalizeOrigin));
}

export function normalizeOrigin(value) {
  const origin = String(value ?? "").trim();
  try {
    const parsed = new URL(origin);
    const hasUnexpectedParts = parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== "/" && parsed.pathname !== "");
    if (hasUnexpectedParts || !["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.origin;
  } catch {
    throw new Error(`Origen permitido no válido: ${origin}`);
  }
}

export function createApp({ engine, jobManager, updateService = null, version, allowedOrigins = parseAllowedOrigins(process.env.MEDIWEB_ALLOWED_ORIGINS) }) {
  const route = createRoutes({ engine, jobManager, updateService, version });
  const normalizedAllowedOrigins = new Set([...allowedOrigins].map(normalizeOrigin));
  return async function app(request, response) {
    try {
      const origin = request.headers.origin;
      let normalizedOrigin = null;
      try {
        normalizedOrigin = origin ? normalizeOrigin(origin) : null;
      } catch {
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin no permitido.");
      }
      if (normalizedOrigin && !normalizedAllowedOrigins.has(normalizedOrigin)) {
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin no permitido.");
      }
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "OPTIONS") {
        if (!origin) throw new HttpError(400, "ORIGIN_REQUIRED", "Origin es obligatorio para preflight.");
        validatePreflight(request);
        response.setHeader("Access-Control-Allow-Methods", "GET, POST");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        response.setHeader("Access-Control-Max-Age", "600");
        if (request.headers["access-control-request-private-network"] === "true") {
          response.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      await route(request, response, url);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
      const message = error instanceof HttpError ? error.message : "Error interno del servicio local.";
      json(response, status, { ok: false, code, message });
    }
  };
}

function validatePreflight(request) {
  const requestedMethod = String(request.headers["access-control-request-method"] ?? "").toUpperCase();
  if (!ALLOWED_PREFLIGHT_METHODS.has(requestedMethod)) {
    throw new HttpError(403, "METHOD_NOT_ALLOWED", "Método no permitido para preflight.");
  }
  const requestedHeaders = String(request.headers["access-control-request-headers"] ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => header !== "content-type")) {
    throw new HttpError(403, "HEADERS_NOT_ALLOWED", "Headers no permitidos para preflight.");
  }
}
