import { HttpError } from "./jobManager.js";
import { createRoutes, json } from "./routes.js";

import { DEFAULT_CONFIG } from "../config.js";
import { stateRoute } from "./stateRoutes.js";
import { ProcessingFlow } from "../processingFlow.js";
import { readJson } from "./routes.js";
import { DeliveryService } from "../deliveryService.js";

export const DEFAULT_ALLOWED_ORIGINS = [...DEFAULT_CONFIG.allowedOrigins];
const ALLOWED_PREFLIGHT_METHODS = new Set(["GET", "POST"]);
const ALLOWED_PREFLIGHT_HEADERS = new Set(["content-type", "x-audio-filename"]);

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

export function createApp({ engine, jobManager, managedFiles = null, updateService = null, getEvaluationStore = null, processingService = null, findDownloadedImport = null, version, allowedOrigins = parseAllowedOrigins(process.env.MEDIWEB_ALLOWED_ORIGINS) }) {
  const route = createRoutes({ engine, jobManager, managedFiles, updateService, version });
  const normalizedAllowedOrigins = new Set([...allowedOrigins].map(normalizeOrigin));
  const processing = processingService || (getEvaluationStore ? new ProcessingFlow({ engine, jobManager, getStore: getEvaluationStore }) : null);
  const deliveries = getEvaluationStore && managedFiles ? new DeliveryService({ getStore: getEvaluationStore, managedFiles }) : null;
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
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Audio-Filename");
        response.setHeader("Access-Control-Max-Age", "600");
        if (request.headers["access-control-request-private-network"] === "true") {
          response.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/downloads/metadata") {
        if (!origin) throw new HttpError(403, "ORIGIN_REQUIRED", "Origin obligatorio.");
        if (request.method !== "POST" || !findDownloadedImport) throw new HttpError(400, "INVALID_REQUEST", "Importación no disponible.");
        const body = await readJson(request);
        if (!body || Object.keys(body).length !== 1 || !/^[a-f0-9]{64}$/.test(body.sha256 || "")) throw new HttpError(400, "INVALID_REQUEST", "Referencia no válida.");
        return json(response, 200, await findDownloadedImport(body.sha256));
      }
      if (url.pathname === "/deliveries") {
        if (!origin) throw new HttpError(403, "ORIGIN_REQUIRED", "Origin obligatorio.");
        if (!deliveries || request.method !== "POST") throw new HttpError(400, "DELIVERY_UNAVAILABLE", "Actualiza el Connector para preparar entregas protegidas.");
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_REQUEST", "Solicitud no válida.");
        const allowed = { list: [], detail: ["evaluationId"], prepare: ["evaluationId", "expectedBinding", "configuration"],
          begin: ["id", "kind", "configuration"], settle: ["id", "intent", "success", "configuration"], reveal: ["id", "kind", "configuration"],
          confirm: ["id", "part", "confirmed", "configuration"], complete: ["id", "confirmed", "allParts", "configuration"], uncertain: ["id", "confirmed", "configuration"], cancel: ["evaluationId"],
          reopen: ["id", "reason", "confirmed"], reconcile: ["id", "outcomes", "reason", "confirmed", "configuration"] };
        if (!Array.isArray(allowed[body.action]) || Object.keys(body).some(key => key !== "action" && !allowed[body.action].includes(key))) throw new HttpError(400, "INVALID_REQUEST", "Acción o campos no permitidos.");
        try {
          return json(response, 200, body.action === "detail" ? await deliveries.detail(body.evaluationId) : await deliveries[body.action](body));
        } catch (error) { throw new HttpError(error.status || 503, /^[A-Z_]+$/.test(error.code || "") ? error.code : "DELIVERY_UNAVAILABLE", error.code?.startsWith("DELIVERY_") || error.name === "ManagedFileError" ? error.message : "No se pudo completar la entrega. Comprueba el almacenamiento y los archivos protegidos."); }
      }
      if (url.pathname === "/processing") {
        if (!origin) throw new HttpError(403, "ORIGIN_REQUIRED", "Origin obligatorio.");
        if (!processing || request.method !== "POST") throw new HttpError(400, "INVALID_REQUEST", "Solicitud no válida.");
        const body = await readJson(request);
        const allowed = { status: [], confirm: [], start: ["profileId", "manualConfirmed", "manualToken"], profile: ["name", "confirmed", "manualToken"], complete: ["id", "batchId"], cancel: ["id"] };
        if (!Array.isArray(allowed[body.action]) || Object.keys(body).some(key => key !== "action" && !allowed[body.action].includes(key))) throw new HttpError(400, "INVALID_REQUEST", "Solicitud no válida.");
        try {
          let result;
          if (body.action === "status") result = await processing.status();
          if (body.action === "confirm") result = await processing.confirmSearch();
          if (body.action === "start") {
            if (body.manualConfirmed !== undefined && typeof body.manualConfirmed !== "boolean") throw new HttpError(400, "INVALID_REQUEST", "Confirmación no válida.");
            result = await processing.start(body);
          }
          if (body.action === "profile") {
            if (body.confirmed !== true) throw new HttpError(400, "CONFIRMATION_REQUIRED", "Confirma la búsqueda antes de guardarla.");
            result = await processing.saveProfile(body.name, body.manualToken);
          }
          if (body.action === "cancel") result = await jobManager.cancel(body.id);
          if (body.action === "complete") result = await processing.complete(body.id, body.batchId);
          return json(response, 200, result);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(error.status || 503, /^[A-Z_]+$/.test(error.code || "") ? error.code : "PROCESS_UNAVAILABLE", "Revisa la sesión, la búsqueda o el almacenamiento del Connector. Los resultados guardados se conservan.");
        }
      }
      if (url.pathname === "/state") {
        if (!getEvaluationStore) throw new HttpError(503, "STORE_UNAVAILABLE", "Actualiza el Connector para conservar lotes.");
        await stateRoute(request, response, getEvaluationStore);
        return;
      }
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
  if (requestedHeaders.some((header) => !ALLOWED_PREFLIGHT_HEADERS.has(header))) {
    throw new HttpError(403, "HEADERS_NOT_ALLOWED", "Headers no permitidos para preflight.");
  }
}
