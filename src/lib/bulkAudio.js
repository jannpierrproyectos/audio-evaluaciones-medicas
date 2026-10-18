import { getAudioAuthorization } from "./clinicalApproval.js";
import { audioFingerprint, canonical, sha256 } from "./evaluationPersistence.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";
import { prepareTextForTts } from "../clinical/ttsNormalizer.js";

export const TARIFF_SOURCE = "https://help.elevenlabs.io/hc/en-us/articles/21811236079505-How-do-I-find-the-model-ID";
export function estimateCredits(characters, configuration) {
  if (configuration.provider !== "elevenlabs") return { characters, credits: null, source: TARIFF_SOURCE };
  const rates = { eleven_flash_v2: 0.5, eleven_flash_v2_5: 0.5, eleven_turbo_v2: 0.5, eleven_turbo_v2_5: 0.5, eleven_multilingual_v2: 1 };
  const rate = rates[configuration.model];
  return { characters, credits: rate === undefined ? null : characters * rate, rate, source: TARIFF_SOURCE, verified: "2026-10-17" };
}

export function approvalToken(worker) {
  return JSON.stringify(canonical({ approval: worker.clinical_approval, authorization: worker.app_fields?.recipient_authorization,
    whatsapp: worker.app_fields?.whatsapp_verification }));
}

export function audioBlockers(worker, text) {
  const state = getAudioAuthorization(worker, text);
  const reasons = [];
  if (state.approval !== "aprobada") reasons.push("Falta aprobación clínica vigente");
  if (state.validation === "bloqueada") reasons.push("Errores clínicos bloqueantes");
  if (state.recipient !== "confirmada") reasons.push("Destinatario, WhatsApp, identidad, autorización o PDF pendientes");
  if (worker.app_fields?.audio_status === "generando") reasons.push("Solicitud en curso");
  if (worker.app_fields?.audio_status === "incierto") reasons.push("Resultado incierto: requiere conciliación, sin reintento automático");
  return reasons;
}

export async function planBulkAudio(snapshot, configuration, repository) {
  const items = [];
  for (const worker of snapshot.workers) {
    const text = applyNarrativeGreeting(worker.app_fields?.texto_final, snapshot.greeting);
    const reasons = audioBlockers(worker, text);
    const fingerprint = await audioFingerprint(worker, text, configuration);
    let reusable = false;
    if (!reasons.length) {
      const operation = await repository.request({ action: "operation", evaluationId: worker.evaluation_id, fingerprint });
      reusable = operation.status === "listo" && JSON.stringify(canonical(operation.metadata?.configuration)) === JSON.stringify(canonical(configuration));
      if (operation.status === "solicitado") reasons.push("Resultado incierto: requiere conciliación");
    }
    items.push({ evaluation_id: worker.evaluation_id, fingerprint, token: await sha256(approvalToken(worker)),
      status: reasons.length ? "bloqueado" : "pendiente", reusable, reason: reasons.join(". "),
      characters: prepareTextForTts(text).length });
  }
  const characters = items.filter(item => item.status === "pendiente" && !item.reusable).reduce((sum, item) => sum + item.characters, 0);
  return { id: crypto.randomUUID(), batch_id: snapshot.batch_id, configuration, status: "preparada", items,
    estimate: estimateCredits(characters, configuration), concurrency: 1, created_at: new Date().toISOString() };
}

// A recovered queue never starts paid work by itself. The operation journal, not the
// UI status, decides whether a previously dispatched item can be recovered.
export function recoverBulkQueue(queue, workers) {
  if (!queue) return null;
  return { ...queue, status: "pausada", items: queue.items.map(item => {
    if (item.status !== "generando") return item;
    const worker = workers.find(value => value.evaluation_id === item.evaluation_id);
    return { ...item, status: worker?.app_fields?.audio_status === "listo" && !worker.app_fields.audio_stale && worker.app_fields.audio_record?.fingerprint === item.fingerprint ? "completado" : "incierto",
      reason: "Solicitud interrumpida; comprueba su resultado antes de repetir." };
  }) };
}

export class BulkAudioRunner {
  constructor({ getSnapshot, save, run, configuration }) {
    Object.assign(this, { getSnapshot, save, run, configuration });
    this.active = new Set(); this.running = false; this.stopped = false;
    this.tail = Promise.resolve();
  }
  change(change) {
    const result = this.tail.then(async () => {
      const snapshot = this.getSnapshot();
      if (!snapshot || snapshot.batch_id !== this.batchId || snapshot.bulk_audio_queue?.id !== this.queueId) throw new Error("El lote cambió; cola detenida.");
      await this.save(change(snapshot.bulk_audio_queue));
    });
    this.tail = result.catch(() => { this.stopped = true; });
    return result;
  }
  async start(queue) {
    if (this.running) return;
    this.running = true; this.stopped = false; this.batchId = queue.batch_id; this.queueId = queue.id;
    try {
      await this.change(value => ({ ...value, status: "ejecutando" }));
      const concurrency = Math.min(3, Math.max(1, Number(queue.concurrency) || 1));
      await Promise.all(Array.from({ length: concurrency }, () => this.consume()));
      await this.change(value => ({ ...value, status: value.status === "ejecutando" ? "terminada" : value.status }));
    } finally { this.running = false; }
  }
  async consume() {
    while (!this.stopped) {
      const queue = this.getSnapshot()?.bulk_audio_queue;
      if (queue?.id !== this.queueId || queue.status !== "ejecutando") return;
      const item = queue.items.find(value => value.status === "pendiente" && !this.active.has(value.evaluation_id));
      if (!item) return;
      this.active.add(item.evaluation_id);
      try {
        await this.change(value => ({ ...value, items: value.items.map(entry => entry.evaluation_id === item.evaluation_id ? { ...entry, status: "generando", reason: "", started_at: new Date().toISOString(), attempts: (entry.attempts || 0) + 1 } : entry) }));
        if (this.stopped) { await this.finish(item, this.getSnapshot()?.bulk_audio_queue?.status === "pausada" ? "pendiente" : "cancelado", "No se solicitó TTS."); return; }
        const snapshot = this.getSnapshot();
        const worker = snapshot.workers.find(value => value.evaluation_id === item.evaluation_id);
        const text = applyNarrativeGreeting(worker?.app_fields?.texto_final, snapshot.greeting);
        if (!worker || audioBlockers(worker, text).length || await sha256(approvalToken(worker)) !== item.token ||
          await audioFingerprint(worker, text, this.configuration) !== item.fingerprint) {
          await this.finish(item, "bloqueado", "Cambió el contenido o la autorización. Prepara una nueva estimación."); continue;
        }
        const result = await this.run(item, text, this.configuration);
        await this.finish(item, result?.stale ? "bloqueado" : result?.reused ? "reutilizado" : "completado", result?.stale ? "Audio obsoleto: cambió el contenido o la autorización." : "");
      } catch (error) {
        const worker = this.getSnapshot()?.workers.find(value => value.evaluation_id === item.evaluation_id);
        await this.finish(item, worker?.app_fields?.audio_status === "incierto" || ["STORE_AUDIO_UNCERTAIN", "TTS_UNCERTAIN"].includes(error.code) ? "incierto" : "error", "Operación detenida. No se reintenta automáticamente.").catch(() => {});
      } finally { this.active.delete(item.evaluation_id); }
    }
  }
  finish(item, status, reason) {
    return this.change(value => ({ ...value, items: value.items.map(entry => entry.evaluation_id === item.evaluation_id ? { ...entry, status, reason, finished_at: new Date().toISOString() } : entry) }));
  }
  pause() { this.stopped = true; return this.change(value => ({ ...value, status: "pausada" })); }
  cancel() { this.stopped = true; return this.change(value => ({ ...value, status: "cancelada", items: value.items.map(item => item.status === "pendiente" ? { ...item, status: "cancelado" } : item) })); }
}
