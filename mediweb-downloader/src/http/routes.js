import { createReadStream } from "node:fs";
import { HttpError, validateJobOptions } from "./jobManager.js";
import { ResultsNotReadyError } from "../runner.js";
import { BrowserUnavailableError } from "../browser.js";
import { UpdateError } from "../updateService.js";

const JSON_LIMIT = 16 * 1024;

export function createRoutes({ engine, jobManager, updateService, version }) {
  return async function route(request, response, url) {
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "mediweb-downloader",
        version,
        browserOpen: engine.browserOpen,
        activeJob: jobManager.hasActiveJob,
      });
    }
    if (updateService && request.method === "GET" && url.pathname === "/update/status") {
      return json(response, 200, updateService.publicStatus());
    }
    if (updateService && request.method === "POST" && url.pathname === "/update/check") {
      return updateAction(response, () => updateService.check({ force: true }));
    }
    if (updateService && request.method === "POST" && url.pathname === "/update/download") {
      return updateAction(response, () => updateService.downloadUpdate());
    }
    if (updateService && request.method === "POST" && url.pathname === "/update/download/cancel") {
      return updateAction(response, async () => { updateService.cancelDownload(); return { ok: true, cancelled: true }; });
    }
    if (updateService && request.method === "POST" && url.pathname === "/update/install") {
      return updateAction(response, () => updateService.requestInstall(), 202);
    }
    if (request.method === "POST" && url.pathname === "/mediweb/open") {
      try {
        const result = await engine.open();
        return json(response, 200, { ok: true, browserOpen: result.browserOpen });
      } catch (error) {
        if (error instanceof BrowserUnavailableError || error?.code === "BROWSER_UNAVAILABLE") {
          throw new HttpError(503, "BROWSER_UNAVAILABLE", "No se encontró Microsoft Edge ni Google Chrome en esta computadora.");
        }
        throw error;
      }
    }
    if (request.method === "POST" && url.pathname === "/mediweb/detect") {
      try {
        const summary = await engine.detectSummary();
        return json(response, 200, { ok: true, ...summary });
      } catch (error) {
        if (error instanceof ResultsNotReadyError || error?.code === "RESULTS_NOT_READY") {
          throw new HttpError(409, "RESULTS_NOT_READY", "Realiza la búsqueda en MediWeb antes de continuar.");
        }
        throw error;
      }
    }
    if (request.method === "POST" && url.pathname === "/jobs") {
      const body = await readJson(request);
      const job = jobManager.create(validateJobOptions(body));
      return json(response, 202, { ok: true, jobId: job.id });
    }

    const match = url.pathname.match(/^\/jobs\/([^/]+)(?:\/(cancel|first-pages|manifest))?$/);
    if (match) {
      const [, id, action] = match;
      if (request.method === "GET" && !action) return json(response, 200, jobManager.publicJob(jobManager.get(id)));
      if (request.method === "POST" && action === "cancel") {
        const job = await jobManager.cancel(id);
        return json(response, 200, { ok: true, ...job });
      }
      if (request.method === "GET" && action === "manifest") return json(response, 200, jobManager.manifest(id));
      if (request.method === "GET" && action === "first-pages") {
        const file = await jobManager.firstPagesPath(id);
        response.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="primeras-hojas.pdf"',
          "Cache-Control": "no-store",
        });
        createReadStream(file).pipe(response);
        return;
      }
    }
    throw new HttpError(404, "NOT_FOUND", "Endpoint no encontrado.");
  };
}

async function updateAction(response, operation, status = 200) {
  try {
    return json(response, status, await operation());
  } catch (error) {
    if (error instanceof UpdateError) throw new HttpError(error.status, error.code, error.message);
    throw error;
  }
}

async function readJson(request) {
  const type = request.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(400, "INVALID_CONTENT_TYPE", "Content-Type debe ser application/json.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new HttpError(413, "REQUEST_TOO_LARGE", "El cuerpo excede el límite permitido.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "INVALID_JSON", "El cuerpo JSON no es válido.");
  }
}

export function json(response, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store" });
  response.end(data);
}
