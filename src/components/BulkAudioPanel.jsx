import { useRef, useState } from "react";
import { BulkAudioRunner, audioBlockers, planBulkAudio } from "../lib/bulkAudio.js";
import { getTtsConfiguration } from "../lib/evaluationPersistence.js";
import { applyNarrativeGreeting } from "../lib/narrativeGreeting.js";

export default function BulkAudioPanel({ analysis, repository, getSnapshot, saveQueue, runAudio, storageFailed, onSelectWorker, onDeliver }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const runner = useRef(null);
  const starting = useRef(false);
  const queue = analysis.bulk_audio_queue;
  const items = queue?.items || [];
  const count = status => items.filter(item => item.status === status).length;
  const inFlight = count("generando");
  const active = queue?.status === "ejecutando" || inFlight > 0;
  const pending = count("pendiente");
  const done = items.filter(item => !["pendiente", "generando"].includes(item.status)).length;
  const eligible = analysis.workers.filter(worker => !audioBlockers(worker, applyNarrativeGreeting(worker.app_fields?.texto_final, analysis.greeting)).length).length;
  const existing = analysis.workers.filter(worker => worker.app_fields?.audio_record && !worker.app_fields.audio_stale && worker.clinical_approval?.status === "aprobada").length;
  async function start() {
    if (starting.current || active || runner.current?.running || storageFailed) return;
    starting.current = true; setBusy(true); setMessage("");
    try {
      let prepared = queue;
      if (!prepared || prepared.status !== "pausada") {
        const configuration = await getTtsConfiguration();
        const snapshot = getSnapshot();
        if (snapshot?.batch_id !== analysis.batch_id) throw new Error("El lote cambió.");
        prepared = await planBulkAudio(snapshot, configuration, repository);
        await saveQueue(prepared);
      }
      const instance = new BulkAudioRunner({ getSnapshot, save: saveQueue, run: runAudio, configuration: prepared.configuration });
      runner.current = instance;
      await instance.start(prepared);
    } catch (error) { setMessage(error.message || "Cola detenida. Comprueba el almacenamiento antes de continuar."); }
    finally { starting.current = false; setBusy(false); }
  }
  async function control(action) {
    try {
      if (runner.current) await runner.current[action]();
      else if (action === "cancel") await saveQueue({ ...queue, status: "cancelada", items: queue.items.map(item => item.status === "pendiente" ? { ...item, status: "cancelado" } : item) });
    }
    catch { setMessage("No se guardó el control de cola. Mantén esta ventana abierta."); }
  }
  return <section className="bulk-audio-panel" aria-label="Generación masiva de audios">
    <div className="stage-heading"><div><p className="section-label">Contenido aprobado</p><h2>Audios del lote</h2></div></div>
    <div className="process-metrics"><div><strong>{existing}</strong><span>MP3 guardados</span></div><div><strong>{eligible}</strong><span>textos aprobados</span></div><div><strong>{analysis.workers.length - eligible}</strong><span>por revisar</span></div></div>
    <div className="button-row"><button type="button" className="primary-button" disabled={busy || active || storageFailed || !eligible} onClick={start}>{queue?.status === "pausada" ? "Continuar generación masiva" : "Generar audios masivos"}</button>
    {onDeliver && <button type="button" className="secondary-button" onClick={onDeliver}>Preparar entregas</button>}</div>
    <p className="muted-text">{eligible ? "Los MP3 vigentes se reutilizan. WhatsApp no bloquea la generacion." : "Revisa y aprueba cada texto antes de generar audio."}</p>
    {!queue && <div className="audio-evaluation-list">{analysis.workers.map((worker, index) => <div key={worker.evaluation_id}>
      <span><strong>{worker.identificacion?.nombres} {worker.identificacion?.apellidos}</strong><small>{worker.app_fields?.audio_record && !worker.app_fields.audio_stale ? "MP3 guardado" : worker.clinical_approval?.status === "aprobada" ? "Texto aprobado" : "Revision clinica pendiente"}</small></span>
      <button type="button" className="secondary-button" onClick={() => onSelectWorker(index)}>{worker.app_fields?.audio_record && !worker.app_fields.audio_stale ? "Ver MP3" : "Revisar texto"}</button>
    </div>)}</div>}
    {queue && <>
      <p>Cola: {queue.status} · Reutilizables: {items.filter(item => item.reusable && item.status !== "bloqueado").length} · Nuevos: {items.filter(item => !item.reusable && item.status === "pendiente").length}</p>
      <p>{queue.estimate.characters} caracteres preparados para TTS · {queue.estimate.credits === null ? "Créditos: tarifa no disponible para este servicio/modelo" : `${queue.estimate.credits} créditos base estimados (${queue.estimate.rate} por carácter)`}.</p>
      <div className="button-row">
        <button type="button" disabled={queue.status !== "ejecutando"} onClick={() => control("pause")}>Pausar generación</button>
        <button type="button" disabled={!pending || storageFailed} onClick={() => control("cancel")}>Cancelar pendientes</button>
      </div>
      <progress aria-label="Progreso de generación" value={done} max={items.length || 1} />
      <p aria-live="polite">Pendientes: {pending} · Generando: {inFlight} · Completados: {count("completado")} · Reutilizados: {count("reutilizado")} · Bloqueados: {count("bloqueado")} · Errores: {count("error")} · Inciertos: {count("incierto")} · Cancelados: {count("cancelado")}</p>
      <details><summary>Detalles de consumo y ejecucion</summary>
      <p><a href={queue.estimate.source} target="_blank" rel="noreferrer">Tarifa base oficial</a> · Verificada el 17/10/2026. No incluye multiplicadores de voz ni representa el cargo exacto de la cuenta.</p>
      <label>Audios simultáneos <select aria-label="Audios simultáneos" disabled={active || busy || storageFailed} value={queue.concurrency} onChange={event => saveQueue({ ...queue, concurrency: Number(event.target.value) }).catch(() => setMessage("No se guardó la concurrencia."))}>
        <option value={1}>1 (recomendado)</option><option value={2}>2</option><option value={3}>3</option>
      </select></label>
      <p>Las solicitudes iniciadas terminan y se guardan; pausar o cancelar no revierte su consumo. Al recuperar el lote, continúa solo tras confirmación.</p>
      <p>Consumo observado de la cuenta: no disponible en el contrato actual del servicio TTS. La estimación corresponde al lote preparado inicialmente.</p>
      </details>
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
