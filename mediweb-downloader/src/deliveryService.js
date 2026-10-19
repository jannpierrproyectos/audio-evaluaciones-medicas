import { createHash, randomUUID } from "node:crypto";
import { canonical, hasValidClinicalApproval, getRecipientChecks, audioFingerprintPayload, matchesApprovedAudio, recipientVersion } from "./authorizationPolicy.js";
import { synchronizeRecipients } from "./recipientReview.js";
import { buildWhatsAppMessage, getWhatsAppRecipientName } from "./whatsappContent.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";
import { extractOperationalDataFromPdf } from "./phoneExtractor.js";
import { ManagedFileError } from "./managedFiles.js";

const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest("hex");
const fail = (code, message = "Revisa la entrega, sus archivos y la autorización antes de continuar.") => Object.assign(new Error(message), { code, status: 409 });
const sentParts = ["message", "pdf", "mp3"];
const exposed = record => record?.pending || record?.events?.some(event => ["conversation", "message", "pdf", "mp3", "confirm"].includes(event.action));
const dateKey = value => {
  const raw = String(value || "").trim().replaceAll("-", "/");
  const parts = raw.split("/");
  return parts.length === 3 ? (parts[0].length === 4 ? parts : parts.reverse()).join("-") : "";
};

export class DeliveryService {
  constructor({ getStore, managedFiles, inspectIdentity = bytes => extractOperationalDataFromPdf(bytes, { identityDetails: true }) }) {
    Object.assign(this, { getStore, managedFiles, inspectIdentity }); this.preparing = new Map();
  }
  async transaction(action) {
    const store = await this.getStore();
    const result = await store.exclusive(async data => {
      data.deliveries ||= [];
      try { return { write: true, value: { result: await action(data, store) } }; }
      catch (error) { return { write: true, value: { error: { code: error.code || "DELIVERY_UNAVAILABLE", message: error instanceof ManagedFileError || error.code?.startsWith("DELIVERY_") ? error.message : "No se pudo completar la operación de entrega. Comprueba los archivos y el almacenamiento seguro." } } }; }
    });
    if (result.error) throw fail(result.error.code, result.error.message);
    return result.result;
  }
  context(data, evaluationId, cache = new Map()) {
    const batch = data.batches.find(batch => batch.snapshot.workers.some(worker => worker.evaluation_id === evaluationId));
    if (!batch) throw fail("DELIVERY_EVALUATION_MISSING");
    if (!cache.has("contacts")) cache.set("contacts", data.batches.flatMap(batch => batch.snapshot.workers));
    if (!cache.has(batch.id)) cache.set(batch.id, synchronizeRecipients(batch.snapshot.workers, cache.get("contacts")));
    const worker = cache.get(batch.id).find(worker => worker.evaluation_id === evaluationId);
    const text = applyNarrativeGreeting(worker.app_fields?.texto_final, batch.snapshot.greeting);
    const checks = getRecipientChecks(worker);
    const approval = hasValidClinicalApproval(worker, text) && worker.clinical_approval?.evaluation_id === evaluationId;
    const reference = worker.app_fields?.audio_record;
    const operation = reference && data.operations[`${evaluationId}:${reference.fingerprint}`];
    const reasons = [];
    if (!approval) reasons.push("Falta aprobación clínica vigente del texto exacto.");
    if (worker.validation?.has_errors) reasons.push("Errores clínicos bloqueantes.");
    for (const [key, reason] of [["formatValid", "Falta un telefono valido."], ["whatsapp", "Falta comprobar WhatsApp."], ["identity", "Falta verificar la identidad del destinatario."], ["consent", "Falta autorizacion vigente para este canal."], ["pdf", "Falta confirmar el PDF de esta evaluacion."], ["duplicateResolved", "Resuelve el conflicto de identidad del telefono compartido."]]) {
      if (!checks[key]) reasons.push(reason);
    }
    if (worker.app_fields?.mediweb_link_error) reasons.push(worker.app_fields.mediweb_link_error);
    if (!operation || operation.status !== "listo" || worker.app_fields?.audio_stale || worker.app_fields?.audio_status !== "listo") reasons.push("Falta MP3 vigente en el almacén cifrado.");
    if (operation?.status === "listo") {
      const expected = digest(JSON.stringify(audioFingerprintPayload(worker, text, operation.metadata?.configuration, operation.metadata?.tts_text)));
      if ((expected !== operation.fingerprint && !matchesApprovedAudio(worker, text, operation.metadata, operation.metadata?.configuration)) || operation.metadata?.text !== text || operation.metadata?.evaluation_id !== evaluationId) reasons.push("El MP3 no corresponde a esta versión, identidad o evaluación.");
    }
    const message = buildWhatsAppMessage(worker);
    const binding = digest({ evaluationId, batchId: batch.id, approval: worker.clinical_approval, recipient: recipientVersion(worker),
      authorization: worker.app_fields?.recipient_authorization, verification: worker.app_fields?.whatsapp_verification,
      conflict: worker.app_fields?.phone_analysis?.signature, text, greeting: batch.snapshot.greeting,
      operation: operation?.id, audio_sha256: operation?.sha256, configuration: operation?.metadata?.configuration, message });
    return { batch, worker, text, checks, approval, operation, reasons, message, binding };
  }
  latest(data, evaluationId) { return [...data.deliveries].reverse().find(record => record.evaluation_id === evaluationId); }
  publicRecord(record) {
    if (!record) return null;
    return { id: record.id, state: record.pending ? "incierta" : record.state, reason: record.reason || (record.pending ? "Acción interrumpida o en curso: no repetir sin conciliación." : ""),
      confirmations: record.confirmations, prepared_at: record.prepared_at, completed_at: record.completed_at, events: record.events,
      message: record.message, phone: record.phone, recipient_name: record.recipient_name, pdf: record.pdf ? { name: "PDF de esta evaluación", sha256: record.pdf.sha256 } : null,
      mp3: record.mp3 ? { name: "MP3 de esta evaluación", sha256: record.mp3.sha256 } : null };
  }
  invalidate(record, reason) {
    if (!record || ["completada", "cancelada"].includes(record.state)) return;
    record.state = exposed(record) ? "incierta" : "invalidada"; record.reason = reason;
  }
  async list() {
    const cache = new Map();
    return this.transaction(async data => { const rows = data.batches.flatMap(batch => batch.snapshot.workers.map(original => {
      const context = this.context(data, original.evaluation_id, cache), record = this.latest(data, original.evaluation_id);
      if (record?.binding && (context.binding !== record.binding || context.reasons.length)) this.invalidate(record, context.reasons.join(" ") || "Cambió el contenido, la identidad o la autorización de la preparación.");
      return { evaluation_id: original.evaluation_id, batch_id: batch.id, name: getWhatsAppRecipientName(original), phone: context.checks.formatValid ? context.worker.datos_operativos.telefono : "Inválido o ausente",
        checks: context.checks, approval: context.approval, binding: context.binding, audio: Boolean(context.operation?.status === "listo" && !context.worker.app_fields?.audio_stale),
        pdf: context.checks.pdf, reasons: context.reasons, delivery: this.publicRecord(record) };
    }));
      for (const row of rows) {
        const record = this.latest(data, row.evaluation_id);
        // publicRecord also labels an in-flight intent "incierta". Polling must
        // not delete a valid attachment while that action is still settling.
        if (["invalidada", "incierta"].includes(record?.state)) await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]);
      }
      return { rows };
    });
  }
  async detail(evaluationId) {
    return this.transaction(data => { const context = this.context(data, evaluationId); return { worker: context.worker, greeting: context.batch.snapshot.greeting, audio_configuration: context.operation?.metadata?.configuration, binding: context.binding, reasons: context.reasons }; });
  }
  checkConfiguration(context, configuration) {
    if (digest(configuration || null) !== digest(context.operation?.metadata?.configuration || null)) throw fail("DELIVERY_CONFIGURATION_CHANGED", "Cambió la configuración de voz. Comprueba la vigencia del MP3 desde el panel de audio.");
  }
  async validateFiles(record) {
    if (!record.pdf || !record.mp3) throw fail("DELIVERY_NOT_PREPARED");
    for (const [part, extension] of [["pdf", ".pdf"], ["mp3", ".mp3"]]) {
      const file = await this.managedFiles.inspectFile(record[part].id, extension);
      if (file.sha256 !== record[part].sha256) throw fail("DELIVERY_FILE_CHANGED", "Un archivo cambió después de preparar la entrega. No se reutiliza la preparación.");
    }
  }
  async checked(data, record, configuration) {
    const context = this.context(data, record.evaluation_id);
    if (context.reasons.length || context.binding !== record.binding) {
      await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]);
      this.invalidate(record, context.reasons.join(" ") || "La versión de la entrega cambió."); throw fail("DELIVERY_STALE", record.reason);
    }
    this.checkConfiguration(context, configuration);
    try { await this.validateFiles(record); }
    catch (error) { await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]); this.invalidate(record, "Archivo ausente, modificado o sin protección comprobable."); throw error; }
    const latest = this.context(data, record.evaluation_id);
    if (latest.reasons.length || latest.binding !== record.binding) { this.invalidate(record, "La autorización venció o cambió durante la comprobación."); throw fail("DELIVERY_STALE", record.reason); }
    return context;
  }
  prepare(body) {
    if (this.preparing.has(body.evaluationId)) return this.preparing.get(body.evaluationId);
    const promise = this.prepareOnce(body).finally(() => this.preparing.delete(body.evaluationId));
    this.preparing.set(body.evaluationId, promise); return promise;
  }
  async prepareOnce({ evaluationId, expectedBinding, configuration }) {
    const reserved = await this.transaction(data => {
      const context = this.context(data, evaluationId);
      if (context.reasons.length || context.binding !== expectedBinding) throw fail("DELIVERY_BLOCKED", context.reasons.join(" ") || "Cambió la evaluación seleccionada.");
      this.checkConfiguration(context, configuration);
      const previous = this.latest(data, evaluationId);
      if (previous?.state === "completada") throw fail("DELIVERY_ALREADY_COMPLETED", "Ya existe una entrega completada. Reabrir exige motivo y confirmación explícitos.");
      if (previous?.pending || previous?.state === "incierta") throw fail("DELIVERY_UNCERTAIN", "Concilia la entrega incierta antes de repetir acciones.");
      if (previous && exposed(previous) && previous.binding !== context.binding) { this.invalidate(previous, "Cambió una entrega con acciones previas."); throw fail("DELIVERY_UNCERTAIN"); }
      const historical = data.deliveries.find(record => record.evaluation_id !== evaluationId && record.source_evaluation_key === context.worker.source_evaluation_key && record.state !== "cancelada");
      if (historical) throw fail("DELIVERY_ENCOUNTER_DUPLICATE", "Esta atención tiene una entrega en otro registro. Revisa el historial antes de repetirla.");
      if (previous?.state === "listo" && previous.binding === context.binding) return { id: previous.id, reused: true };
      const record = (previous?.binding === context.binding || !previous?.binding) && previous && ["cancelada", "preparando"].includes(previous.state) ? previous : {
        id: randomUUID(), batch_id: context.batch.id, evaluation_id: evaluationId, source_evaluation_key: context.worker.source_evaluation_key,
        confirmations: {}, events: [], created_at: new Date().toISOString(), binding: context.binding, configuration,
      };
      if (!data.deliveries.includes(record)) data.deliveries.push(record);
      record.binding = context.binding; record.configuration = configuration;
      record.state = "preparando"; record.reason = ""; return { id: record.id, reused: false };
    });
    try {
      return await this.transaction(async (data, store) => {
        const record = data.deliveries.find(record => record.id === reserved.id), context = this.context(data, evaluationId);
        if (record.state === "cancelada") return this.publicRecord(record);
        if (context.binding !== record.binding || context.reasons.length) throw fail("DELIVERY_STALE");
        if (reserved.reused) { await this.checked(data, record, configuration); return this.publicRecord(record); }
        const pdf = await this.managedFiles.inspectFile(context.worker.datos_operativos.archivo_pdf_completo_id, ".pdf");
        const previousPin = [...data.deliveries].reverse().find(value => value.evaluation_id === evaluationId && value.pdf);
        if (previousPin && previousPin.pdf.sha256 !== pdf.sha256 && (previousPin.approval_id === context.worker.clinical_approval.approval_id || previousPin.authorization_token === digest(context.worker.app_fields?.recipient_authorization))) throw fail("DELIVERY_PDF_REVIEW_REQUIRED", "El PDF cambió: revisa y aprueba de nuevo el texto y reconfirma identidad, autorización y PDF antes de preparar otra entrega.");
        const identity = await this.inspectIdentity(pdf.bytes), workerId = context.worker.identificacion;
        if (new Set(identity.documentNumbers || [identity.numeroDocumento]).size !== 1 ||
          (identity.evaluationDates || [identity.fechaEvaluacion]).some(date => dateKey(date) !== dateKey(workerId.fecha_evaluacion)) ||
          String(identity.numeroDocumento).replace(/\W/g, "") !== String(workerId.numero_documento || workerId.dni || "").replace(/\W/g, "") ||
          !dateKey(workerId.fecha_evaluacion) || dateKey(identity.fechaEvaluacion) !== dateKey(workerId.fecha_evaluacion) ||
          (workerId.n_ficha && String(identity.nFicha) !== String(workerId.n_ficha))) throw fail("DELIVERY_PDF_IDENTITY", "El documento, fecha o ficha del PDF no coincide inequívocamente con la evaluación.");
        const audio = await store.readAudioFile(context.operation);
        if (digest(audio.bytes) !== context.operation.sha256) throw fail("DELIVERY_AUDIO_CORRUPT");
        const exported = await this.managedFiles.saveMp3(audio.bytes, `Entrega_${record.id}.mp3`);
        const mp3 = await this.managedFiles.inspectFile(exported.id, ".mp3");
        if (mp3.sha256 !== context.operation.sha256) throw fail("DELIVERY_AUDIO_CORRUPT");
        const current = this.context(data, evaluationId);
        if (current.reasons.length || current.binding !== record.binding) throw fail("DELIVERY_STALE", "La autorización venció o cambió durante la preparación.");
        record.pdf = { id: pdf.id, sha256: pdf.sha256 }; record.mp3 = { id: mp3.id, sha256: mp3.sha256 };
        record.phone = context.checks.formatValid ? String(context.worker.app_fields.whatsapp_confirmed_phone) : "";
        record.recipient_name = getWhatsAppRecipientName(context.worker);
        record.message = context.message; record.state = "listo"; record.prepared_at = new Date().toISOString();
        record.approval_id = context.worker.clinical_approval.approval_id; record.authorization_token = digest(context.worker.app_fields?.recipient_authorization);
        record.events.push({ action: "preparada", at: record.prepared_at });
        return this.publicRecord(record);
      });
    } catch (error) {
      await this.transaction(data => { const record = data.deliveries.find(record => record.id === reserved.id); this.invalidate(record, error.message); return null; }).catch(() => {});
      throw error;
    }
  }
  async begin({ id, kind, configuration }) {
    if (!["conversation", "message", "pdf", "mp3"].includes(kind)) throw fail("DELIVERY_INVALID_ACTION");
    return this.transaction(async data => {
      const record = data.deliveries.find(value => value.id === id);
      if (!record || record.pending || record.state !== "listo") throw fail("DELIVERY_UNCERTAIN");
      await this.checked(data, record, configuration);
      if (kind !== "conversation" && !record.events.some(event => event.action === "conversation")) throw fail("DELIVERY_CONVERSATION_REQUIRED", "Abre primero la conversación del destinatario seleccionado.");
      if (record.confirmations[kind]) throw fail("DELIVERY_PART_ALREADY_SENT", "Este elemento ya está confirmado; no se prepara un envío duplicado.");
      record.pending = { id: randomUUID(), kind, at: new Date().toISOString() };
      return { intent: record.pending.id, phone: record.phone, message: kind === "message" ? record.message : undefined };
    });
  }
  async settle({ id, intent, success, configuration }) {
    return this.transaction(async data => {
      const record = data.deliveries.find(value => value.id === id);
      if (!record?.pending || record.pending.id !== intent) throw fail("DELIVERY_ACTION_CHANGED");
      const kind = record.pending.kind;
      try { await this.checked(data, record, configuration); }
      catch (error) { record.state = "incierta"; throw error; }
      record.pending = null;
      if (success !== true) { record.state = "incierta"; record.reason = "No se pudo comprobar el resultado de la acción. Concilia antes de repetir."; }
      else record.events.push({ action: kind, at: new Date().toISOString() });
      return this.publicRecord(record);
    });
  }
  async reveal(body) {
    if (!["pdf", "mp3"].includes(body.kind)) throw fail("DELIVERY_INVALID_ACTION");
    const begun = await this.begin(body);
    try {
      await this.transaction(async data => {
        const record = data.deliveries.find(record => record.id === body.id);
        if (record.pending?.id !== begun.intent) throw fail("DELIVERY_ACTION_CHANGED");
        await this.checked(data, record, body.configuration);
        const pin = record[body.kind]; await this.managedFiles.revealPinned(pin.id, pin.sha256, `.${body.kind === "pdf" ? "pdf" : "mp3"}`); return null;
      });
      return await this.settle({ ...body, intent: begun.intent, success: true });
    } catch (error) { await this.settle({ ...body, intent: begun.intent, success: false }).catch(() => {}); throw error; }
  }
  async confirm({ id, part, confirmed, configuration }) {
    if (!sentParts.includes(part) || confirmed !== true) throw fail("DELIVERY_CONFIRMATION_REQUIRED");
    return this.transaction(async data => {
      const record = data.deliveries.find(record => record.id === id);
      if (!record || record.pending || record.state !== "listo") throw fail("DELIVERY_UNCERTAIN");
      await this.checked(data, record, configuration);
      if (!record.events.some(event => event.action === "conversation") || !record.events.some(event => event.action === part)) throw fail("DELIVERY_PREPARATION_REQUIRED", "Abre la conversación y prepara este elemento antes de declarar su envío.");
      if (record.confirmations[part]) return this.publicRecord(record);
      if (part === "pdf" || part === "mp3") await this.managedFiles.releaseTemporary?.([record[part]?.id]);
      record.confirmations[part] = new Date().toISOString();
      record.events.push({ action: "confirm", part, at: record.confirmations[part], evidence: "declaracion_operador" });
      return this.publicRecord(record);
    });
  }
  async uncertain({ id, confirmed, configuration }) {
    if (confirmed !== true) throw fail("DELIVERY_CONFIRMATION_REQUIRED");
    return this.transaction(async data => {
      const record = data.deliveries.find(record => record.id === id);
      if (!record || record.pending || record.state !== "listo") throw fail("DELIVERY_UNCERTAIN");
      await this.checked(data, record, configuration);
      record.state = "incierta";
      record.reason = "El operador declaró un envío parcial o incierto. Comprueba el chat antes de continuar.";
      record.events.push({ action: "resultado_incierto", at: new Date().toISOString(), evidence: "declaracion_operador" });
      await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]);
      return this.publicRecord(record);
    });
  }
  async complete({ id, confirmed, allParts, configuration }) {
    return this.transaction(async data => {
      const record = data.deliveries.find(record => record.id === id);
      if (record?.state === "completada") return this.publicRecord(record);
      if (record && !record.pending && record.state === "listo" && confirmed === true && allParts === true) {
        await this.checked(data, record, configuration);
        if (!["conversation", ...sentParts].every(part => record.events.some(event => event.action === part))) throw fail("DELIVERY_PREPARATION_REQUIRED");
        const at = new Date().toISOString();
        for (const part of sentParts) {
          if (!record.confirmations[part]) {
            record.confirmations[part] = at;
            record.events.push({ action: "confirm", part, at, evidence: "declaracion_operador_conjunta" });
          }
        }
      }
      if (!record || record.pending || record.state !== "listo" || confirmed !== true || !sentParts.every(part => record.confirmations[part])) throw fail("DELIVERY_CONFIRMATION_REQUIRED");
      await this.checked(data, record, configuration);
      await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]);
      record.state = "completada"; record.completed_at = new Date().toISOString();
      record.events.push({ action: "completada", at: record.completed_at, evidence: "declaracion_operador" }); return this.publicRecord(record);
    });
  }
  async cancel({ evaluationId }) {
    return this.transaction(async data => {
      const record = this.latest(data, evaluationId);
      if (!record || exposed(record) || Object.keys(record.confirmations).length || record.state === "completada") throw fail("DELIVERY_RECONCILIATION_REQUIRED");
      await this.managedFiles.releaseTemporary?.([record.pdf?.id, record.mp3?.id]);
      record.state = "cancelada"; record.events.push({ action: "cancelada", at: new Date().toISOString() }); return this.publicRecord(record);
    });
  }
  async reopen({ id, reason, confirmed }) {
    return this.transaction(data => {
      const record = data.deliveries.find(record => record.id === id);
      if (record?.state !== "completada" || confirmed !== true || String(reason || "").trim().length < 5) throw fail("DELIVERY_REPEAT_REASON_REQUIRED");
      if (this.latest(data, record.evaluation_id)?.id !== id) throw fail("DELIVERY_ALREADY_REOPENED");
      data.deliveries.push({ id: randomUUID(), evaluation_id: record.evaluation_id, batch_id: record.batch_id, source_evaluation_key: record.source_evaluation_key,
        state: "cancelada", confirmations: {}, events: [{ action: "reapertura", at: new Date().toISOString(), reason: String(reason).trim().slice(0, 500), previous_id: id }] });
      return { ok: true };
    });
  }
  async reconcile({ id, outcomes, reason, confirmed, configuration }) {
    if (confirmed !== true || String(reason || "").trim().length < 5 || !sentParts.every(part => ["enviado", "no_enviado", "incierto"].includes(outcomes?.[part]))) throw fail("DELIVERY_RECONCILIATION_REQUIRED");
    return this.transaction(async data => {
      const record = data.deliveries.find(record => record.id === id);
      if (!record || (!record.pending && record.state !== "incierta")) throw fail("DELIVERY_NOT_UNCERTAIN");
      if (sentParts.some(part => outcomes[part] === "incierto")) throw fail("DELIVERY_STILL_UNCERTAIN", "El resultado sigue incierto; no se habilitan reenvíos.");
      if (sentParts.some(part => outcomes[part] === "enviado")) await this.checked(data, record, configuration);
      if (sentParts.some(part => record.confirmations[part] && outcomes[part] !== "enviado")) throw fail("DELIVERY_HISTORY_CONFLICT", "No se puede borrar una confirmación anterior.");
      record.pending = null;
      for (const part of sentParts) {
        if (record.confirmations[part] && outcomes[part] !== "enviado") throw fail("DELIVERY_HISTORY_CONFLICT", "No se puede borrar una confirmación anterior.");
        if (outcomes[part] === "enviado") record.confirmations[part] ||= new Date().toISOString();
      }
      record.state = sentParts.every(part => outcomes[part] === "no_enviado") ? "cancelada" : "listo";
      record.reason = ""; record.events.push({ action: "conciliacion", at: new Date().toISOString(), outcomes, reason: String(reason).trim().slice(0, 500), evidence: "declaracion_operador" });
      return this.publicRecord(record);
    });
  }
}
