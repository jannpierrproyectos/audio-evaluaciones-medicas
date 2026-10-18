import { deliveryAction } from "../services/mediwebService.js";
import { getTtsConfiguration } from "./evaluationPersistence.js";
import { getAudioAuthorization } from "./clinicalApproval.js";
import { getRecipientChecks } from "./recipientPolicy.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";

export async function deliveryPreflight(evaluationId, request = deliveryAction, getConfiguration = getTtsConfiguration) {
  const detail = await request("detail", { evaluationId });
  const text = applyNarrativeGreeting(detail.worker.app_fields?.texto_final, detail.greeting);
  if (!getAudioAuthorization(detail.worker, text).canGenerateAudio || !getRecipientChecks(detail.worker).authorized || detail.reasons.length) throw new Error(detail.reasons.join(" ") || "Falta aprobación clínica o destinatario autorizado para esta entrega.");
  return { expectedBinding: detail.binding, configuration: await getConfiguration() };
}

export function deliveryState(row) {
  if (row.delivery?.state === "completada") return "enviados";
  if (row.reasons.length || ["incierta", "invalidada", "bloqueada"].includes(row.delivery?.state)) return "incidencias";
  if (row.delivery?.state === "listo") return "listos";
  return "pendientes";
}
export function nextDelivery(rows, currentId, filter = "todos", direction = 1) {
  const candidates = rows.filter(row => filter === "todos" || deliveryState(row) === filter);
  if (!candidates.length) return null;
  const index = candidates.findIndex(row => row.evaluation_id === currentId);
  return candidates[(Math.max(0, index) + direction + candidates.length) % candidates.length].evaluation_id;
}
export function nextPendingDelivery(rows, currentId) {
  const index = rows.findIndex(row => row.evaluation_id === currentId);
  for (let step = 1; step < rows.length; step++) {
    const row = rows[(index + step + rows.length) % rows.length];
    if (!row.reasons.length && !["completada", "incierta"].includes(row.delivery?.state)) return row.evaluation_id;
  }
  return null;
}
