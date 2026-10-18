import { clinicalVersion, hasValidClinicalApproval } from "../../mediweb-downloader/src/authorizationPolicy.js";
export { clinicalVersion, hasValidClinicalApproval } from "../../mediweb-downloader/src/authorizationPolicy.js";
import { processWorkerClinicalNarrative } from "../clinical/index.js";
import { validateExtractedWorker } from "./data/validateExtractedWorker.js";
import { recipientVersion } from "./recipientIdentity.js";
import { getRecipientChecks } from "./recipientPolicy.js";
export { recipientVersion } from "./recipientIdentity.js";

export function clinicalValidation(worker) {
  const validation = validateExtractedWorker(worker);
  // Evaluate an explicit review candidate without changing the stored worker or clinical rules.
  const result = processWorkerClinicalNarrative({ ...worker, validation: {
    ...validation, has_errors: validation.has_errors || Boolean(worker.validation?.has_errors),
  }, derived_states: { ...worker.derived_states, reviewed_by_user: true } });
  return { validation, blocked: !result.canGenerate, reasons: result.blockingReasons };
}

export function approveClinicalText(worker, text) {
  if (!text?.trim() || clinicalValidation(worker).blocked) return worker;
  const approved_at = new Date().toISOString();
  return { ...worker, clinical_approval: { status: "aprobada", approved_at, approval_id: globalThis.crypto.randomUUID(), evaluation_id: worker.evaluation_id, version: clinicalVersion(worker), text },
    derived_states: { ...worker.derived_states, reviewed_by_user: true, reviewed_at: approved_at, needs_review: false },
    app_fields: { ...worker.app_fields, texto_final: text, needs_review: false } };
}

export function reconcileWorkerReview(previous, next) {
  const changed = clinicalVersion(previous) !== clinicalVersion(next) || previous.app_fields?.texto_final !== next.app_fields?.texto_final;
  const invalid = changed && previous.clinical_approval?.status === "aprobada";
  const recipientChanged = recipientVersion(previous) !== recipientVersion(next);
  const validation = validateExtractedWorker(next);
  return { ...next, validation,
    clinical_approval: invalid ? { status: "invalidada" } : next.clinical_approval,
    derived_states: { ...next.derived_states,
      validation_warnings: validation.warnings, validation_error_count: validation.error_count, validation_warning_count: validation.warning_count,
      reviewed_by_user: invalid ? false : Boolean(next.clinical_approval?.status === "aprobada"),
      reviewed_at: invalid ? "" : next.derived_states?.reviewed_at,
      validation_status: validation.has_errors ? "bloqueada" : validation.has_warnings ? "con_alertas" : "valida",
      needs_review: invalid || validation.has_errors || next.clinical_approval?.status !== "aprobada" },
    app_fields: { ...next.app_fields,
      needs_review: invalid || validation.has_errors || next.clinical_approval?.status !== "aprobada",
      ...(recipientChanged ? { recipient_authorization: null, whatsapp_confirmed_phone: "", whatsapp_verification: null, phone_analysis: null } : {}),
      ...((changed || recipientChanged || JSON.stringify(previous.app_fields?.recipient_authorization) !== JSON.stringify(next.app_fields?.recipient_authorization)) && (next.app_fields?.audio_url || next.app_fields?.audio_record) ? { audio_stale: true } : {}) } };
}

export function getAudioAuthorization(worker, text) {
  const clinical = clinicalValidation(worker);
  const recipientRequired = worker.source_mode === "mediweb" || Boolean(worker.datos_operativos);
  const recipientChecks = getRecipientChecks(worker);
  const recipientVerified = !recipientRequired || recipientChecks.authorized;
  const approved = hasValidClinicalApproval(worker, text);
  return { extraction: worker.derived_states?.extraction_status || "extraido",
    validation: clinical.blocked ? "bloqueada" : clinical.validation.has_warnings ? "con_alertas" : "valida",
    approval: approved ? "aprobada" : worker.clinical_approval?.status === "pendiente" ? "pendiente" : "invalidada",
    recipient: recipientVerified ? "confirmada" : "pendiente",
    recipientChecks,
    canGenerateAudio: approved && !clinical.blocked && recipientVerified && worker.app_fields?.audio_status !== "generando" };
}

export async function requestApprovedAudio({ worker, text, synthesize, ...options }) {
  if (!getAudioAuthorization(worker, text).canGenerateAudio) throw new Error("Audio no autorizado.");
  return synthesize({ ...options, text });
}

// A response belongs to the approval and recipient authorization that started it.
export function isAudioResponseCurrent(requestWorker, currentWorker, text) {
  return currentWorker.clinical_approval === requestWorker.clinical_approval &&
    currentWorker.app_fields?.recipient_authorization === requestWorker.app_fields?.recipient_authorization &&
    currentWorker.app_fields?.whatsapp_confirmed_phone === requestWorker.app_fields?.whatsapp_confirmed_phone &&
    recipientVersion(currentWorker) === recipientVersion(requestWorker) &&
    currentWorker.app_fields?.texto_final === text &&
    getAudioAuthorization({ ...currentWorker, app_fields: { ...currentWorker.app_fields, audio_status: "listo" } }, text).canGenerateAudio;
}
