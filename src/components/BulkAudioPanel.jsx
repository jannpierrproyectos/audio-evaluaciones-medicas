import { useRef, useState } from "react";
import { BulkAudioRunner, audioBlockers, planBulkAudio } from "../lib/bulkAudio.js";
import { getTtsConfiguration } from "../lib/evaluationPersistence.js";
import { applyNarrativeGreeting } from "../lib/narrativeGreeting.js";

export default function BulkAudioPanel({ analysis, repository, getSnapshot, refreshRecipients, saveQueue, runAudio, storageFailed, onSelectWorker }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const runner = useRef(null);
  const queue = analysis.bulk_audio_queue;
  const items = queue?.items || [];
  const count = status => items.filter(item => item.status === status).length;
  const inFlight = count("generando");
  const active = queue?.status === "ejecutando" || inFlight > 0;
  const pending = count("pendiente");
  const done = items.filter(item => !["pendiente", "generando"].includes(item.status)).length;
  const eligible = analysis.workers.filter(worker => !audioBlockers(worker, applyNarrativeGreeting(worker.app_fields?.texto_final, analysis.greeting)).length).length;
  async function prepare() {
    setBusy(true); setMessage("");
    try {
      await refreshRecipients();
      const configuration = await getTtsConfiguration();
      const snapshot = getSnapshot();
      if (snapshot?.batch_id !== analysis.batch_id) throw new Error("El lote cambió.");
      await saveQueue(await planBulkAudio(snapshot, configuration, repository));
      runner.current = null;
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!queue || active || runner.current?.running) return;
    if (!window.confirm(`Generar hasta ${pending} audios pendientes. ${queue.estimate.characters} caracteres nuevos; ${queue.estimate.credits === null ? "créditos no determinados" : `${queue.estimate.credits} créditos base estimados`}. Los multiplicadores de voz pueden aumentar el consumo. Las solicitudes iniciadas pueden consumir créditos aunque fallen. ¿Confirmas iniciar?`)) return;
    const instance = new BulkAudioRunner({ getSnapshot, save: saveQueue, run: runAudio, configuration: queue.configuration });
    runner.current = instance;
    try { await instance.start(queue); }
    catch { setMessage("Cola detenida: comprueba el almacenamiento y recupera el lote. No se repetirán solicitudes automáticamente."); }
  }
  async function control(action) {
    try {
      if (runner.current) await runner.current[action]();
      else if (action === "cancel") await saveQueue({ ...queue, status: "cancelada", items: queue.items.map(item => item.status === "pendiente" ? { ...item, status: "cancelado" } : item) });
    }
    catch { setMessage("No se guardó el control de cola. Mantén esta ventana abierta."); }
  }
  return <section className="bulk-audio-panel" aria-label="Generación masiva de audios">
    <h3>Audios del lote</h3>
    <p>Total: {analysis.workers.length} · Autorizados ahora: {eligible} · Bloqueados ahora: {analysis.workers.length - eligible}</p>
    <button type="button" disabled={busy || active || storageFailed} onClick={prepare}>Generar audios autorizados</button>
    <p>Primero se prepara la estimación; no se solicita audio hasta confirmar. El PDF manual sin destinatario conserva la generación local autorizada.</p>
    {queue && <>
      <p>Cola: {queue.status} · Reutilizables: {items.filter(item => item.reusable && item.status !== "bloqueado").length} · Nuevos: {items.filter(item => !item.reusable && item.status === "pendiente").length}</p>
      <p>{queue.estimate.characters} caracteres preparados para TTS · {queue.estimate.credits === null ? "Créditos: tarifa no disponible para este servicio/modelo" : `${queue.estimate.credits} créditos base estimados (${queue.estimate.rate} por carácter)`}.</p>
      <p><a href={queue.estimate.source} target="_blank" rel="noreferrer">Tarifa base oficial</a> · Verificada el 17/10/2026. No incluye multiplicadores de voz ni representa el cargo exacto de la cuenta.</p>
      <label>Audios simultáneos <select aria-label="Audios simultáneos" disabled={active || busy || storageFailed} value={queue.concurrency} onChange={event => saveQueue({ ...queue, concurrency: Number(event.target.value) }).catch(() => setMessage("No se guardó la concurrencia."))}>
        <option value={1}>1 (recomendado)</option><option value={2}>2</option><option value={3}>3</option>
      </select></label>
      <div className="button-row">
        <button type="button" disabled={active || !pending || storageFailed} onClick={start}>{queue.status === "pausada" ? "Continuar generación" : "Iniciar generación (confirmar)"}</button>
        <button type="button" disabled={queue.status !== "ejecutando"} onClick={() => control("pause")}>Pausar generación</button>
        <button type="button" disabled={!pending || storageFailed} onClick={() => control("cancel")}>Cancelar pendientes</button>
      </div>
      <p>Las solicitudes iniciadas terminan y se guardan; pausar o cancelar no revierte su consumo. Al recuperar el lote, continúa solo tras confirmación.</p>
      <p>Consumo observado de la cuenta: no disponible en el contrato actual del servicio TTS. La estimación corresponde al lote preparado inicialmente.</p>
      <progress aria-label="Progreso de generación" value={done} max={items.length || 1} />
      <p aria-live="polite">Pendientes: {pending} · Generando: {inFlight} · Completados: {count("completado")} · Reutilizados: {count("reutilizado")} · Bloqueados: {count("bloqueado")} · Errores: {count("error")} · Inciertos: {count("incierto")} · Cancelados: {count("cancelado")}</p>
      <ul className="bulk-audio-items">{items.map(item => {
        const worker = analysis.workers.find(value => value.evaluation_id === item.evaluation_id);
        const reasons = worker ? audioBlockers(worker, applyNarrativeGreeting(worker.app_fields?.texto_final, analysis.greeting)) : ["Evaluación ausente"];
        const available = worker?.app_fields?.audio_url && !worker.app_fields.audio_stale && !reasons.length;
        return <li key={item.evaluation_id}>{worker?.identificacion?.nombres} {worker?.identificacion?.apellidos}: {item.status}
          {(item.reason || reasons.length > 0) && <span> · {item.reason || reasons.join(". ")}</span>}
          {available && <button type="button" onClick={() => onSelectWorker(analysis.workers.indexOf(worker))}>Ver MP3</button>}
        </li>;
      })}</ul>
    </>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
