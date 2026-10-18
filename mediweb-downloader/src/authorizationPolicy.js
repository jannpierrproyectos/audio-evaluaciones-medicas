// Pure version and recipient policies shared by React and the packaged Connector.
const PERU_LOCAL_MOBILE = /^9\d{8}$/;
const PERU_INTERNATIONAL_MOBILE = /^519\d{8}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

// Exact content version; only persisted inside the encrypted local store.
export function clinicalVersion(worker) {
  const excluded = new Set(["app_fields", "derived_states", "validation", "datos_operativos", "clinical_approval", "source_mode"]);
  return JSON.stringify(stable(Object.fromEntries(Object.entries(worker).filter(([key]) => !excluded.has(key)))));
}

export function recipientVersion(worker) {
  return JSON.stringify(stable({ identity: worker.identificacion, operational: worker.datos_operativos }));
}

export function normalizePhoneForWhatsApp(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return "";
  if (PERU_LOCAL_MOBILE.test(digits)) return `51${digits}`;
  if (PERU_INTERNATIONAL_MOBILE.test(digits)) return digits;
  return "";
}

export function getWhatsAppAvailability(worker) {
  const phone = normalizePhoneForWhatsApp(worker?.datos_operativos?.telefono);
  const pdfName = String(worker?.datos_operativos?.archivo_pdf_completo || "").trim();
  const pdfFileId = String(worker?.datos_operativos?.archivo_pdf_completo_id || "").trim();
  const audioUrl = String(worker?.app_fields?.audio_url || "").trim();
  const audioMimeType = String(worker?.app_fields?.audio_mime_type || "").toLowerCase();
  const audioFilename = String(worker?.app_fields?.audio_filename || "").toLowerCase();
  const hasMp3 = !worker?.app_fields?.audio_stale && Boolean(audioUrl) && (audioMimeType === "audio/mpeg" || audioFilename.endsWith(".mp3"));
  const missing = [];

  if (!phone) missing.push("Teléfono inválido o ausente.");
  if (!pdfName || !pdfFileId) {
    missing.push("PDF completo no disponible en el Connector. En MediWeb, usa la opción Ambos.");
  }

  return {
    phone,
    pdfName,
    pdfFileId,
    hasValidPhone: Boolean(phone),
    hasPdf: Boolean(pdfName && pdfFileId),
    hasAudio: hasMp3,
    canPrepare: missing.length === 0,
    missing,
  };
}

export function isWhatsAppConfirmed(worker, now = Date.now()) {
  const phone = normalizePhoneForWhatsApp(worker?.datos_operativos?.telefono);
  const verification = worker?.app_fields?.whatsapp_verification;
  const unexpired = !verification?.expires_at || (Number.isFinite(Date.parse(verification.expires_at)) && Date.parse(verification.expires_at) > now);
  const matchingEvaluation = !verification?.evaluation_id || verification.evaluation_id === worker?.evaluation_id;
  const checkedAt = Date.parse(verification?.checked_at);
  const persistedCheck = !worker?.evaluation_id || (verification?.status === "confirmado_por_operador" && verification.phone === phone && verification.identity === recipientVersion(worker) && Number.isFinite(checkedAt) && checkedAt <= now && matchingEvaluation && unexpired);
  return Boolean(phone && persistedCheck && worker?.app_fields?.whatsapp_confirmed_phone === phone);
}

export function getRecipientChecks(worker, now = Date.now()) {
  const availability = getWhatsAppAvailability(worker);
  const fields = worker.app_fields || {};
  const authorization = fields.recipient_authorization;
  const bound = authorization?.version === recipientVersion(worker);
  const unexpired = !worker.evaluation_id || (Number.isFinite(Date.parse(authorization?.expires_at)) && Date.parse(authorization.expires_at) > now);
  const legacy = authorization?.schema !== 2;
  // Phase 01 explicitly confirmed these three decisions together. Keep that
  // declaration valid, but never manufacture separate confirmations on restore.
  const declared = bound && authorization?.status === "confirmada";
  const identity = Boolean(bound && (legacy ? declared : authorization.identity_confirmed));
  const consent = Boolean(declared && unexpired && (legacy || authorization.channel_authorized));
  const pdf = Boolean(availability.hasPdf && bound && (legacy ? declared : authorization.pdf_confirmed));
  const conflict = fields.phone_analysis;
  const duplicateResolved = !conflict?.conflicting || Boolean(identity && consent && authorization?.duplicate_signature === conflict.signature);
  const whatsapp = isWhatsAppConfirmed(worker, now);
  return { formatValid: availability.hasValidPhone, whatsapp, identity, consent, pdf, duplicateResolved,
    authorizationStatus: !unexpired && authorization ? "vencida" : authorization?.status || "pendiente",
    authorized: Boolean(availability.hasValidPhone && whatsapp && identity && consent && pdf && duplicateResolved) };
}

export function hasValidClinicalApproval(worker, text) {
  const approval = worker.clinical_approval;
  return Boolean(approval?.status === "aprobada" && approval.approved_at &&
    approval.version === clinicalVersion(worker) && approval.text === text && text?.trim());
}


export function canonical(value) { return stable(value); }
export function audioFingerprintPayload(worker, text, configuration, tts) {
  return stable({ evaluation_id: worker.evaluation_id, batch_id: worker.batch_id, clinical: clinicalVersion(worker), recipient: recipientVersion(worker), text, tts, configuration, contract: 1 });
}
