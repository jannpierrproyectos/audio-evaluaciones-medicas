import { flowSummary } from "../lib/operationalFlow.js";
import { useRef, useState } from "react";
import { BulkAudioRunner, audioBlockers, planBulkAudio } from "../lib/bulkAudio.js";
import { getTtsConfiguration } from "../lib/evaluationPersistence.js";
import { applyNarrativeGreeting } from "../lib/narrativeGreeting.js";

export default function BulkAudioPanel({ analysis, repository, getSnapshot, saveQueue, runAudio, storageFailed, onSelectWorker, onDeliver, compact = false }) {
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
  const reviewed = flowSummary(analysis).approved;
  const existing = flowSummary(analysis).audio;
  const resumePending = queue?.status === "pausada" && pending > 0;
  const showGenerate = !reviewed || reviewed > existing || active || resumePending;
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
      else if (action === "pause") await saveQueue({ ...queue, status: "pausada" });
      else if (action === "cancel") await saveQueue({ ...queue, status: "cancelada", items: queue.items.map(item => item.status === "pendiente" ? { ...item, status: "cancelado" } : item) });
    }
    catch { setMessage("No se guardó el control de cola. Mantén esta ventana abierta."); }
  }
  return <section className={`bulk-audio-panel${compact ? " is-compact" : ""}`} aria-label="Generación masiva de audios">
    <div className="stage-heading"><div><p className="section-label">Siguiente paso</p><h2>Convertir en audio</h2></div><p>{reviewed} textos aprobados · {existing} MP3 guardados</p></div>
    <div className="button-row">
      {showGenerate && <button type="button" className={existing >= eligible && existing ? "secondary-button" : "primary-button"} disabled={busy || active || storageFailed || !eligible} onClick={start}>{resumePending ? "Continuar generación masiva" : "Generar audios masivos"}</button>}
      {onDeliver && existing > 0 && <button type="button" className="primary-button" onClick={onDeliver}>Continuar con envíos</button>}
      {active && <button type="button" className="secondary-button" onClick={() => control("pause")}>Pausar generación</button>}
    </div>
    <p className="muted-text">{eligible ? "Solo se convierten textos aprobados. Los MP3 guardados se reutilizan; WhatsApp no bloquea el audio." : "Revisa y aprueba cada texto para habilitar su audio."}</p>
    {queue && <>
      <progress aria-label="Progreso de generación" value={done} max={items.length || 1} />
      <p aria-live="polite">Completados: {count("completado")} · Reutilizados: {count("reutilizado")} · Pendientes: {pending} · Generando: {inFlight}{count("bloqueado") + count("error") + count("incierto") > 0 ? ` · Por resolver: ${count("bloqueado") + count("error") + count("incierto")}` : ""}</p>
      <details><summary>Estado por evaluación y consumo</summary>
        <p>{queue.estimate.characters} caracteres · {queue.estimate.credits === null ? "Tarifa no disponible para este servicio" : `${queue.estimate.credits} créditos base estimados`}. Los audios existentes no vuelven a sintetizarse.</p>
        <label>Audios simultáneos <select aria-label="Audios simultáneos" disabled={active || busy || storageFailed} value={queue.concurrency} onChange={event => saveQueue({ ...queue, concurrency: Number(event.target.value) }).catch(() => setMessage("No se guardo la concurrencia."))}>
          <option value={1}>1 (recomendado)</option><option value={2}>2</option><option value={3}>3</option>
        </select></label>
        <button type="button" disabled={!pending || storageFailed} onClick={() => control("cancel")}>Cancelar pendientes</button>
        <p>Las solicitudes iniciadas terminan y se guardan. Una cola recuperada espera tu acción para continuar.</p>
        <ul className="bulk-audio-items">{items.map(item => {
          const worker = analysis.workers.find(value => value.evaluation_id === item.evaluation_id);
          return <li key={item.evaluation_id}>{worker?.identificacion?.nombres} {worker?.identificacion?.apellidos}: {item.status}{item.reason && <span> · {item.reason}</span>}
            {worker && <button type="button" onClick={() => onSelectWorker(analysis.workers.indexOf(worker))}>Ver evaluación</button>}
          </li>;
        })}</ul>
      </details>
    </>}
    {!queue && !compact && <p>{analysis.workers.length - eligible} evaluaciones pendientes de revision clinica.</p>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
