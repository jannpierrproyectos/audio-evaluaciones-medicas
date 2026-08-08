import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelMediwebJob,
  checkMediwebHealth,
  createMediwebJob,
  detectMediwebEvaluations,
  getMediwebErrorMessage,
  getMediwebJob,
  openMediweb,
} from "../services/mediwebService.js";
import { importMediwebPdfIntoExistingFlow } from "../lib/importMediwebPdf.js";
import {
  EMPTY_MEDIWEB_ADVANCED_OPTIONS,
  createNewImportSnapshot,
  createSingleFlight,
  deriveMediwebPhase,
  focusPdfResults,
  getMediwebCompletionSummary,
  getMediwebStartLabel,
} from "../lib/mediwebUiState.js";

const MODES = [
  {
    value: "first",
    label: "Preparar para AudioEvaluaciones",
    description: "Obtiene las primeras hojas elegibles y las carga directamente en este sistema.",
  },
  {
    value: "full",
    label: "Reportes completos",
    description: "Genera un PDF completo por trabajador y lo guarda localmente.",
  },
  {
    value: "both",
    label: "Ambos",
    description: "Prepara las primeras hojas y también guarda los reportes completos.",
  },
];

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function parseOptionalPositiveInteger(value, label) {
  if (String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} debe ser un entero mayor o igual a 1.`);
  return parsed;
}

function buildJobOptions(mode, advancedOptions) {
  return {
    mode,
    limit: parseOptionalPositiveInteger(advancedOptions.limit, "Máximo de evaluaciones"),
    maxPages: advancedOptions.singlePage
      ? null
      : parseOptionalPositiveInteger(advancedOptions.maxPages, "Máximo de páginas"),
    perPageLimit: parseOptionalPositiveInteger(advancedOptions.perPageLimit, "Máximo por página"),
    singlePage: advancedOptions.singlePage,
  };
}

function pluralize(count, singular, plural) {
  return Number(count) === 1 ? singular : plural;
}

function DetectionSummary({ summary }) {
  const excludedTotal = Object.values(summary.excluded || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  return (
    <section className="mediweb-detection is-compact" aria-label="Evaluaciones encontradas">
      <div className="mediweb-stats">
        <div><span>Detectadas</span><strong>{summary.detected}</strong></div>
        <div><span>Elegibles</span><strong>{summary.eligible}</strong></div>
        <div><span>Excluidas</span><strong>{excludedTotal}</strong></div>
      </div>
      <p className="mediweb-breakdown-line">
        {summary.excluded?.observado || 0} observadas · {summary.excluded?.pendiente || 0} pendientes · {summary.excluded?.noApto || 0} no aptas · {summary.excluded?.otros || 0} otros
      </p>
    </section>
  );
}

function JobMetrics({ job }) {
  return (
    <div className="mediweb-progress-grid">
      <div><span>Página actual</span><strong>{job.currentPage || "—"}</strong></div>
      <div><span>Detectadas</span><strong>{job.detected || 0}</strong></div>
      <div><span>Elegibles</span><strong>{job.eligible || 0}</strong></div>
      <div><span>Procesadas</span><strong>{job.processed || 0}</strong></div>
      <div><span>Primeras hojas</span><strong>{job.firstPagesAdded || 0}</strong></div>
      <div><span>Reportes completos</span><strong>{job.fullReportsGenerated || 0}</strong></div>
      <div><span>Errores</span><strong>{job.errors || 0}</strong></div>
    </div>
  );
}

export default function MediwebImporter({ onPdfSelected }) {
  const [connectorStatus, setConnectorStatus] = useState("checking");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [detectionSummary, setDetectionSummary] = useState(null);
  const [mode, setMode] = useState("first");
  const [advancedOptions, setAdvancedOptions] = useState({ ...EMPTY_MEDIWEB_ADVANCED_OPTIONS });
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [feedback, setFeedback] = useState("Comprobando el conector MediWeb…");
  const [formError, setFormError] = useState("");
  const [detectionError, setDetectionError] = useState(false);
  const [importCompleted, setImportCompleted] = useState(false);
  const [importedWorkerCount, setImportedWorkerCount] = useState(0);
  const [showImportedDetails, setShowImportedDetails] = useState(false);
  const requestControllers = useRef(new Set());
  const importGuard = useRef(createSingleFlight());

  const createTrackedController = useCallback(() => {
    const controller = new AbortController();
    requestControllers.current.add(controller);
    return controller;
  }, []);

  const releaseController = useCallback((controller) => {
    requestControllers.current.delete(controller);
  }, []);

  const checkHealth = useCallback(async (signal) => {
    const localController = signal ? null : createTrackedController();
    const requestSignal = signal || localController.signal;
    setConnectorStatus("checking");
    setFeedback("Comprobando el conector MediWeb…");
    try {
      const health = await checkMediwebHealth({ signal: requestSignal });
      if (!health?.ok) throw new Error("El conector no confirmó su estado.");
      setConnectorStatus("connected");
      setBrowserOpen(Boolean(health.browserOpen));
      setFeedback("Conector MediWeb conectado.");
    } catch (error) {
      if (error?.code === "REQUEST_ABORTED") return;
      console.error("Error comprobando MediWeb Connector:", error);
      setConnectorStatus(["NETWORK_ERROR", "CONNECTOR_UNAVAILABLE"].includes(error?.code) ? "disconnected" : "error");
      setFeedback("Para importar directamente desde MediWeb, AudioEvaluaciones Connector debe estar activo en esta computadora.");
    } finally {
      if (localController) releaseController(localController);
    }
  }, [createTrackedController, releaseController]);

  useEffect(() => {
    const controller = new AbortController();
    const timerId = setTimeout(() => checkHealth(controller.signal), 0);
    return () => {
      clearTimeout(timerId);
      controller.abort();
    };
  }, [checkHealth]);

  useEffect(() => () => {
    for (const controller of requestControllers.current) controller.abort();
    requestControllers.current.clear();
  }, []);

  useEffect(() => {
    if (!jobId) return undefined;
    let disposed = false;
    let timerId = null;
    let controller = null;

    async function poll() {
      controller = new AbortController();
      try {
        const nextJob = await getMediwebJob(jobId, { signal: controller.signal });
        if (disposed) return;
        setJobProgress(nextJob);
        if (nextJob.status === "completed") setFeedback("Procesamiento completado.");
        else if (nextJob.status === "cancelled") setFeedback("Procesamiento cancelado. Los archivos ya generados fueron conservados.");
        else if (nextJob.status === "failed") setFeedback("El procesamiento se detuvo. Los archivos ya generados fueron conservados.");
        if (!TERMINAL_STATUSES.has(nextJob.status)) timerId = setTimeout(poll, 1000);
      } catch (error) {
        if (disposed || error?.code === "REQUEST_ABORTED") return;
        console.error("Error consultando el procesamiento MediWeb:", error);
        if (error?.code === "JOB_NOT_FOUND") {
          setJobId(null);
          setJobProgress(null);
          setFeedback("El conector fue reiniciado. Puedes iniciar un nuevo procesamiento.");
          checkHealth();
          return;
        }
        setFeedback(getMediwebErrorMessage(error));
        timerId = setTimeout(poll, 1000);
      }
    }

    poll();
    return () => {
      disposed = true;
      if (timerId !== null) clearTimeout(timerId);
      controller?.abort();
    };
  }, [checkHealth, jobId]);

  async function handleOpen() {
    const controller = createTrackedController();
    setPendingAction("open");
    setFeedback(browserOpen ? "Volviendo a MediWeb…" : "Abriendo MediWeb…");
    try {
      await openMediweb({ signal: controller.signal });
      setBrowserOpen(true);
      setFeedback("En MediWeb, inicia sesión, entra a Atenciones → Ocupacional y realiza la búsqueda.");
    } catch (error) {
      if (error?.code !== "REQUEST_ABORTED") {
        console.error("Error abriendo MediWeb:", error);
        setFeedback(getMediwebErrorMessage(error));
        checkHealth();
      }
    } finally {
      releaseController(controller);
      setPendingAction("");
    }
  }

  async function handleDetect() {
    const controller = createTrackedController();
    setPendingAction("detect");
    setDetectionError(false);
    setFeedback("Leyendo resultados de MediWeb…");
    try {
      const result = await detectMediwebEvaluations({ signal: controller.signal });
      setBrowserOpen(true);
      setDetectionSummary(result);
      setJobId(null);
      setJobProgress(null);
      setImportCompleted(false);
      setFeedback(`${result.detected} evaluaciones detectadas; ${result.eligible} elegibles.`);
    } catch (error) {
      if (error?.code !== "REQUEST_ABORTED") {
        console.error("Error detectando evaluaciones de MediWeb:", error);
        setBrowserOpen(true);
        setDetectionError(true);
        setFeedback("No fue posible leer los resultados. Comprueba que la tabla esté visible en MediWeb y vuelve a intentarlo.");
      }
    } finally {
      releaseController(controller);
      setPendingAction("");
    }
  }

  async function handleStartJob() {
    setFormError("");
    let options;
    try {
      options = buildJobOptions(mode, advancedOptions);
    } catch (error) {
      setFormError(error.message);
      return;
    }
    const controller = createTrackedController();
    setPendingAction("start");
    setFeedback("Iniciando el procesamiento…");
    try {
      const created = await createMediwebJob(options, { signal: controller.signal });
      setJobId(created.jobId);
      setImportCompleted(false);
      setJobProgress({
        id: created.jobId,
        status: "running",
        mode,
        currentPage: 0,
        detected: 0,
        unique: 0,
        eligible: 0,
        excluded: 0,
        selected: 0,
        processed: 0,
        firstPagesAdded: 0,
        fullReportsGenerated: 0,
        errors: 0,
      });
      setFeedback("Procesamiento iniciado.");
    } catch (error) {
      if (error?.code !== "REQUEST_ABORTED") {
        console.error("Error iniciando el procesamiento MediWeb:", error);
        setFeedback(getMediwebErrorMessage(error));
      }
    } finally {
      releaseController(controller);
      setPendingAction("");
    }
  }

  async function handleCancel() {
    if (!jobId || !window.confirm("¿Cancelar el procesamiento de forma segura?")) return;
    const controller = createTrackedController();
    setPendingAction("cancel");
    setFeedback("Cancelando de forma segura…");
    try {
      const cancelled = await cancelMediwebJob(jobId, { signal: controller.signal });
      setJobProgress(cancelled);
      setFeedback("Procesamiento cancelado. Los archivos ya generados fueron conservados.");
    } catch (error) {
      if (error?.code !== "REQUEST_ABORTED") {
        console.error("Error cancelando el procesamiento MediWeb:", error);
        setFeedback(getMediwebErrorMessage(error));
      }
    } finally {
      releaseController(controller);
      setPendingAction("");
    }
  }

  async function handleImportPdf() {
    if (!jobId || importGuard.current.active) return;
    await importGuard.current.run(async () => {
      const controller = createTrackedController();
      setPendingAction("import");
      setFeedback("Cargando evaluaciones…");
      try {
        const { processingResult } = await importMediwebPdfIntoExistingFlow(jobId, onPdfSelected, { signal: controller.signal });
        if (!processingResult) throw new Error("No se pudo procesar el PDF de primeras hojas.");
        const workerCount = processingResult?.workers?.length ?? jobProgress?.firstPagesAdded ?? 0;
        setImportedWorkerCount(workerCount);
        setImportCompleted(true);
        setShowImportedDetails(false);
        setFeedback("Evaluaciones cargadas correctamente.");
        focusPdfResults();
      } catch (error) {
        if (error?.code !== "REQUEST_ABORTED") {
          console.error("Error cargando primeras hojas de MediWeb:", error);
          setFeedback(getMediwebErrorMessage(error));
        }
      } finally {
        releaseController(controller);
        setPendingAction("");
      }
    });
  }

  function handleNewImport() {
    const snapshot = createNewImportSnapshot(browserOpen);
    setDetectionSummary(snapshot.detectionSummary);
    setJobId(snapshot.jobId);
    setJobProgress(snapshot.jobProgress);
    setMode(snapshot.mode);
    setAdvancedOptions(snapshot.advancedOptions);
    setImportCompleted(snapshot.importCompleted);
    setImportedWorkerCount(snapshot.importedWorkerCount);
    setDetectionError(false);
    setShowImportedDetails(false);
    setFormError("");
    setPendingAction("");
    setFeedback(snapshot.feedback);
  }

  const phase = deriveMediwebPhase({ connectorStatus, browserOpen, detectionSummary, jobProgress, importCompleted });
  const completionSummary = jobProgress?.status === "completed"
    ? getMediwebCompletionSummary(jobProgress)
    : null;
  const openLabel = browserOpen ? "Volver a MediWeb" : "Abrir MediWeb";
  const detecting = pendingAction === "detect";
  const importing = pendingAction === "import";

  return (
    <section className={`panel mediweb-panel phase-${phase}`} aria-labelledby="mediweb-title">
      <div className="panel__header mediweb-panel__header">
        <div>
          <p className="section-label">Importar desde MediWeb</p>
          <h2 id="mediweb-title">Conector MediWeb</h2>
          {phase === "ready" ? <p className="section-text">Importa evaluaciones directamente desde MediWeb.</p> : null}
        </div>
        <div className={`connector-status is-${connectorStatus}`}>
          <span aria-hidden="true">{connectorStatus === "connected" ? "●" : connectorStatus === "checking" ? "◌" : "○"}</span>
          <span>{connectorStatus === "checking" ? "Comprobando" : connectorStatus === "connected" ? "Conectado" : "No disponible"}</span>
        </div>
      </div>

      <div className="mediweb-live-region" aria-live="polite" aria-atomic="true">{feedback}</div>

      {phase === "checking" ? <div className="mediweb-empty-state"><p>Comprobando el conector MediWeb…</p></div> : null}

      {phase === "connector_unavailable" ? (
        <div className="mediweb-empty-state is-unavailable">
          <div><h3>Conector MediWeb no disponible</h3><p>Para importar directamente desde MediWeb, AudioEvaluaciones Connector debe estar activo en esta computadora.</p></div>
          <button type="button" className="secondary-button" onClick={() => checkHealth()} disabled={connectorStatus === "checking"}>Reintentar</button>
        </div>
      ) : null}

      {phase === "ready" ? (
        <div className="mediweb-primary-step">
          <button type="button" className="primary-button" onClick={handleOpen} disabled={pendingAction === "open"}>{pendingAction === "open" ? "Abriendo…" : "Abrir MediWeb"}</button>
        </div>
      ) : null}

      {phase === "mediweb_open" ? (
        <div className="mediweb-primary-step">
          <p>En MediWeb, inicia sesión, entra a Atenciones → Ocupacional y realiza la búsqueda.</p>
          <div className="mediweb-actions">
            <button type="button" className="secondary-button" onClick={handleOpen} disabled={Boolean(pendingAction)}>{pendingAction === "open" ? "Abriendo…" : openLabel}</button>
            <button type="button" className="primary-button" onClick={handleDetect} disabled={Boolean(pendingAction)}>{detecting ? "Leyendo resultados…" : detectionError ? "Reintentar detección" : "Detectar evaluaciones"}</button>
          </div>
          <details className="mediweb-help"><summary>¿Cómo preparar MediWeb?</summary><ol><li>Inicia sesión.</li><li>Entra a Atenciones → Ocupacional.</li><li>Selecciona filtros y pulsa Buscar.</li><li>Regresa aquí para detectar las evaluaciones.</li></ol></details>
        </div>
      ) : null}

      {phase === "detected" ? (
        <div className="mediweb-configuration">
          <div className="mediweb-detected-header">
            <DetectionSummary summary={detectionSummary} />
            <div className="mediweb-actions">
              <button type="button" className="secondary-button" onClick={handleOpen} disabled={Boolean(pendingAction)}>{openLabel}</button>
              <button type="button" className="secondary-button is-quiet" onClick={handleDetect} disabled={Boolean(pendingAction)}>{detecting ? "Actualizando…" : detectionError ? "Reintentar detección" : "Actualizar detección"}</button>
            </div>
          </div>

          <fieldset className="mediweb-modes">
            <legend>¿Qué deseas preparar?</legend>
            {MODES.map((option) => (
              <label key={option.value} className={`mediweb-mode${mode === option.value ? " is-selected" : ""}${option.value === "first" ? " is-primary-mode" : ""}`}>
                <input type="radio" name="mediweb-mode" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </label>
            ))}
          </fieldset>

          <details className="mediweb-advanced">
            <summary>Opciones avanzadas <small>Normalmente no necesitas cambiar estas opciones.</small></summary>
            <div className="mediweb-advanced__grid">
              <label><span>Máximo de evaluaciones</span><input type="number" min="1" value={advancedOptions.limit} onChange={(event) => setAdvancedOptions((current) => ({ ...current, limit: event.target.value }))} /></label>
              <label><span>Máximo de páginas</span><input type="number" min="1" value={advancedOptions.maxPages} onChange={(event) => setAdvancedOptions((current) => ({ ...current, maxPages: event.target.value }))} disabled={advancedOptions.singlePage} /></label>
              <label><span>Máximo por página</span><input type="number" min="1" value={advancedOptions.perPageLimit} onChange={(event) => setAdvancedOptions((current) => ({ ...current, perPageLimit: event.target.value }))} /></label>
              <label className="mediweb-checkbox"><input type="checkbox" checked={advancedOptions.singlePage} onChange={(event) => setAdvancedOptions((current) => ({ ...current, singlePage: event.target.checked, maxPages: event.target.checked ? "" : current.maxPages }))} /><span>Solo página actual</span></label>
            </div>
          </details>

          {formError ? <p className="inline-feedback is-error" role="alert">{formError}</p> : null}
          <button type="button" className="primary-button mediweb-start-button" onClick={handleStartJob} disabled={Boolean(pendingAction) || detectionSummary.eligible < 1}>{pendingAction === "start" ? "Iniciando…" : getMediwebStartLabel(mode)}</button>
        </div>
      ) : null}

      {phase === "processing" ? (
        <section className="mediweb-job is-running" aria-label="Procesamiento MediWeb">
          <div className="mediweb-job__header"><div><p className="section-label">Procesamiento MediWeb</p><h3>Procesando MediWeb</h3></div><span className="job-status-badge is-running">En curso</span></div>
          <div className="indeterminate-progress" aria-hidden="true"><span /></div>
          <JobMetrics job={jobProgress} />
          <button type="button" className="mediweb-cancel-button" onClick={handleCancel} disabled={pendingAction === "cancel"}>{pendingAction === "cancel" ? "Cancelando…" : "Cancelar"}</button>
        </section>
      ) : null}

      {phase === "completed" ? (
        <section className="mediweb-job is-completed mediweb-outcome" aria-label="Procesamiento completado">
          <div className="mediweb-job__header"><div><p className="section-label">Resultado MediWeb</p><h3>{completionSummary.title}</h3></div><span className="job-status-badge is-completed">Completado</span></div>
          <p>{completionSummary.message}</p>
          <JobMetrics job={jobProgress} />
          <div className="mediweb-outcome-actions">
            {completionSummary.canImport ? <button type="button" className="primary-button" onClick={handleImportPdf} disabled={importing}>{importing ? "Cargando evaluaciones…" : "Procesar en AudioEvaluaciones"}</button> : null}
            <button type="button" className="secondary-button is-quiet" onClick={handleNewImport} disabled={importing}>Nueva importación</button>
          </div>
        </section>
      ) : null}

      {phase === "failed" || phase === "cancelled" ? (
        <section className={`mediweb-job is-${phase} mediweb-outcome`} aria-label="Procesamiento detenido">
          <div><p className="section-label">Resultado MediWeb</p><h3>{phase === "failed" ? "Procesamiento detenido" : "Procesamiento cancelado"}</h3></div>
          <p>{phase === "failed" ? "El procesamiento se detuvo. Los archivos ya generados fueron conservados." : "Los archivos ya generados fueron conservados."}</p>
          <JobMetrics job={jobProgress} />
          <div className="mediweb-outcome-actions">
            {phase === "failed" ? <button type="button" className="primary-button" onClick={handleStartJob} disabled={Boolean(pendingAction)}>Reintentar</button> : null}
            <button type="button" className="secondary-button is-quiet" onClick={handleNewImport}>Nueva importación</button>
          </div>
        </section>
      ) : null}

      {phase === "imported" ? (
        <section className="mediweb-imported-summary" aria-label="Importación desde MediWeb completada">
          <div><p className="section-label">Importación completada</p><h3>Importación desde MediWeb completada</h3><p>{importedWorkerCount} {pluralize(importedWorkerCount, "trabajador cargado", "trabajadores cargados")}.</p></div>
          <div className="mediweb-outcome-actions"><button type="button" className="secondary-button is-quiet" onClick={() => setShowImportedDetails((current) => !current)} aria-expanded={showImportedDetails}>{showImportedDetails ? "Ocultar detalles" : "Ver detalles"}</button><button type="button" className="primary-button" onClick={handleNewImport}>Nueva importación</button></div>
          {showImportedDetails ? <JobMetrics job={jobProgress} /> : null}
        </section>
      ) : null}
    </section>
  );
}
