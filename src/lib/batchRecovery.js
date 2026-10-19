import { restoreWorker } from "./evaluationPersistence.js";
import { synchronizeRecipients } from "./whatsappReview.js";
import { recoverBulkQueue } from "./bulkAudio.js";
import { DEFAULT_NARRATIVE_GREETING } from "./narrativeGreeting.js";

const known = new Set(["STORE_NOT_FOUND", "STORE_CORRUPT", "STORE_KEY_UNAVAILABLE", "STORE_BUSY", "STORE_UNAVAILABLE", "STORE_SCHEMA_UNSUPPORTED", "STORE_INVALID_ID", "STORE_REVISION_CONFLICT", "BATCH_EMPTY", "BATCH_INVALID", "PDF_IMPORT_EMPTY", "FIRST_PAGES_NOT_FOUND", "FIRST_PAGES_NOT_READY", "ORIGIN_REQUIRED", "ORIGIN_NOT_ALLOWED", "INVALID_RESPONSE", "NETWORK_ERROR", "CONNECTOR_TIMEOUT", "STORE_INVALID_SNAPSHOT"]);
export function recoveryDiagnostic(error, stage = "BATCH_LOAD") {
  const reason = known.has(error?.code) ? error.code : error?.name === "TypeError" ? "NETWORK" : error?.name === "TimeoutError" ? "TIMEOUT" : "FAILED";
  return { code: `${stage}_${reason}`, stage };
}
export function recoveryError(code) {
  return Object.assign(new Error("No se pudieron abrir las evaluaciones. Los archivos originales se conservan."), { code });
}
export function reportRecoveryDiagnostic(diagnostic) {
  // Only fixed diagnostic codes and stages; no exception message, identifiers or clinical data.
  console.warn("[AudioEvaluaciones:recuperacion]", diagnostic.code, diagnostic.stage);
}
export function recoveryDescription(diagnostic) {
  if (diagnostic.code.endsWith("STORE_BUSY")) return "El almacén está ocupado por otra operación. Espera un momento y reintenta.";
  if (diagnostic.code.endsWith("STORE_NOT_FOUND")) return "El proceso apunta a un lote que no está disponible en este catálogo.";
  if (diagnostic.code.endsWith("STORE_CORRUPT")) return "No se pudo verificar la integridad del catálogo. No se sobrescribirá su contenido.";
  if (diagnostic.code.endsWith("STORE_KEY_UNAVAILABLE")) return "Windows no pudo abrir la clave protegida de este usuario.";
  if (diagnostic.code.endsWith("BATCH_EMPTY")) return "El lote guardado no contiene evaluaciones para revisar.";
  if (/NETWORK|TIMEOUT|CONNECTOR/.test(diagnostic.code)) return "No se pudo leer la respuesta del Connector. Comprueba su conexión y reintenta.";
  return "No se pudo completar la apertura de las evaluaciones guardadas.";
}

// Opening a saved batch is read-only. Neither a contact refresh nor a write
// conflict may turn an otherwise readable catalogue into an empty UI.
export async function loadReviewableBatch(repository, id) {
  let batch;
  try { batch = await repository.load(id); }
  catch (error) { throw Object.assign(recoveryError(error.code), { diagnostic: recoveryDiagnostic(error) }); }
  if (!batch?.snapshot || batch.id !== id || batch.snapshot.batch_id !== id || !Array.isArray(batch.snapshot.workers)) {
    const error = recoveryError("BATCH_INVALID"); error.diagnostic = recoveryDiagnostic(error); throw error;
  }
  if (!batch.snapshot.workers.length) {
    const error = recoveryError("BATCH_EMPTY"); error.diagnostic = recoveryDiagnostic(error); throw error;
  }
  const greeting = batch.snapshot.greeting || DEFAULT_NARRATIVE_GREETING;
  let workers;
  try { workers = batch.snapshot.workers.map(worker => restoreWorker(worker, greeting)); }
  catch (error) { throw Object.assign(recoveryError("BATCH_INVALID"), { diagnostic: recoveryDiagnostic(error, "BATCH_REVIEW") }); }
  const warnings = [];
  try { workers = synchronizeRecipients(workers, (await repository.contacts()).contacts); }
  catch (error) { warnings.push(recoveryDiagnostic(error, "BATCH_CONTACTS")); }
  return { snapshot: { ...batch.snapshot, greeting, workers, bulk_audio_queue: recoverBulkQueue(batch.snapshot.bulk_audio_queue, workers) }, warnings };
}
