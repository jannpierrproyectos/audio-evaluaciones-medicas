import { EvaluationRepository, sha256, canonical, restoreWorker, recoverAudio, getTtsConfiguration, generatePersistentAudio, batchCounts, initialVerification } from "./lib/evaluationPersistence.js";
import { synthesizeAudioFromText } from "./lib/ttsClient.js";
import { requireTtsSession } from "./lib/ttsAccessClient.js";
import TtsSessionPanel from "./components/TtsSessionPanel.jsx";
import { validateManagedFile } from "./services/mediwebService.js";
import { reconcileWorkerReview } from "./lib/clinicalApproval.js";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import PdfWorkersPreview from "./components/PdfWorkersPreview.jsx";
import MediwebImporter from "./components/MediwebImporter.jsx";
import { analyzePdfBatch } from "./lib/data/pdf/analyzePdfBatch.js";
import { attachMediwebWorkerMetadata } from "./lib/importMediwebPdf.js";
import {
  MEDIWEB_SOURCE_MODE,
  PDF_SOURCE_MODE,
  prepareAnalysisForReview,
  prepareInitialNarratives,
} from "./lib/workerReviewUx.js";
import { revokeBatchAudioObjectUrls } from "./lib/batchState.js";
import { DEFAULT_NARRATIVE_GREETING } from "./lib/narrativeGreeting.js";
import { synchronizeRecipients, recordWhatsAppDecision } from "./lib/whatsappReview.js";
import BulkAudioPanel from "./components/BulkAudioPanel.jsx";
import { approvalToken, recoverBulkQueue } from "./lib/bulkAudio.js";
import { audioFingerprint } from "./lib/evaluationPersistence.js";
import DeliveryInbox from "./components/DeliveryInbox.jsx";

function App() {
  const [pdfPreview, setPdfPreview] = useState("");
  const [pdfAnalysis, setPdfAnalysis] = useState(null);
  const [selectedPdfWorkerIndex, setSelectedPdfWorkerIndex] = useState(null);
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [pdfSource, setPdfSource] = useState("mediweb");
  const [mediwebActivated, setMediwebActivated] = useState(true);
  const [greeting, setGreeting] = useState(DEFAULT_NARRATIVE_GREETING);
  const batchOperationIdRef = useRef(0);
  const [repository] = useState(() => new EvaluationRepository());
  const currentAnalysisRef = useRef(null);
  const [savedBatches, setSavedBatches] = useState([]);
  const [storageMessage, setStorageMessage] = useState("Comprobando almacenamiento seguro...");
  const [saving, setSaving] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [, setAuthorizationClock] = useState(0);
  const audioActiveRef = useRef(new Set());

  const refreshBatches = useCallback(async () => {
    const result = await repository.list();
    setSavedBatches(result.batches);
    setStorageMessage(result.recovered ? "Catálogo recuperado desde copia cifrada." : "Almacenamiento seguro disponible.");
  }, [repository]);

  useEffect(() => {
    let active = true;
    repository.list().then(result => {
      if (!active) return;
      setSavedBatches(result.batches);
      setStorageMessage(result.recovered ? "Catálogo recuperado desde copia cifrada." : "Almacenamiento seguro disponible.");
    }).catch(() => { if (active) setStorageMessage("Abre o actualiza el Connector para guardar y recuperar el progreso."); });
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    const warn = event => { if (saving || storageFailed || audioActiveRef.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, storageFailed]);

  useEffect(() => {
    const timer = window.setInterval(() => setAuthorizationClock(value => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  function displayAnalysis(next) {
    currentAnalysisRef.current = next;
    setPdfAnalysis(next);
  }

  function persistAnalysis(next) {
    displayAnalysis(next);
    if (!next.batch_id) { setStorageFailed(true); return Promise.resolve(); }
    setSaving(value => value + 1);
    const promise = repository.save(next);
    promise.then(() => { setStorageMessage("Cambios guardados de forma segura."); }, () => {
      setStorageFailed(true);
      setStorageMessage("No se guardaron los cambios. Mantén esta ventana abierta; recarga el lote para resolver el conflicto.");
    }).finally(() => setSaving(value => value - 1));
    return promise;
  }

  async function recipientSnapshot(snapshot) {
    const result = await repository.contacts();
    return { ...snapshot, workers: synchronizeRecipients(snapshot.workers, result.contacts) };
  }

  async function refreshRecipients() {
    await repository.flush();
    const snapshot = currentAnalysisRef.current;
    if (!snapshot) return;
    const contacts = await repository.contacts();
    const latest = currentAnalysisRef.current;
    if (latest?.batch_id !== snapshot.batch_id) throw new Error("El lote cambió. Vuelve a actualizar los contactos.");
    const enriched = { ...latest, workers: synchronizeRecipients(latest.workers, contacts.contacts) };
    await persistAnalysis(enriched);
    return enriched;
  }

  async function verifyContact(evaluationId, decision, evidence, expectedBatchId = pdfAnalysis?.batch_id) {
    await refreshRecipients();
    const snapshot = currentAnalysisRef.current;
    if (snapshot?.batch_id !== expectedBatchId) throw new Error("El lote cambió durante la verificación.");
    const index = snapshot?.workers.findIndex(worker => worker.evaluation_id === evaluationId);
    if (index === undefined || index < 0) throw new Error("La evaluación ya no está en este lote.");
    if (evidence.saveAuthorization) await validateManagedFile(snapshot.workers[index].datos_operativos?.archivo_pdf_completo_id);
    await updatePdfWorkerAtIndex(index, worker => recordWhatsAppDecision(worker, decision, evidence), snapshot.batch_id, evaluationId);
    if (currentAnalysisRef.current?.batch_id !== expectedBatchId) throw new Error("El lote cambió; el resultado anterior se guardó en su lote original.");
    return currentAnalysisRef.current.workers;
  }

  function updateWhatsAppQueue(queue, expectedBatchId = pdfAnalysis?.batch_id) {
    const snapshot = currentAnalysisRef.current;
    if (!snapshot || snapshot.batch_id !== expectedBatchId) return Promise.reject(new Error("El lote ya no está disponible."));
    return persistAnalysis({ ...snapshot, whatsapp_queue: queue });
  }

  async function restoreBatch(id) {
    const operationId = resetCurrentBatch();
    try {
      const batch = await repository.load(id);
      const selectedGreeting = batch.snapshot.greeting || DEFAULT_NARRATIVE_GREETING;
      let snapshot = await recipientSnapshot({ ...batch.snapshot, workers: batch.snapshot.workers.map(worker => restoreWorker(worker, selectedGreeting)) });
      if (snapshot.workers.some(worker => worker.app_fields?.audio_record || worker.app_fields?.audio_request)) {
        try {
          const configuration = await getTtsConfiguration();
          snapshot = { ...snapshot, workers: await Promise.all(snapshot.workers.map(worker => recoverAudio(worker, selectedGreeting, repository, configuration).catch(() => ({ ...worker, app_fields: { ...worker.app_fields, audio_stale: true, audio_status: "no_disponible" } })))) };
        } catch { setStorageMessage("Lote recuperado; conecta el servicio TTS para verificar y recuperar sus MP3."); }
      }
      if (operationId !== batchOperationIdRef.current) { revokeBatchAudioObjectUrls(snapshot); return; }
      snapshot = { ...snapshot, bulk_audio_queue: recoverBulkQueue(snapshot.bulk_audio_queue, snapshot.workers) };
      setGreeting(selectedGreeting);
      displayAnalysis(snapshot);
      setSelectedPdfWorkerIndex(0);
      await persistAnalysis(snapshot);
      setStorageFailed(false);
      return snapshot;
    } catch { setStorageMessage("No se pudo recuperar el lote. El cat?logo no se sobrescribi?."); }
  }

  async function handlePersistentAudio(workerIndex, text, expectedItem, expectedConfiguration) {
    const expectedBatch = currentAnalysisRef.current;
    const expectedWorker = expectedBatch?.workers?.[workerIndex];
    await refreshRecipients();
    const batch = currentAnalysisRef.current;
    const worker = batch?.workers?.[workerIndex];
    if (batch?.batch_id !== expectedBatch?.batch_id || worker?.evaluation_id !== expectedWorker?.evaluation_id) throw new Error("El lote cambió antes de solicitar audio.");
    if (!batch?.batch_id || !worker?.evaluation_id || storageFailed) throw new Error("Guarda el lote antes de solicitar audio.");
    const key = worker.evaluation_id;
    if (audioActiveRef.current.has(key)) throw new Error("Ya existe una solicitud para esta evaluación.");
    audioActiveRef.current.add(key);
    const current = () => currentAnalysisRef.current?.batch_id === batch.batch_id
      ? currentAnalysisRef.current.workers.find(item => item.evaluation_id === key) : null;
    const update = change => updatePdfWorkerAtIndex(workerIndex, change, batch.batch_id, key);
    try {
      await requireTtsSession();
      const configuration = await getTtsConfiguration();
      if (expectedConfiguration && JSON.stringify(canonical(configuration)) !== JSON.stringify(canonical(expectedConfiguration))) throw new Error("Cambió la configuración TTS. Recalcula la estimación.");
      if (worker.source_mode === MEDIWEB_SOURCE_MODE) await validateManagedFile(worker.datos_operativos?.archivo_pdf_completo_id);
      const latest = current();
      if (!latest || (expectedItem && (await sha256(approvalToken(latest)) !== expectedItem.token || await audioFingerprint(latest, text, configuration) !== expectedItem.fingerprint))) throw new Error("Cambió el contenido o la autorización.");
      return await generatePersistentAudio({ repository, worker: latest, text, configuration, synthesize: synthesizeAudioFromText, current, update, greeting: batch.greeting });
    } finally { audioActiveRef.current.delete(key); }
  }


  const resetCurrentBatch = useCallback(() => {
    batchOperationIdRef.current += 1;
    revokeBatchAudioObjectUrls(currentAnalysisRef.current);
    currentAnalysisRef.current = null;
    setPdfAnalysis(null);
    setSelectedPdfWorkerIndex(null);
    setPdfPreview("");
    setIsPdfProcessing(false);
    return batchOperationIdRef.current;
  }, []);

  async function handlePdfSelected(file, { mediwebWorkerMetadata, processingRunId } = {}) {
    const operationId = resetCurrentBatch();
    try {
      setIsPdfProcessing(true);
      setPdfPreview(`Procesando PDF: ${file.name}`);

      await repository.flush();
      const importKey = await sha256(JSON.stringify(canonical({
        source: mediwebWorkerMetadata ? MEDIWEB_SOURCE_MODE : PDF_SOURCE_MODE,
        pdf: await sha256(await file.arrayBuffer()), metadata: mediwebWorkerMetadata || null,
      })));
      const parsedAnalysis = await analyzePdfBatch(file);
      if (operationId !== batchOperationIdRef.current) return null;
      const parsedWithMetadata = mediwebWorkerMetadata
        ? attachMediwebWorkerMetadata(parsedAnalysis, mediwebWorkerMetadata)
        : parsedAnalysis;
      let analysis = prepareAnalysisForReview(
        parsedWithMetadata,
        mediwebWorkerMetadata ? MEDIWEB_SOURCE_MODE : PDF_SOURCE_MODE,
      );

      analysis = { ...analysis, greeting, workers: analysis.workers.map(worker => ({ ...worker,
        app_fields: { ...worker.app_fields, whatsapp_verification: initialVerification(worker) },
      })) };
      analysis = prepareInitialNarratives(analysis, greeting);
      const saved = await repository.import(analysis, importKey);
      if (operationId !== batchOperationIdRef.current) return null;
      analysis = await recipientSnapshot({ ...saved.snapshot, workers: saved.snapshot.workers.map(worker => restoreWorker(worker, saved.snapshot.greeting)) });
      if (processingRunId) analysis = { ...analysis, processing_run_ids: [...new Set([...(analysis.processing_run_ids || []), processingRunId])],
        processing_related_batch_ids: [...new Set([saved.id, ...(saved.recovered_batch_ids || []), ...(analysis.duplicate_batch_ids || [])])] };
      if (analysis.workers.some(worker => worker.app_fields?.audio_record || worker.app_fields?.audio_request)) {
        const configuration = await getTtsConfiguration().catch(() => null);
        if (configuration) analysis = { ...analysis, workers: await Promise.all(analysis.workers.map(worker => recoverAudio(worker, analysis.greeting, repository, configuration))) };
      }
      if (operationId !== batchOperationIdRef.current) return null;
      displayAnalysis(analysis);
      await persistAnalysis(analysis);
      setGreeting(analysis.greeting || DEFAULT_NARRATIVE_GREETING);
      setStorageFailed(false);
      await refreshBatches();
      setSelectedPdfWorkerIndex(0);
      setPdfPreview("");
      return analysis;
    } catch (error) {
      if (operationId !== batchOperationIdRef.current) return null;
      displayAnalysis(null);

      setPdfPreview(
        `No se pudo procesar el PDF.

Detalle:
${error?.message || "Error desconocido"}`
      );
      return null;
    } finally {
      if (operationId === batchOperationIdRef.current) setIsPdfProcessing(false);
    }
  }

  function updatePdfWorkerAtIndex(workerIndex, getNextWorker, expectedBatchId = pdfAnalysis?.batch_id, expectedEvaluationId = pdfAnalysis?.workers?.[workerIndex]?.evaluation_id) {
    const analysis = currentAnalysisRef.current;
    const currentWorker = analysis?.workers?.[workerIndex];
    if (!currentWorker || analysis.batch_id !== expectedBatchId || currentWorker.evaluation_id !== expectedEvaluationId) return Promise.resolve();
    const nextWorker = typeof getNextWorker === "function" ? getNextWorker(currentWorker) : getNextWorker;
    if (nextWorker === currentWorker) return Promise.resolve();
    const reconciled = reconcileWorkerReview(currentWorker, nextWorker);
    if (currentWorker.app_fields?.audio_url?.startsWith("blob:") && currentWorker.app_fields.audio_url !== reconciled.app_fields?.audio_url) {
      URL.revokeObjectURL(currentWorker.app_fields.audio_url);
    }
    return persistAnalysis({ ...analysis, workers: analysis.workers.map((worker, index) => index === workerIndex ? reconciled : worker) });
  }

  function handlePdfWorkerChange(workerIndex, nextWorker) {
    updatePdfWorkerAtIndex(workerIndex, nextWorker).catch(() => {});
  }

  if (deliveryOpen) return <DeliveryInbox onClose={async () => {
    setDeliveryOpen(false);
    if (currentAnalysisRef.current?.batch_id) await restoreBatch(currentAnalysisRef.current.batch_id);
  }} onCorrect={async (batchId, evaluationId) => {
    setDeliveryOpen(false);
    const analysis = await restoreBatch(batchId);
    if (analysis) setSelectedPdfWorkerIndex(analysis.workers.findIndex(worker => worker.evaluation_id === evaluationId));
  }} />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__copy">
          <p className="eyebrow">MVP base interna</p>
          <h1>AudioEvaluaciones</h1>
          <p className="app-subtitle">
            Generacion de texto y audio desde evaluaciones ocupacionales en PDF
          </p>
        </div>

        <div className="app-header__meta">
          <button type="button" disabled={Boolean(saving || storageFailed || isPdfProcessing)} onClick={async () => {
            try { await repository.flush(); setDeliveryOpen(true); }
            catch { setStorageMessage("Guarda o recupera el lote antes de abrir la bandeja de entregas."); }
          }}>Abrir bandeja de entregas</button>
          <span className="meta-chip">Base visual lista para escalar</span>
        </div>
      </header>

      <main className="workspace">
        <section className="surface">
          <div className="tab-content">
              <section className="panel" aria-label="Lotes guardados">
                <h2>Progreso y lotes guardados</h2>
                <p role="status">{saving ? "Guardando cambios... No cierres esta ventana." : storageMessage}</p>
                <button type="button" className="secondary-button" onClick={() => refreshBatches().catch(() => setStorageMessage("Connector no disponible."))}>Actualizar lotes</button>
                {savedBatches.map(batch => <div key={batch.id} className="detail-actions">
                  <span>{batch.file_name || "Lote"} · {batch.workers} evaluaciones · {batch.updated_at}</span>
                  <button type="button" className="secondary-button" disabled={Boolean(saving) || isPdfProcessing} onClick={() => restoreBatch(batch.id)}>Recuperar lote</button>
                  <button type="button" className="secondary-button" onClick={async () => {
                    if (!window.confirm("¿Eliminar el lote y sus MP3 del almacén cifrado? No elimina PDFs de origen ni copias exportadas. Esta acción no se puede deshacer.")) return;
                    try {
                      await repository.load(batch.id);
                      await repository.remove(batch.id);
                      if (currentAnalysisRef.current?.batch_id === batch.id) resetCurrentBatch();
                      await refreshBatches();
                    } catch (error) { setStorageMessage(error.code === "STORE_DELIVERY_HISTORY_PRESENT" ? "El lote tiene acciones de entrega registradas. Se conserva para revisar su historial y evitar reenvíos duplicados desde la bandeja." : "No se pudo eliminar el lote."); }
                  }}>Eliminar lote</button>
                </div>)}
                {pdfAnalysis ? <p>{Object.entries(batchCounts(pdfAnalysis)).map(([label, count]) => `${label}: ${count}`).join(" · ")}</p> : null}
                {pdfAnalysis?.duplicate_batch_ids?.length ? <p>Se omitieron evaluaciones ya guardadas en otros lotes; puedes recuperarlas desde la lista.</p> : null}
              </section>

              <section className="pdf-source-selector" aria-labelledby="pdf-source-title">
                <div>
                  <p className="section-label">Origen de evaluaciones</p>
                  <h2 id="pdf-source-title">Selecciona cómo importar</h2>
                </div>
                <div className="pdf-source-options" role="group" aria-label="Origen del PDF">
                  <button
                    type="button"
                    className={`pdf-source-option${pdfSource === "mediweb" ? " is-active" : ""}`}
                    onClick={() => {
                      setPdfSource("mediweb");
                      setMediwebActivated(true);
                    }}
                    aria-pressed={pdfSource === "mediweb"}
                  >
                    <strong>Importar desde MediWeb</strong>
                    <span>Opción principal mediante AudioEvaluaciones Connector</span>
                  </button>
                  <button
                    type="button"
                    className={`pdf-source-option${pdfSource === "manual" ? " is-active" : ""}`}
                    onClick={() => setPdfSource("manual")}
                    aria-pressed={pdfSource === "manual"}
                  >
                    <strong>Cargar PDF</strong>
                    <span>Respaldo manual desde esta computadora</span>
                  </button>
                </div>
              </section>

              <div hidden={pdfSource !== "manual"}>
                <section
                  className="panel pdf-import-panel"
                  id="panel-pdf"
                  role="tabpanel"
                  aria-labelledby="tab-pdf"
                >
                  <div className="pdf-import-copy">
                    <p className="section-label">Carga documental</p>
                    <h2>Importar PDF</h2>
                    <p className="section-text">
                      Extrae trabajadores desde PDFs digitales con plantilla Innomedic, revisa el texto final y genera audio desde un panel operativo.
                    </p>
                  </div>

                  <div className="pdf-import-actions">
                    <input
                      id="pdf-primary-input"
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handlePdfSelected(file);
                        }
                        event.target.value = "";
                      }}
                      style={{ display: "none" }}
                    />
                    <label htmlFor="pdf-primary-input" className="primary-button">
                      {isPdfProcessing ? "Procesando PDF..." : "Seleccionar PDF"}
                    </label>
                    <span className="upload-hint">Formato esperado: .pdf</span>
                  </div>
                </section>
              </div>

              {mediwebActivated ? (
                <div hidden={pdfSource !== "mediweb"}>
                  <MediwebImporter
                    onPdfSelected={handlePdfSelected}
                    onBatchStarted={resetCurrentBatch}
                    onRestoreBatch={restoreBatch}
                    analysis={pdfAnalysis}
                  />
                </div>
              ) : null}

              {pdfPreview && (
                <div className="preview-placeholder placeholder-box--narrative">
                  {pdfPreview}
                </div>
              )}

              {pdfAnalysis ? (
                <div id="pdf-workers-results" tabIndex="-1" className="pdf-results-focus-target">
                  <TtsSessionPanel />
                  <BulkAudioPanel key={`bulk-${pdfAnalysis.batch_id}`} analysis={pdfAnalysis} repository={repository}
                    onSelectWorker={setSelectedPdfWorkerIndex}
                    getSnapshot={() => currentAnalysisRef.current} refreshRecipients={refreshRecipients}
                    saveQueue={queue => { const current = currentAnalysisRef.current; if (current?.batch_id !== queue.batch_id) return Promise.reject(new Error("El lote cambió.")); return persistAnalysis({ ...current, bulk_audio_queue: queue,
                      bulk_audio_history: current.bulk_audio_queue && current.bulk_audio_queue.id !== queue.id ? [...(current.bulk_audio_history || []), current.bulk_audio_queue] : current.bulk_audio_history }); }}
                    runAudio={(item, text, configuration) => { const index = currentAnalysisRef.current?.workers.findIndex(worker => worker.evaluation_id === item.evaluation_id); return handlePersistentAudio(index, text, item, configuration); }}
                    storageFailed={storageFailed} />
                  <PdfWorkersPreview
                    key={pdfAnalysis.batch_id}
                    analysis={pdfAnalysis}
                    selectedWorkerIndex={selectedPdfWorkerIndex}
                    onSelectWorker={setSelectedPdfWorkerIndex}
                    onChangeWorker={handlePdfWorkerChange}
                    onUpdateWorker={(...args) => { const result = updatePdfWorkerAtIndex(...args); result.catch(() => {}); return result; }}
                    onGenerateAudio={handlePersistentAudio}
                    onVerifyContact={verifyContact}
                    onUpdateQueue={updateWhatsAppQueue}
                    onRefreshRecipients={refreshRecipients}
                    greeting={greeting}
                    onGreetingChange={(value) => {
                      setGreeting(value);
                      const current = currentAnalysisRef.current;
                      if (current) persistAnalysis({ ...current, greeting: value, workers: current.workers.map(worker => ({
                        ...worker,
                        clinical_approval: { status: worker.clinical_approval?.status === "aprobada" ? "invalidada" : worker.clinical_approval?.status || "pendiente" },
                        derived_states: { ...worker.derived_states, reviewed_by_user: false, reviewed_at: "", needs_review: true },
                        app_fields: { ...worker.app_fields, needs_review: true, audio_stale: Boolean(worker.app_fields?.audio_url || worker.app_fields?.audio_record) },
                      })) }).catch(() => {});
                    }}
                  />
                </div>
              ) : (
                !pdfPreview && pdfSource === "manual" && (
                  <div className="preview-placeholder">
                    Selecciona un PDF para iniciar la extraccion y revision de trabajadores.
                  </div>
                )
              )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
