const DEFAULT_MEDIWEB_SERVICE_URL = "http://127.0.0.1:8765";
const HEALTH_TIMEOUT_MS = 2000;

export const MEDIWEB_SERVICE_URL = String(
  import.meta.env?.VITE_MEDIWEB_SERVICE_URL || DEFAULT_MEDIWEB_SERVICE_URL,
).replace(/\/+$/, "");

export class MediwebServiceError extends Error {
  constructor(code, message, { status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "MediwebServiceError";
    this.code = code;
    this.status = status;
  }
}

export async function checkMediwebHealth({ signal, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  return requestJson("/health", { signal, timeoutMs });
}

export async function checkConnectorUpdate({ signal } = {}) {
  return requestJson("/update/check", { method: "POST", signal, timeoutMs: 20000 });
}

export async function getConnectorUpdateStatus({ signal } = {}) {
  return requestJson("/update/status", { signal, timeoutMs: 10000 });
}

export async function downloadConnectorUpdate({ signal } = {}) {
  return requestJson("/update/download", { method: "POST", signal, timeoutMs: 10 * 60 * 1000 });
}

export async function installConnectorUpdate({ signal } = {}) {
  return requestJson("/update/install", { method: "POST", signal, timeoutMs: 20000 });
}

export async function diagnoseConnector(options = {}) {
  try {
    const health = await checkMediwebHealth(options);
    return { status: "connected", health, error: null };
  } catch (error) {
    return { status: classifyConnectorError(error), health: null, error };
  }
}

export function classifyConnectorError(error) {
  if (error?.code === "CONNECTOR_TIMEOUT") return "timeout";
  if (error?.code === "ORIGIN_NOT_ALLOWED" || error?.status === 403) return "origin_rejected";
  if (["NotAllowedError", "SecurityError"].includes(error?.cause?.name)) return "network_blocked";
  if (error?.code === "NETWORK_ERROR" || error?.code === "CONNECTOR_UNAVAILABLE") return "unavailable";
  return "unknown";
}

export function getConnectorDiagnosticMessage(status) {
  if (status === "timeout") {
    return "AudioEvaluaciones Connector no respondió a tiempo. Comprueba que esté abierto y vuelve a intentarlo.";
  }
  if (status === "origin_rejected") {
    return "Esta versión de AudioEvaluaciones no tiene permiso para usar el Connector. Comprueba su configuración y vuelve a intentarlo.";
  }
  if (status === "network_blocked") {
    return "El navegador no permitió la comunicación con AudioEvaluaciones Connector. Comprueba los permisos de acceso local de este sitio y vuelve a intentarlo.";
  }
  if (status === "unknown") {
    return "No fue posible comprobar AudioEvaluaciones Connector. Comprueba que esté abierto y vuelve a intentarlo.";
  }
  return "AudioEvaluaciones Connector no está disponible en esta computadora. Comprueba que el Connector esté abierto y vuelve a intentarlo.";
}

export async function openMediweb({ signal } = {}) {
  return requestJson("/mediweb/open", { method: "POST", signal });
}

export async function detectMediwebEvaluations({ signal } = {}) {
  return requestJson("/mediweb/detect", { method: "POST", signal });
}

export async function createMediwebJob(options, { signal } = {}) {
  return requestJson("/jobs", { method: "POST", body: options, signal });
}

export async function getMediwebJob(jobId, { signal } = {}) {
  return requestJson(`/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export async function cancelMediwebJob(jobId, { signal } = {}) {
  return requestJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", signal });
}

export async function getMediwebManifest(jobId, { signal } = {}) {
  return requestJson(`/jobs/${encodeURIComponent(jobId)}/manifest`, { signal });
}

export async function getMediwebWorkerMetadata(jobId, { signal } = {}) {
  return requestJson(`/jobs/${encodeURIComponent(jobId)}/worker-metadata`, { signal });
}

export async function getMediwebFirstPages(jobId, { signal } = {}) {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}/first-pages`, { signal });
  if (!response.ok) throw await createHttpError(response);
  return {
    blob: await response.blob(),
    fileName: getResponseFileName(response),
  };
}

export function getResponseFileName(response) {
  const disposition = response?.headers?.get?.("Content-Disposition") || "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ""));

  const plainMatch = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i);
  return (plainMatch?.[1] || plainMatch?.[2] || "").trim();
}

export function getMediwebErrorMessage(error) {
  const messages = {
    CONNECTOR_UNAVAILABLE: "El conector local de MediWeb no está disponible.",
    CONNECTOR_TIMEOUT: "El conector local de MediWeb no respondió a tiempo.",
    RESULTS_NOT_READY: "Realiza primero la búsqueda en MediWeb.",
    JOB_ALREADY_RUNNING: "Ya existe un procesamiento en curso.",
    JOB_NOT_FOUND: "El procesamiento ya no está disponible. Es posible que el conector haya sido reiniciado.",
    FIRST_PAGES_NOT_READY: "El PDF todavía se está preparando.",
    JOB_NOT_FINISHED: "El PDF todavía se está preparando.",
    NETWORK_ERROR: "No fue posible comunicarse con el conector MediWeb.",
    FAILED: "Se produjo un error durante el procesamiento de MediWeb.",
    UPDATE_JOB_ACTIVE: "Hay un procesamiento de evaluaciones en curso. Finalízalo o cancélalo antes de actualizar el Connector.",
    UPDATE_SHA256_MISMATCH: "No se pudo verificar la actualización. El instalador descargado fue descartado.",
    UPDATE_MANIFEST_UNAVAILABLE: "No se pudo consultar la actualización. Puedes continuar usando la versión actual.",
    UPDATE_DOWNLOAD_FAILED: "No se pudo descargar la actualización.",
  };
  return messages[error?.code] || error?.message || messages.NETWORK_ERROR;
}

async function requestJson(path, options = {}) {
  const response = await request(path, options);
  if (!response.ok) throw await createHttpError(response);
  try {
    return await response.json();
  } catch (error) {
    throw new MediwebServiceError("INVALID_RESPONSE", "El conector devolvió una respuesta no válida.", {
      status: response.status,
      cause: error,
    });
  }
}

async function request(path, { method = "GET", body, signal, timeoutMs } = {}) {
  const requestControl = createRequestControl(signal, timeoutMs);
  try {
    return await fetch(`${MEDIWEB_SERVICE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      signal: requestControl.signal,
    });
  } catch (error) {
    if (requestControl.didTimeout()) {
      throw new MediwebServiceError("CONNECTOR_TIMEOUT", "El conector no respondió a tiempo.", { cause: error });
    }
    if (signal?.aborted || error?.name === "AbortError") {
      throw new MediwebServiceError("REQUEST_ABORTED", "La solicitud fue cancelada.", { cause: error });
    }
    throw new MediwebServiceError("NETWORK_ERROR", "No fue posible comunicarse con el conector MediWeb.", { cause: error });
  } finally {
    requestControl.cleanup();
  }
}

async function createHttpError(response) {
  let details = null;
  try {
    details = await response.json();
  } catch {
    // Las respuestas no JSON se presentan con un mensaje seguro y genérico.
  }
  return new MediwebServiceError(
    details?.code || `HTTP_${response.status}`,
    details?.message || "El conector MediWeb devolvió un error.",
    { status: response.status },
  );
}

function createRequestControl(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = null;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      if (timeoutId !== null) clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}
