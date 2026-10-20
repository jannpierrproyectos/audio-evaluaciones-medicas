import { useEffect, useRef, useState } from "react";
import { getMediwebJob, processingAction } from "../services/mediwebService.js";
import { importMediwebPdfIntoExistingFlow } from "../lib/importMediwebPdf.js";
import { recoveryDiagnostic, recoveryDescription, recoveryError, reportRecoveryDiagnostic } from "../lib/batchRecovery.js";

const problems = {
  SESSION_EXPIRED: "Abre MediWeb e inicia sesión para continuar.",
  SEARCH_MANUAL_REQUIRED: "Prepara la búsqueda en la ventana de MediWeb abierta por el Connector y vuelve a intentarlo.",
  SEARCH_TABLE_NOT_FOUND: "No se reconoció la tabla en la ventana de MediWeb del Connector. Abre allí Atenciones → Ocupacional y muestra los resultados.",
  SEARCH_NO_RESULTS: "La tabla de MediWeb está abierta, pero no contiene reportes disponibles para importar.",
  SEARCH_MULTIPLE_RESULTS: "Hay varias pestañas con resultados de MediWeb. Deja abierta solo la búsqueda que deseas procesar y reintenta.",
  SEARCH_RESULTS_MISMATCH: "Los resultados no corresponden a los filtros. Corrige la búsqueda en MediWeb y reintenta.",
  SEARCH_CONFIRMATION_CHANGED: "La búsqueda cambió mientras se comprobaba. Revisa los resultados y reintenta.",
  SEARCH_INTERFACE_CHANGED: "La búsqueda guardada no coincide con esta pantalla de MediWeb. Prepara otra búsqueda.",
  PROCESS_UNCERTAIN: "Hay una descarga interrumpida. Recupera sus archivos antes de iniciar otra.",
};

export default function IntegratedProcessing({ onPdfSelected, onBatchStarted, onRestoreBatch, analysis, connected, onOpen, onReview, nextActionLabel = "Verificar WhatsApp" }) {
  const [state, setState] = useState(null), [runId, setRunId] = useState(null);
  const [attempt, setAttempt] = useState(0), [job, setJob] = useState(null);
  const [profileId, setProfileId] = useState(""), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [newSearch, setNewSearch] = useState(false);
  const [recovery, setRecovery] = useState({ status: "idle" });
  const lock = useRef(false), openings = useRef(new Map());
  const callbacks = useRef({ onPdfSelected, onBatchStarted, onRestoreBatch });
  useEffect(() => { callbacks.current = { onPdfSelected, onBatchStarted, onRestoreBatch }; }, [onPdfSelected, onBatchStarted, onRestoreBatch]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    processingAction("status").then(result => {
      if (!active) return;
      setState(result);
    }).catch(error => {
      if (active) setNotice(`No se pudo leer el historial [${recoveryDiagnostic(error, "PROCESS_STATUS").code}].`);
    });
    return () => { active = false; };
  }, [connected]);

  useEffect(() => {
    if (!runId) return;
    let disposed = false, timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await processingAction("status", {}, { signal: controller.signal });
        if (disposed) return;
        setState(result);
        const run = result.runs.find(value => value.id === runId);
        if (!run) throw recoveryError("STORE_NOT_FOUND");
        const current = run.job || await getMediwebJob(runId, { signal: controller.signal });
        if (disposed) return;
        setJob(current);
        if (run.status === "running") { timer = setTimeout(poll, 600); return; }
        if (!openings.current.has(runId)) {
          openings.current.set(runId, (async () => {
            if (run.batch_id) return callbacks.current.onRestoreBatch(run.batch_id);
            if (!current.firstPagesAdded) throw recoveryError("BATCH_EMPTY");
            const imported = await importMediwebPdfIntoExistingFlow(runId, (file, options) => callbacks.current.onPdfSelected(file, { ...options, processingRunId: runId }));
            if (!imported.processingResult?.workers?.length) throw recoveryError("BATCH_EMPTY");
            await processingAction("complete", { id: runId, batchId: imported.processingResult.batch_id });
            // Verify the saved batch through the same opening path as recovery.
            return callbacks.current.onRestoreBatch(imported.processingResult.batch_id);
          })());
        }
        setRecovery({ status: "opening" });
        const opened = await openings.current.get(runId);
        if (!opened?.workers?.length || !opened.batch_id) throw recoveryError("BATCH_EMPTY");
        if (!disposed) setRecovery({ status: "available", count: opened.workers.length, batch_id: opened.batch_id });
      } catch (error) {
        if (!disposed) {
          const diagnostic = error.diagnostic || recoveryDiagnostic(error, "PROCESS_RECOVERY");
          reportRecoveryDiagnostic(diagnostic);
          setRecovery({ status: "error", diagnostic });
        }
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [runId, attempt]);

  async function start() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      // The existing Connector verifies filters/table and binds a short-lived
      // snapshot token. No extra declaration, clinical approval or consent.
      const proof = profileId ? null : await processingAction("confirm");
      const created = await processingAction("start", { profileId: profileId || null, manualConfirmed: !profileId, manualToken: proof?.token || null, requestId: crypto.randomUUID() });
      if (!created.reused) callbacks.current.onBatchStarted?.();
      openings.current.delete(created.id);
      setRecovery({ status: "idle" }); setJob(null); setRunId(created.id); setNewSearch(false);
      setAttempt(value => value + 1);
    } catch (error) {
      const code = Object.hasOwn(problems, error.code) ? error.code : recoveryDiagnostic(error, "PROCESS_START").code;
      setNotice(`${problems[error.code] || "No se pudo iniciar. Revisa la conexión y vuelve a intentarlo."} [${code}]`);
    } finally { setBusy(false); lock.current = false; }
  }
  function retry(id = runId) {
    openings.current.delete(id); setRecovery({ status: "idle" }); setRunId(id); setNewSearch(false); setAttempt(value => value + 1);
  }
  const run = state?.runs.find(value => value.id === runId);
  const running = run?.status === "running";
  const available = recovery.status === "available" && analysis?.batch_id === recovery.batch_id && analysis.workers.length > 0;
  const incidents = job?.errors || 0;
  const resultVisible = runId && !newSearch;
  return <section className="processing-workspace" aria-label="Procesamiento completo MediWeb">
    {resultVisible ? <>
      <div className={`process-result ${recovery.status === "error" ? "is-error" : available ? "is-ready" : "is-working"}`}>
        <div className="process-result__heading"><span className="process-icon" aria-hidden="true">{available ? "✓" : recovery.status === "error" ? "!" : "•"}</span><div>
          <p className="section-label">{available ? "Listo para revisión" : running ? "Importación en curso" : recovery.status === "error" ? "Recuperación pendiente" : "Abriendo lote"}</p>
          <h2>{available ? "Lote procesado y disponible" : running ? "Preparando tus evaluaciones" : recovery.status === "error" ? "Los archivos están descargados, pero el lote no pudo abrirse" : "Comprobando evaluaciones guardadas"}</h2>
        </div></div>
        <div className="process-metrics">
          <div><strong>{available ? analysis.workers.length : running ? job?.processed || 0 : job?.firstPagesAdded || 0}</strong><span>{available ? "evaluaciones disponibles" : running ? "evaluaciones procesadas" : "primeras hojas guardadas"}</span></div>
          <div><strong>{job?.fullReportsGenerated || 0}</strong><span>PDF completos guardados</span></div>
          <div><strong>{incidents}</strong><span>incidencias de descarga</span></div>
        </div>
        {running && <progress aria-label="Avance de importación" value={job?.processed || 0} max={Math.max(job?.detected || 8, job?.processed || 0, 1)} />}
        {recovery.status === "error" && <p className="process-error" role="alert">{recoveryDescription(recovery.diagnostic)} [{recovery.diagnostic.code}]. Los archivos se conservan; no se repetirán descargas.</p>}
        <div className="process-actions">
          {available ? <button type="button" className="primary-button" onClick={onReview}>{nextActionLabel}</button> : recovery.status === "error" ? <button type="button" className="primary-button" onClick={() => retry()}>Reintentar recuperación</button> : <span role="status">{running ? "Descargando y conservando documentos..." : "Abriendo las evaluaciones para comprobar su disponibilidad..."}</span>}
          {!running && <button type="button" className="secondary-button" onClick={() => setNewSearch(true)}>Otra búsqueda</button>}
          {running && <button type="button" onClick={async () => { await processingAction("cancel", { id: runId }); }}>Detener descarga</button>}
        </div>
      </div>
    </> : <div className="process-search">
      <div><p className="section-label">Nuevo lote</p><h2>Importar evaluaciones</h2><p>Prepara los resultados en la ventana de MediWeb abierta por el Connector.</p></div>
      <label>Búsqueda de MediWeb<select aria-label="Búsqueda guardada" disabled={busy} value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Resultados visibles en MediWeb</option>{state?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <div className="process-actions"><button type="button" className="primary-button" disabled={!connected || busy || running} onClick={start}>{busy ? "Comprobando resultados..." : "Procesar evaluaciones"}</button><button type="button" className="secondary-button" disabled={!connected || busy} onClick={onOpen}>Abrir MediWeb</button>{runId && <button type="button" onClick={() => setNewSearch(false)}>Volver al resultado</button>}</div>
      <details><summary>Guardar esta búsqueda</summary><label>Nombre de búsqueda<input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><button type="button" disabled={!name.trim() || busy} onClick={async () => {
        setBusy(true); try { const proof = await processingAction("confirm"); await processingAction("profile", { name, confirmed: true, manualToken: proof.token }); const next = await processingAction("status"); setState(next); setNotice("Búsqueda guardada."); } catch (error) { setNotice(`No se pudo guardar [${recoveryDiagnostic(error, "SEARCH_PROFILE").code}].`); } finally { setBusy(false); }
      }}>Guardar búsqueda</button></details>
    </div>}
    {notice && <p role="status" className="process-notice">{notice}</p>}
    {!!state?.runs.length && <details className="process-history"><summary>Historial de procesos ({state.runs.length})</summary><div className="process-history__list">{[...state.runs].reverse().map(value => <div key={value.id}><span>{value.job?.firstPagesAdded || 0} evaluaciones descargadas{value.availability?.diagnostic_code ? ` · ${value.availability.diagnostic_code}` : ""}</span><button type="button" disabled={busy || running} onClick={() => retry(value.id)}>Abrir lote guardado</button></div>)}</div></details>}
  </section>;
}
