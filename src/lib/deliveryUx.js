import { recordWhatsAppDecision } from "./whatsappReview.js";
import { recipientVersion } from "./recipientIdentity.js";
import { deliveryAction, validateManagedFile } from "../services/mediwebService.js";
import { getTtsConfiguration } from "./evaluationPersistence.js";
import { getAudioAuthorization } from "./clinicalApproval.js";
import { getRecipientChecks } from "./recipientPolicy.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";

export async function deliveryPreflight(evaluationId, request = deliveryAction, getConfiguration = getTtsConfiguration) {
  const detail = await request("detail", { evaluationId });
  const text = applyNarrativeGreeting(detail.worker.app_fields?.texto_final, detail.greeting);
  if (!getAudioAuthorization(detail.worker, text).canGenerateAudio || !getRecipientChecks(detail.worker).authorized || detail.reasons.length) throw new Error(detail.reasons.join(" ") || "Falta aprobación clínica o destinatario autorizado para esta entrega.");
  const configuration = await getConfiguration().catch(error => {
    if (detail.audio_configuration) return detail.audio_configuration;
    throw error;
  });
  return { expectedBinding: detail.binding, configuration };
}

export function deliveryState(row) {
  if (row.delivery?.state === "completada") return "enviados";
  if (row.reasons.length || ["incierta", "invalidada", "bloqueada"].includes(row.delivery?.state)) return "incidencias";
  if (row.delivery?.state === "listo") return "listos";
  return "pendientes";
}
export function nextDelivery(rows, currentId, filter = "todos", direction = 1) {
  const candidates = rows.filter(row => matchesDeliveryFilter(row, filter));
  if (!candidates.length) return null;
  const index = candidates.findIndex(row => row.evaluation_id === currentId);
  return candidates[(Math.max(0, index) + direction + candidates.length) % candidates.length].evaluation_id;
}
export function matchesDeliveryFilter(row, filter) {
  return filter === "todos" || (filter === "pendientes" ? deliveryState(row) !== "enviados" : deliveryState(row) === filter);
}
export function nextPendingDelivery(rows, currentId) {
  const index = rows.findIndex(row => row.evaluation_id === currentId);
  for (let step = 1; step < rows.length; step++) {
    const row = rows[(index + step + rows.length) % rows.length];
    if ((!row.reasons.length || canConfirmDeliveryRecipient(row)) && !["completada", "incierta"].includes(row.delivery?.state)) return row.evaluation_id;
  }
  return null;
}

// Explicit declaration for this delivery only; WhatsApp existence is never consent.
export function canConfirmDeliveryRecipient(row) {
  return Boolean(row?.checks?.whatsapp && row.checks.formatValid && row.approval && row.audio && !["completada", "incierta"].includes(row.delivery?.state) && !(row.checks.identity && row.checks.consent && row.checks.pdf && row.checks.duplicateResolved));
}
export async function confirmDeliveryRecipient(row, repository, request = deliveryAction, validate = validateManagedFile, saveEvidence) {
  if (!canConfirmDeliveryRecipient(row)) throw new Error("Revisa primero WhatsApp, el texto, el audio y cualquier conflicto de identidad.");
  const detail = await request("detail", { evaluationId: row.evaluation_id });
  if (detail.binding !== row.binding) throw new Error("La evaluacion cambio. Actualiza la bandeja antes de confirmar.");
  const batch = await repository.load(row.batch_id);
  const snapshot = batch.snapshot;
  const index = snapshot.workers.findIndex(worker => worker.evaluation_id === row.evaluation_id);
  const savedWorker = snapshot.workers[index];
  const worker = savedWorker && { ...savedWorker, app_fields: { ...savedWorker.app_fields, phone_analysis: detail.worker.app_fields?.phone_analysis } };
  if (!worker || recipientVersion(worker) !== recipientVersion(detail.worker)) throw new Error("Cambio el destinatario o el PDF. Actualiza la bandeja.");
  await validate(worker.datos_operativos?.archivo_pdf_completo_id);
  const latest = await request("detail", { evaluationId: row.evaluation_id });
  if (latest.binding !== detail.binding) throw new Error("La evaluacion cambio durante la comprobacion. Actualiza la bandeja.");
  const evidence = {
    expectedVersion: recipientVersion(worker), expectedConflictSignature: worker.app_fields?.phone_analysis?.signature || "",
    expectedAuthorization: JSON.stringify(worker.app_fields?.recipient_authorization || null),
    saveAuthorization: true, identity: true, consent: true, pdf: true,
    duplicate: !row.checks.duplicateResolved,
    authorizationScope: "evaluation", expires_at: null,
  };
  if (saveEvidence) return saveEvidence(evidence);
  const confirmed = recordWhatsAppDecision(worker, "confirmado_por_operador", evidence);
  const workers = snapshot.workers.map((value, position) => position === index ? confirmed : value);
  await repository.save({ ...snapshot, workers });
}
