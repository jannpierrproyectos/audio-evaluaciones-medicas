import { HttpError } from "./jobManager.js";

export async function stateRoute(request, response, getStore) {
  if (!request.headers.origin) throw new HttpError(403, "ORIGIN_REQUIRED", "Origin obligatorio.");
  if (request.method !== "POST" || !String(request.headers["content-type"]).startsWith("application/json")) throw new HttpError(400, "INVALID_REQUEST", "Solicitud no valida.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 36 * 1024 * 1024) throw new HttpError(413, "REQUEST_TOO_LARGE", "Solicitud demasiado grande.");
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, "INVALID_JSON", "JSON no valido."); }
  try {
    const store = await getStore();
    let result;
    switch (body.action) {
      case "list": result = await store.list(); break;
      case "contacts": result = await store.contacts(); break;
      case "import": result = await store.import(body.snapshot, body.importKey); break;
      case "load": result = await store.load(body.id); break;
      case "save": result = await store.save(body.id, body.snapshot, body.revision); break;
      case "reserve": result = await store.reserve(body.batchId, body.evaluationId, body.fingerprint); break;
      case "operation": result = await store.operation(body.evaluationId, body.fingerprint); break;
      case "cancel-unsent": result = await store.cancelUnsent(body.operationId); break;
      case "complete": result = await store.complete(body.operationId, Buffer.from(body.audio || "", "base64"), body.metadata || {}); break;
      case "remove": result = await store.remove(body.id, body.revision); break;
      case "audio": {
        const { bytes } = await store.audio(body.batchId, body.evaluationId, body.operationId);
        response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": bytes.length, "Cache-Control": "no-store" });
        response.end(bytes); return;
      }
      default: throw new HttpError(400, "INVALID_ACTION", "Accion no valida.");
    }
    const bytes = Buffer.from(JSON.stringify(result));
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-store" });
    response.end(bytes);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const messages = {
      STORE_EVALUATION_CONFLICT: "El lote contiene versiones diferentes de una misma evaluación. Los PDF se conservan; revisa esa discrepancia.",
      STORE_REVISION_CONFLICT: "Otra ventana modificó el lote. Vuelve a abrirlo para continuar con la versión guardada.",
      STORE_BUSY: "El almacenamiento está ocupado por otra operación. Espera un momento y reintenta.",
    };
    throw new HttpError(error.status || 503, error.code?.startsWith("STORE_") ? error.code : "STORE_UNAVAILABLE", messages[error.code] || "Almacenamiento seguro no disponible o en conflicto. Conserva esta ventana y vuelve a cargar el lote antes de continuar.");
  }
}
