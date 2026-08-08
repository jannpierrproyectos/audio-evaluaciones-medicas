import { HttpError } from "./jobManager.js";
import { createRoutes, json } from "./routes.js";

export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function parseAllowedOrigins(value) {
  const origins = value === undefined ? DEFAULT_ALLOWED_ORIGINS : value.split(",").map((item) => item.trim()).filter(Boolean);
  return new Set(origins.map((origin) => {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) throw new Error();
      return parsed.origin;
    } catch {
      throw new Error(`Origen permitido no válido: ${origin}`);
    }
  }));
}

export function createApp({ engine, jobManager, version, allowedOrigins = parseAllowedOrigins(process.env.MEDIWEB_ALLOWED_ORIGINS) }) {
  const route = createRoutes({ engine, jobManager, version });
  return async function app(request, response) {
    try {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Origin no permitido.");
      }
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        if (!origin) throw new HttpError(400, "ORIGIN_REQUIRED", "Origin es obligatorio para preflight.");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
