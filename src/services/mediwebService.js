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

export async function getMediwebFirstPages(jobId, { signal } = {}) {
  const response = await request(`/jobs/${encodeURIComponent(jobId)}/first-pages`, { signal });
  if (!response.ok) throw await createHttpError(response);
  return response.blob();
}

export function getMediwebErrorMessage(error) {
  const messages = {
    CONNECTOR_UNAVAILABLE: "El conector local de MediWeb no está disponible.",
    RESULTS_NOT_READY: "Realiza primero la búsqueda en MediWeb.",
    JOB_ALREADY_RUNNING: "Ya existe un procesamiento en curso.",
    JOB_NOT_FOUND: "El procesamiento ya no está disponible. Es posible que el conector haya sido reiniciado.",
    FIRST_PAGES_NOT_READY: "El PDF todavía se está preparando.",
    JOB_NOT_FINISHED: "El PDF todavía se está preparando.",
    NETWORK_ERROR: "No fue posible comunicarse con el conector MediWeb.",
    FAILED: "Se produjo un error durante el procesamiento de MediWeb.",
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
      signal: requestControl.signal,
    });
  } catch (error) {
    if (requestControl.didTimeout()) {
      throw new MediwebServiceError("CONNECTOR_UNAVAILABLE", "El conector no respondió a tiempo.", { cause: error });
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
