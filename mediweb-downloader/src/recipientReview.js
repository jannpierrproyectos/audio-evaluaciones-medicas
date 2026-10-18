import { recipientVersion, getRecipientChecks, normalizePhoneForWhatsApp, isWhatsAppConfirmed } from "./authorizationPolicy.js";
import { getWhatsAppRecipientName } from "./whatsappContent.js";
const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
export const REVIEW_FILTERS = [
  ["pendientes", "Pendientes"], ["confirmados", "Confirmados"], ["sin-whatsapp", "Sin WhatsApp"],
  ["bloqueados", "Bloqueados"], ["todos", "Todos"],
];

export function personKey(worker) {
  const identity = worker.identificacion || {};
  const document = normalized(identity.numero_documento || identity.dni).replace(/\W/g, "");
  if (!document || (identity.dni && identity.numero_documento && normalized(identity.dni) !== normalized(identity.numero_documento))) return `unknown:${worker.evaluation_id}`;
  return JSON.stringify([normalized(identity.tipo_documento || (/^\d{8}$/.test(document) ? "DNI" : "DOCUMENTO")), document, normalized(getWhatsAppRecipientName(worker))]);
}

export function analyzePhones(workers, storedContacts = []) {
  // Active evaluation replaces its older persisted snapshot, without losing other batches.
  const contacts = new Map(storedContacts.map(worker => [worker.evaluation_id, worker]));
  workers.forEach((worker, index) => contacts.set(worker.evaluation_id || `active:${index}`, worker));
  const groups = new Map();
  for (const worker of contacts.values()) {
    const phone = normalizePhoneForWhatsApp(worker.datos_operativos?.telefono);
    if (!phone) continue;
    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(worker);
  }
  return workers.map(worker => {
    const raw = String(worker.datos_operativos?.telefono || "").trim();
    const phone = normalizePhoneForWhatsApp(raw);
    const group = groups.get(phone) || [];
    const people = [...new Set(group.map(personKey))].sort();
    const digits = raw.replace(/[\s\-()+]/g, "");
    return { phone, format: phone ? "formato_valido" : !raw ? "faltante" : /^\d+$/.test(digits) && digits.length < 9 ? "incompleto" : "invalido",
      duplicate_count: group.length, duplicate: group.length > 1, conflicting: people.length > 1,
      signature: people.length > 1 ? JSON.stringify([phone, people]) : "" };
  });
}

function recordedCheck(worker, now) {
  const check = worker.app_fields?.whatsapp_verification;
  return Boolean(check?.identity === recipientVersion(worker) && check.phone === normalizePhoneForWhatsApp(worker.datos_operativos?.telefono) &&
    Number.isFinite(Date.parse(check.checked_at)) && Date.parse(check.checked_at) <= now && (!check.evaluation_id || check.evaluation_id === worker.evaluation_id) && (!check.expires_at || Date.parse(check.expires_at) > now));
}

export function whatsappState(worker, now = Date.now()) {
  const raw = String(worker.datos_operativos?.telefono || "").trim();
  if (!raw || !normalizePhoneForWhatsApp(raw)) return "bloqueado";
  if (!recordedCheck(worker, now)) return "pendiente";
  const status = worker.app_fields.whatsapp_verification.status;
  if (status === "no_disponible") return "no_disponible";
  return isWhatsAppConfirmed(worker, now) ? "confirmado_por_operador" : "pendiente";
}

export function matchesReviewFilter(worker, filter, now = Date.now()) {
  const status = whatsappState(worker, now);
  if (filter === "confirmados") return status === "confirmado_por_operador";
  if (filter === "sin-whatsapp") return status === "no_disponible";
  if (filter === "bloqueados") return !getRecipientChecks(worker, now).authorized;
  if (filter === "pendientes") return status === "pendiente" || status === "bloqueado" || (status === "confirmado_por_operador" && worker.app_fields?.phone_analysis?.conflicting && !getRecipientChecks(worker, now).duplicateResolved);
  return true;
}

export function phoneSummary(workers, now = Date.now()) {
  const counts = { validos: 0, invalidos: 0, ausentes: 0, incompletos: 0, pendientes: 0, confirmados: 0, sin_whatsapp: 0, duplicados: 0, conflictos: 0 };
  for (const worker of workers) {
    const analysis = worker.app_fields?.phone_analysis || analyzePhones([worker])[0];
    if (analysis.phone) counts.validos++; else counts.invalidos++;
    if (analysis.format === "faltante") counts.ausentes++;
    if (analysis.format === "incompleto") counts.incompletos++;
    if (analysis.duplicate) counts.duplicados++;
    if (analysis.conflicting) counts.conflictos++;
    if (matchesReviewFilter(worker, "pendientes", now)) counts.pendientes++;
    if (whatsappState(worker, now) === "confirmado_por_operador") counts.confirmados++;
    if (whatsappState(worker, now) === "no_disponible") counts.sin_whatsapp++;
  }
  return counts;
}

function validSourceCheck(source, contacts, now, seen = new Set()) {
  if (!source || seen.has(source.evaluation_id) || !getRecipientChecks(source, now).authorized) return false;
  seen.add(source.evaluation_id);
  const lineage = source.app_fields?.whatsapp_verification?.reused_from;
  if (!lineage) return true;
  const previous = contacts.find(item => item.evaluation_id === lineage.evaluation_id && item.batch_id === lineage.batch_id);
  return Boolean(previous && previous.app_fields?.whatsapp_verification?.checked_at === lineage.checked_at &&
    personKey(source) === personKey(previous) && normalizePhoneForWhatsApp(source.datos_operativos?.telefono) === normalizePhoneForWhatsApp(previous.datos_operativos?.telefono) && validSourceCheck(previous, contacts, now, seen));
}

export function synchronizeRecipients(workers, storedContacts = [], now = Date.now()) {
  const analyses = analyzePhones(workers, storedContacts);
  const contacts = storedContacts.filter(worker => !workers.some(active => active.evaluation_id === worker.evaluation_id));
  return workers.map((original, index) => {
    const fields = original.app_fields || {};
    let worker = { ...original, app_fields: { ...fields, phone_analysis: analyses[index] } };
    let check = worker.app_fields.whatsapp_verification;
    if (check?.reused_from) {
      const source = storedContacts.find(item => item.evaluation_id === check.reused_from.evaluation_id && item.batch_id === check.reused_from.batch_id);
      const validSource = source && check.reused_from.checked_at === source.app_fields?.whatsapp_verification?.checked_at &&
        personKey(source) === personKey(worker) && validSourceCheck(source, storedContacts, now);
      if (!validSource) worker.app_fields = { ...worker.app_fields, whatsapp_verification: { ...check, status: "invalidada" }, whatsapp_confirmed_phone: "", recipient_authorization: null, audio_stale: true };
    }
    check = worker.app_fields.whatsapp_verification;
    if (check && !recordedCheck(worker, now)) worker.app_fields = { ...worker.app_fields, whatsapp_verification: check.checked_at ? { ...check, status: "invalidada" } : null, whatsapp_confirmed_phone: "", recipient_authorization: null, audio_stale: true };
    // A local explicit decision (including "later" or "no") always wins over history.
    if (!check?.checked_at && !check?.reused_from && analyses[index].phone && !analyses[index].conflicting && !worker.app_fields.recipient_authorization) {
      const candidates = contacts.filter(source => personKey(source) === personKey(worker) && normalizePhoneForWhatsApp(source.datos_operativos?.telefono) === analyses[index].phone && source.app_fields?.whatsapp_verification?.checked_at)
        .sort((a, b) => Date.parse(b.app_fields.whatsapp_verification.checked_at) - Date.parse(a.app_fields.whatsapp_verification.checked_at) || Number(getRecipientChecks(a, now).authorized) - Number(getRecipientChecks(b, now).authorized));
      const source = candidates[0];
      const expiry = source?.app_fields?.whatsapp_verification?.expires_at || source?.app_fields?.recipient_authorization?.expires_at;
      if (source && validSourceCheck(source, storedContacts, now) && Date.parse(expiry) > now) {
        const recovered = { ...source.app_fields.whatsapp_verification, schema: 2, identity: recipientVersion(worker), phone: analyses[index].phone,
          evaluation_id: worker.evaluation_id, origin: "recuperada", expires_at: expiry,
          reused_from: { evaluation_id: source.evaluation_id, batch_id: source.batch_id, checked_at: source.app_fields.whatsapp_verification.checked_at } };
        worker.app_fields = { ...worker.app_fields, whatsapp_verification: recovered, whatsapp_confirmed_phone: analyses[index].phone,
          whatsapp_history: [...(worker.app_fields.whatsapp_history || []), recovered] };
      }
    }
    const recipientRequired = worker.source_mode === "mediweb" || Boolean(worker.datos_operativos);
    if (recipientRequired && !getRecipientChecks(worker, now).authorized && (worker.app_fields.audio_record || worker.app_fields.audio_url)) worker.app_fields.audio_stale = true;
    return worker;
  });
}

export function nextReviewId(workers, currentId, visited = [], filter = "pendientes") {
  const start = workers.findIndex(worker => worker.evaluation_id === currentId);
  for (let step = 1; step <= workers.length; step++) {
    const worker = workers[(start + step + workers.length) % workers.length];
    if (worker.evaluation_id !== currentId && !visited.includes(worker.evaluation_id) && matchesReviewFilter(worker, filter)) return worker.evaluation_id;
  }
  return null;
}

export function recordWhatsAppDecision(worker, decision, evidence = {}, now = Date.now()) {
  if (evidence.expectedVersion && evidence.expectedVersion !== recipientVersion(worker)) throw new Error("Cambió el teléfono o la identidad. Vuelve a comprobar el chat.");
  if (evidence.expectedConflictSignature !== undefined && evidence.expectedConflictSignature !== (worker.app_fields?.phone_analysis?.signature || "")) throw new Error("Cambió el grupo de teléfonos duplicados. Revisa la identidad antes de confirmar.");
  if (evidence.saveAuthorization && evidence.expectedAuthorization !== undefined && evidence.expectedAuthorization !== JSON.stringify(worker.app_fields?.recipient_authorization || null)) throw new Error("La autorización cambió. Revisa y confirma las declaraciones de nuevo.");
  if (!["confirmado_por_operador", "no_disponible", "incierto"].includes(decision)) throw new Error("Decisión no válida.");
  const phone = normalizePhoneForWhatsApp(worker.datos_operativos?.telefono);
  if (decision !== "incierto" && !phone) throw new Error("Corrige el teléfono antes de comprobar WhatsApp.");
  const confirmedAt = new Date(now).toISOString();
  const verification = { schema: 2, status: decision, identity: recipientVersion(worker), phone, evaluation_id: worker.evaluation_id,
    checked_at: confirmedAt, origin: "operador_cola", ...(Date.parse(evidence.expires_at) > now ? { expires_at: new Date(evidence.expires_at).toISOString() } : {}) };
  const existing = worker.app_fields?.recipient_authorization;
  // Never erase a revocation by declaring that the account exists.
  let authorization = decision === "confirmado_por_operador" ? existing : null;
  if (decision === "confirmado_por_operador" && evidence.saveAuthorization) {
    if (!evidence.identity || !evidence.consent || !evidence.pdf || !(Date.parse(evidence.expires_at) > now)) throw new Error("Confirma identidad, autorización, PDF y vencimiento.");
    if (worker.app_fields?.phone_analysis?.conflicting && !evidence.duplicate) throw new Error("Confirma la identidad para este teléfono compartido.");
    authorization = { schema: 2, status: "confirmada", authorization_id: globalThis.crypto.randomUUID(),
      version: recipientVersion(worker), confirmed_at: confirmedAt, expires_at: new Date(evidence.expires_at).toISOString(),
      identity_confirmed: true, channel_authorized: true, pdf_confirmed: true,
      duplicate_signature: evidence.duplicate ? worker.app_fields?.phone_analysis?.signature || "" : "" };
  }
  return { ...worker, app_fields: { ...worker.app_fields, whatsapp_verification: verification,
    whatsapp_history: [...(worker.app_fields?.whatsapp_history || []), verification],
    whatsapp_confirmed_phone: decision === "confirmado_por_operador" ? phone : "", recipient_authorization: authorization,
    ...(decision !== "confirmado_por_operador" ? { audio_stale: true } : {}),
  } };
}

