import { MEDIWEB_SERVICE_URL } from "../services/mediwebService.js";
import { applyNarrativeGreeting, DEFAULT_NARRATIVE_GREETING } from "./narrativeGreeting.js";
import { clinicalVersion, getAudioAuthorization, hasValidClinicalApproval, reconcileWorkerReview, recipientVersion, requestApprovedAudio } from "./clinicalApproval.js";
import { prepareTextForTts } from "../clinical/ttsNormalizer.js";
import { isWhatsAppConfirmed, normalizePhoneForWhatsApp } from "./whatsappMessage.js";
import { getRecipientChecks, audioFingerprintPayload, matchesApprovedAudio } from "../../mediweb-downloader/src/authorizationPolicy.js";

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function stateRequest(body, binary = false) {
  const response = await fetch(`${MEDIWEB_SERVICE_URL}/state`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit",
    signal: ["load", "list", "contacts"].includes(body.action) ? AbortSignal.timeout(15000) : undefined,
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw Object.assign(new Error(details.message || "No se pudo guardar el progreso. Mantén esta ventana abierta."), { code: details.code });
  }
  return binary ? response.blob() : response.json();
}

export function restoreWorker(worker, greeting = DEFAULT_NARRATIVE_GREETING) {
  const text = applyNarrativeGreeting(worker.app_fields?.texto_final || "", greeting);
  let result = reconcileWorkerReview(worker, worker);
  const approvalValid = hasValidClinicalApproval(result, text) && result.clinical_approval?.evaluation_id === result.evaluation_id;
  if (!approvalValid) result = { ...result, clinical_approval: { status: result.clinical_approval?.status === "pendiente" ? "pendiente" : "invalidada" },
    derived_states: { ...result.derived_states, reviewed_by_user: false, reviewed_at: "", needs_review: true },
    app_fields: { ...result.app_fields, needs_review: true, audio_stale: Boolean(result.app_fields?.audio_record || result.app_fields?.audio_request || result.app_fields?.audio_url) } };
  const verification = result.app_fields?.whatsapp_verification;
  if (!verification || verification.identity !== recipientVersion(result) || verification.phone !== normalizePhoneForWhatsApp(result.datos_operativos?.telefono)) {
    result = { ...result, app_fields: { ...result.app_fields, whatsapp_confirmed_phone: "", recipient_authorization: null } };
  }
  const authorization = result.app_fields?.recipient_authorization;
  if (authorization && authorization.status !== "revocada" && (getRecipientChecks(result).authorizationStatus === "vencida" || authorization.version !== recipientVersion(result))) {
    result = { ...result, app_fields: { ...result.app_fields, recipient_authorization: { ...authorization, status: "vencida" } } };
  }
  if (result.app_fields?.audio_status === "generando") result = { ...result, app_fields: { ...result.app_fields, audio_status: "incierto", audio_error: "Solicitud interrumpida: no se repetirá automáticamente." } };
  return result;
}

export function batchCounts(snapshot) {
  const counts = { total: 0, procesados: 0, pendientes: 0, aprobados: 0, bloqueados: 0, audios: 0 };
  for (const worker of snapshot?.workers || []) {
    counts.total++;
    const text = applyNarrativeGreeting(worker.app_fields?.texto_final || "", snapshot.greeting);
    const state = getAudioAuthorization(worker, text);
    if (state.extraction === "extraido") counts.procesados++;
    if (state.approval === "aprobada") counts.aprobados++;
    else counts.pendientes++;
    if (state.validation === "bloqueada") counts.bloqueados++;
    if (worker.app_fields?.audio_url && !worker.app_fields?.audio_stale && state.approval === "aprobada") counts.audios++;
  }
  return counts;
}

export async function audioFingerprint(worker, text, configuration) {
  const reference = worker.app_fields?.audio_record || worker.app_fields?.audio_request;
  if (reference?.fingerprint && matchesApprovedAudio(worker, text, reference, configuration)) return reference.fingerprint;
  return sha256(JSON.stringify(audioFingerprintPayload(worker, text, configuration, prepareTextForTts(text))));
}

export class EvaluationRepository {
  constructor(request = stateRequest) { this.request = request; this.revisions = new Map(); this.tail = Promise.resolve(); this.failure = null; }
  list() { return this.request({ action: "list" }); }
  contacts() { return this.request({ action: "contacts" }); }
  async import(snapshot, importKey) {
    await this.flush();
    const batch = await this.request({ action: "import", snapshot, importKey });
    this.revisions.set(batch.id, batch.revision);
    return batch;
  }
  async load(id) {
    await this.tail;
    const batch = await this.request({ action: "load", id });
    this.failure = null;
    this.revisions.set(id, batch.revision);
    return batch;
  }
  save(snapshot) {
    const copy = structuredClone(snapshot);
    const promise = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      const result = await this.request({ action: "save", id: copy.batch_id, snapshot: copy, revision: this.revisions.get(copy.batch_id) });
      this.revisions.set(copy.batch_id, result.revision);
      return result;
    });
    this.tail = promise.catch(error => { this.failure = error; });
    return promise;
  }
  async flush() { await this.tail; if (this.failure) throw this.failure; }
  async remove(id) {
    await this.flush();
    return this.request({ action: "remove", id, revision: this.revisions.get(id) });
  }
}

function encodeBase64(bytes) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 16384) text += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(text);
}

export async function getTtsConfiguration() {
  const response = await fetch("/api/tts/configuration", { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo comprobar modelo, voz y configuración TTS.");
  const configuration = await response.json();
  if (configuration.provider === "mock") throw Object.assign(new Error("El servidor local no tiene conectado un servicio de voz real. Configura TTS_SERVICE_URL en el backend; no necesitas introducir una clave en la pantalla de audio."), { code: "TTS_SERVICE_NOT_CONFIGURED" });
  if (!configuration.provider || !configuration.model || !configuration.voice_ref || configuration.format !== "mp3") throw new Error("La persistencia de audio requiere un servicio MP3 con configuración identificable.");
  return configuration;
}

export async function recoverAudio(worker, greeting, repository, configuration) {
  const reference = worker.app_fields?.audio_record || worker.app_fields?.audio_request;
  if (!reference || reference.evaluation_id !== worker.evaluation_id) return worker;
  const text = applyNarrativeGreeting(worker.app_fields?.texto_final || "", greeting);
  const fingerprint = await audioFingerprint(worker, text, configuration);
  if (fingerprint !== reference.fingerprint || !getAudioAuthorization({ ...worker, app_fields: { ...worker.app_fields, audio_status: "listo" } }, text).canGenerateAudio) {
    return { ...worker, app_fields: { ...worker.app_fields, audio_stale: true } };
  }
  const op = await repository.request({ action: "operation", evaluationId: worker.evaluation_id, fingerprint });
  if (["no_solicitado", "no_enviada"].includes(op.status)) return { ...worker, app_fields: { ...worker.app_fields, audio_request: null, audio_status: "pendiente", audio_stale: true } };
  if (op.status !== "listo") return { ...worker, app_fields: { ...worker.app_fields, audio_status: "incierto", audio_stale: true } };
  if (JSON.stringify(canonical(op.metadata?.configuration)) !== JSON.stringify(canonical(configuration))) return { ...worker, app_fields: { ...worker.app_fields, audio_stale: true } };
  const blob = await repository.request({ action: "audio", batchId: worker.batch_id, evaluationId: worker.evaluation_id, operationId: op.id }, true);
  return { ...worker, app_fields: { ...worker.app_fields, audio_record: op.metadata, audio_url: URL.createObjectURL(blob), audio_status: "listo", audio_filename: "audio-evaluacion.mp3", audio_mime_type: "audio/mpeg", audio_stale: false } };
}

// Reserves durably before the paid request. A timeout is uncertain, never an automatic retry.
export async function generatePersistentAudio({ repository, worker, text, configuration, synthesize, authorize = async () => {}, update, current, greeting = DEFAULT_NARRATIVE_GREETING }) {
  if (!getAudioAuthorization(worker, text).canGenerateAudio) throw new Error("Audio no autorizado.");
  await repository.flush();
  const fingerprint = await audioFingerprint(worker, text, configuration);
  const metadata = { evaluation_id: worker.evaluation_id, fingerprint, text, tts_text: prepareTextForTts(text), configuration,
    approval_id: worker.clinical_approval?.approval_id, approved_at: worker.clinical_approval?.approved_at };
  await update(value => ({ ...value, app_fields: { ...value.app_fields, audio_request: metadata } }));
  const operation = await repository.request({ action: "reserve", batchId: worker.batch_id, evaluationId: worker.evaluation_id, fingerprint });
  if (operation.status === "listo") {
    const recovered = await recoverAudio(current(), greeting, repository, configuration);
    await update(value => {
      const unchanged = clinicalVersion(value) === clinicalVersion(worker) &&
        JSON.stringify(value.clinical_approval) === JSON.stringify(worker.clinical_approval) &&
        getAudioAuthorization(value, text).canGenerateAudio;
      return { ...value, app_fields: { ...value.app_fields, audio_record: recovered.app_fields.audio_record,
        audio_url: recovered.app_fields.audio_url, audio_filename: recovered.app_fields.audio_filename,
        audio_mime_type: recovered.app_fields.audio_mime_type, audio_status: recovered.app_fields.audio_status,
        audio_stale: !unchanged || recovered.app_fields.audio_stale } };
    });
    return { reused: true, stale: !current() || Boolean(current().app_fields?.audio_stale) };
  }
  if (operation.reused) throw Object.assign(new Error("Solicitud anterior de resultado incierto. No se repetirá el cargo automáticamente."), { code: "TTS_UNCERTAIN" });
  // Snapshot tokens are values, not JS reference identity, so restart is supported.
  const approvalToken = JSON.stringify(worker.clinical_approval);
  const isCurrent = value => value?.evaluation_id === worker.evaluation_id &&
    JSON.stringify(value.clinical_approval) === approvalToken && clinicalVersion(value) === clinicalVersion(worker) &&
    getAudioAuthorization({ ...value, app_fields: { ...value.app_fields, audio_status: "listo" } }, text).canGenerateAudio &&
    value.app_fields?.texto_final === text;
  if (!isCurrent(current())) {
    await repository.request({ action: "cancel-unsent", operationId: operation.id });
    throw new Error("La autorización cambió antes de solicitar TTS.");
  }
  let sent = false;
  try {
    await authorize();
    await update(value => ({ ...value, app_fields: { ...value.app_fields, audio_status: "generando", audio_error: "" } }));
    const latest = current();
    if (!isCurrent(latest)) throw new Error("La autorización cambió antes de solicitar TTS.");
    const result = await requestApprovedAudio({ worker: { ...latest, app_fields: { ...latest.app_fields, audio_status: "pendiente" } }, text, synthesize: options => { sent = true; return synthesize(options); }, filenameHint: "audio-evaluacion" });
    if (result.mimeType !== "audio/mpeg") throw new Error("El resultado no es MP3.");
    const configurationMatches = JSON.stringify(canonical(result.configuration)) === JSON.stringify(canonical(configuration));
    const actualMetadata = { ...metadata, configuration: result.configuration, configuration_matches: configurationMatches };
    const bytes = new Uint8Array(await result.audioBlob.arrayBuffer());
    await repository.request({ action: "complete", operationId: operation.id, audio: encodeBase64(bytes), metadata: actualMetadata });
    const value = current();
    const stale = !isCurrent(value) || !configurationMatches;
    if (!value) { URL.revokeObjectURL(result.audioUrl); return { reused: false, stale: true }; }
    await update(item => ({ ...item, app_fields: { ...item.app_fields, audio_record: actualMetadata,
      audio_url: result.audioUrl, audio_filename: result.audioFilename, audio_mime_type: result.mimeType,
      texto_tts: result.ttsText, audio_status: "listo", audio_stale: stale, audio_error: "",
      whatsapp_audio_file_id: "", whatsapp_audio_filename: "", whatsapp_audio_sha256: "" } }));
    return { reused: false, stale };
  } catch (error) {
    // This code is returned only by the backend's pre-provider auth check.
    // A missing device link must not leave an uncharged operation uncertain.
    if (['TTS_DEVICE_NOT_LINKED', 'TTS_GOOGLE_LOGIN_REQUIRED'].includes(error.code) && error.status === 401) sent = false;
    if (!sent) await repository.request({ action: "cancel-unsent", operationId: operation.id });
    await update(value => ({ ...value, app_fields: { ...value.app_fields, audio_status: sent ? "incierto" : "pendiente", audio_stale: true, audio_error: sent ? "Solicitud de resultado incierto. Revisa el servicio antes de repetir." : "No se solicito audio. Revisa el acceso del operador." } }));
    throw error;
  }
}

export function whatsappVerification(worker, available) {
  return { status: available ? "confirmado_por_operador" : "no_disponible", phone: normalizePhoneForWhatsApp(worker.datos_operativos?.telefono),
    identity: recipientVersion(worker), checked_at: new Date().toISOString(), origin: "operador" };
}

export function phoneState(worker) {
  if (!worker.datos_operativos?.telefono) return "faltante";
  if (!normalizePhoneForWhatsApp(worker.datos_operativos.telefono)) return "invalido";
  return worker.app_fields?.whatsapp_verification?.status || (isWhatsAppConfirmed(worker) ? "confirmado_por_operador" : "pendiente");
}

export function initialVerification(worker) {
  return { status: phoneState(worker), phone: normalizePhoneForWhatsApp(worker.datos_operativos?.telefono), identity: recipientVersion(worker),
    observed_at: new Date().toISOString(), origin: "importacion", checked_at: null };
}
