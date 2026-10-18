import { useCallback, useEffect, useRef, useState } from "react";
import { getMediwebJob, processingAction } from "../services/mediwebService.js";
import { importMediwebPdfIntoExistingFlow } from "../lib/importMediwebPdf.js";
import { batchCounts } from "../lib/evaluationPersistence.js";
import { isWhatsAppConfirmed } from "../lib/whatsappMessage.js";

const messages = {
  SESSION_EXPIRED: "La sesión expiró. Inicia sesión y prepara la búsqueda en la ventana de MediWeb.",
  SEARCH_MANUAL_REQUIRED: "Prepara la búsqueda en MediWeb y confirma los resultados antes de continuar.",
  SEARCH_INTERFACE_CHANGED: "La búsqueda guardada no coincide con esta interfaz. Usa la búsqueda manual y vuelve a confirmarla.",
  SEARCH_RESULTS_MISMATCH: "La tabla no coincide con los filtros confirmados. Revisa la búsqueda manualmente.",
  SEARCH_NOT_CONFIRMED: "No se pudo comprobar la respuesta de la búsqueda. Revisa MediWeb manualmente.",
  SEARCH_CONFIRMATION_CHANGED: "La tabla o los filtros cambiaron desde tu confirmación. Vuelve a comprobarlos y confirma nuevamente.",
  PROCESS_UNCERTAIN: "Hay una descarga interrumpida de resultado incierto. Recupera sus resultados; no se repetirá automáticamente.",
  PROCESS_ALREADY_DOWNLOADED: "Esta búsqueda se solapa con un proceso anterior. Recupera sus resultados o prepara una búsqueda que no repita esas atenciones.",
  OUTPUT_PROTECTION_UNAVAILABLE: "No se pudo proteger la carpeta de descarga con EFS. No se escribieron nuevos resultados clínicos; revisa Windows con soporte.",
};

export default function IntegratedProcessing({ onPdfSelected, onBatchStarted, onRestoreBatch, analysis, connected, onOpen }) {
  const [state, setState] = useState(null);
  const [runId, setRunId] = useState(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [job, setJob] = useState(null);
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [manualToken, setManualToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false), imported = useRef(new Set());
  const callbacks = useRef({ onPdfSelected, onBatchStarted, onRestoreBatch });
  useEffect(() => { callbacks.current = { onPdfSelected, onBatchStarted, onRestoreBatch }; }, [onPdfSelected, onBatchStarted, onRestoreBatch]);
  const refresh = useCallback(async () => {
    const result = await processingAction("status"); setState(result); return result;
  }, []);
  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    processingAction("status").then(result => {
      if (disposed) return;
      setState(result);
      const pending = [...result.runs].reverse().find(run => !run.batch_id);
      if (pending) setRunId(pending.id);
    }).catch(() => { if (!disposed) setMessage("Actualiza el Connector para usar el procesamiento completo."); });
    return () => { disposed = true; };
  }, [connected]);

  useEffect(() => {
    if (!runId) return;
    let disposed = false, timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const status = await processingAction("status", {}, { signal: controller.signal });
        if (disposed) return;
        setState(status);
        const run = status.runs.find(value => value.id === runId);
        if (!run) throw new Error("No se localizó el proceso. No lo reinicies sin comprobar el Connector.");
        const currentJob = run.job || await getMediwebJob(runId, { signal: controller.signal });
        if (disposed) return;
        setJob(currentJob);
        if (run.status === "running") { timer = setTimeout(poll, 1000); return; }
        if (imported.current.has(runId)) return;
        imported.current.add(runId);
        setBusy(true);
        try {
          if (run.batch_id) {
            const restored = await callbacks.current.onRestoreBatch(run.batch_id);
            if (!restored?.batch_id) throw new Error("No se pudo recuperar el lote guardado. Revisa el almacenamiento; no se repitieron descargas.");
            if (!disposed) setMessage("Lote recuperado sin repetir descargas ni solicitar voz.");
          } else if (currentJob.firstPagesAdded > 0) {
            const { processingResult } = await importMediwebPdfIntoExistingFlow(runId, (file, options) => callbacks.current.onPdfSelected(file, { ...options, processingRunId: runId }), { signal: controller.signal });
            if (!processingResult?.batch_id) throw new Error("No se completó la extracción. Recupera el proceso para volver a leer sus PDF sin descargarlos.");
            await processingAction("complete", { id: runId, batchId: processingResult.batch_id });
            if (!disposed) setMessage(run.status === "completed" ? "Lote procesado y guardado. Revisa destinatarios y aprueba las narrativas antes de generar audio." : `${messages[currentJob.errorCode] || ""} Resultados parciales recuperados. Las incidencias pendientes requieren revisión; no se repitieron descargas.`);
          } else if (!disposed) setMessage(messages[currentJob.errorCode] || messages[run.status === "uncertain" ? "PROCESS_UNCERTAIN" : "SEARCH_MANUAL_REQUIRED"]);
        } catch (error) {
          if (!disposed) setMessage(`${error.message} Usa Recuperar proceso para volver a leer los archivos guardados.`);
        }
        finally { if (!disposed) setBusy(false); }
      } catch (error) {
        if (!disposed) { setMessage(messages[error.code] || error.message); timer = setTimeout(poll, 4000); }
      }
    }
    poll(); return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [runId, recoveryAttempt]);

  async function start() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setMessage("");
    try {
      const created = await processingAction("start", { profileId: profileId || null, manualConfirmed: confirmed, manualToken });
      if (!created.reused) callbacks.current.onBatchStarted?.();
      imported.current.delete(created.id); setRunId(created.id);
      if (created.id === runId) setRecoveryAttempt(value => value + 1);
      await refresh();
    } catch (error) { setMessage(messages[error.code] || error.message); await refresh().catch(() => {}); }
    finally { setBusy(false); guard.current = false; }
  }
  async function saveProfile() {
    setBusy(true);
    try { const result = await processingAction("profile", { name, confirmed, manualToken }); await refresh(); setProfileId(result.id); setMessage("Búsqueda confirmada guardada de forma cifrada."); }
    catch (error) { setMessage(messages[error.code] || "Esta búsqueda necesita preparación manual; no se guardaron selectores desconocidos."); }
    finally { setBusy(false); }
  }
  const counts = batchCounts(analysis);
  return <section aria-label="Procesamiento completo MediWeb" className="bulk-audio-panel">
    <h3>Procesamiento completo</h3>
    <p>Connector: {connected ? "conectado" : "no disponible"} · Sesión: {state?.authentication === "expired" ? "expirada" : state?.authentication === "results_visible" ? "resultados visibles" : "sin determinar"}</p>
    <label>Búsqueda <select aria-label="Búsqueda guardada" disabled={busy || job?.status === "running"} value={profileId} onChange={event => { setProfileId(event.target.value); setConfirmed(false); }}>
      <option value="">Preparada manualmente en MediWeb</option>{state?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select></label>
    <label><input type="checkbox" disabled={busy || job?.status === "running"} checked={confirmed} onChange={async event => {
      if (!event.target.checked) { setConfirmed(false); setManualToken(null); return; }
      setBusy(true); setConfirmed(true); setManualToken(null);
      try { const result = await processingAction("confirm"); setManualToken(result.token); setConfirmed(true); }
      catch (error) { setConfirmed(false); setMessage(messages[error.code] || "No se pudo confirmar la tabla. Prepara la búsqueda en MediWeb."); }
      finally { setBusy(false); }
    }} /> Confirmo que los filtros y resultados visibles corresponden a la búsqueda esperada</label>
    <div className="button-row"><button type="button" className="primary-button" disabled={!connected || busy || job?.status === "running"} onClick={start}>Iniciar procesamiento completo</button>
      <button type="button" disabled={busy || !connected} onClick={onOpen}>Preparar búsqueda en MediWeb</button>
      {job?.status === "running" && <button type="button" onClick={async () => { try { await processingAction("cancel", { id: runId }); } catch { setMessage("Comprueba el estado del proceso; no se iniciará otro trabajo."); } }}>Cancelar procesamiento</button>}
    </div>
    <details><summary>Guardar la búsqueda confirmada</summary><label>Nombre de búsqueda <input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><button type="button" disabled={!confirmed || busy || job?.status === "running"} onClick={saveProfile}>Guardar búsqueda confirmada</button><p>Solo se guardan controles reconocidos de fecha, empresa y tipo de examen. El acceso y los cambios de interfaz requieren intervención.</p></details>
    {job && <p aria-live="polite">Descarga: {job.status} · Página: {job.currentPage || 0} · Detectadas: {job.detected || 0} · Procesadas: {job.processed || 0} · Primeras hojas: {job.firstPagesAdded || 0} · PDF completos: {job.fullReportsGenerated || 0} · Incidencias: {job.errors || 0}</p>}
    {busy && <p role="status">Preparando o extrayendo evaluaciones…</p>}
    <p>Evaluaciones del lote: {counts.total} · Pendientes de revisión: {counts.pendientes} · Pendientes de WhatsApp: {analysis?.workers.filter(worker => !isWhatsAppConfirmed(worker)).length || 0} · Audios disponibles: {counts.audios} · Audios pendientes: {Math.max(0, counts.total - counts.audios)}</p>
    {analysis && <a href="#pdf-workers-results">Ir a revisión, verificación rápida y generación masiva</a>}
    {message && <p role="status">{message}</p>}
    {!!state?.runs.length && <details><summary>Recuperar procesos anteriores</summary>{[...state.runs].reverse().map(run => <div key={run.id}><p>{run.status} · {run.job?.processed || 0} procesadas <button type="button" disabled={busy || job?.status === "running"} onClick={() => { imported.current.delete(run.id); if (run.id === runId) setRecoveryAttempt(value => value + 1); else setRunId(run.id); }}>Recuperar proceso</button></p>
      {run.batch_ids.length > 1 && <p>Las evaluaciones ya existentes conservan su lote, aprobación y audio originales. {run.batch_ids.map((id, index) => <button key={id} type="button" disabled={busy || job?.status === "running"} onClick={() => callbacks.current.onRestoreBatch(id)}>Ver lote relacionado {index + 1}</button>)}</p>}
    </div>)}</details>}
    <p>Este flujo no aprueba narrativas ni inicia TTS. Las descargas inciertas se concilian desde sus archivos guardados.</p>
  </section>;
}
