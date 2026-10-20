import WhatsAppReviewQueue from "./components/WhatsAppReviewQueue.jsx";
import { flowSummary, suggestedFlowStep } from "./lib/operationalFlow.js";
import { confirmDeliveryRecipient } from "./lib/deliveryUx.js";
import { EvaluationRepository, sha256, canonical, restoreWorker, recoverAudio, getTtsConfiguration, generatePersistentAudio, initialVerification } from "./lib/evaluationPersistence.js";
import { synthesizeAudioFromText } from "./lib/ttsClient.js";
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
import { synchronizeRecipients, recordWhatsAppDecision, matchesReviewFilter } from "./lib/whatsappReview.js";
import BulkAudioPanel from "./components/BulkAudioPanel.jsx";
import { approvalToken } from "./lib/bulkAudio.js";
import { audioFingerprint } from "./lib/evaluationPersistence.js";
import { matchesApprovedAudio } from "../mediweb-downloader/src/authorizationPolicy.js";
import { getRecipientChecks } from "./lib/recipientPolicy.js";
import { loadReviewableBatch, recoveryDiagnostic, reportRecoveryDiagnostic, recoveryError } from "./lib/batchRecovery.js";
import DeliveryInbox from "./components/DeliveryInbox.jsx";
import GoogleAccess from "./components/GoogleAccess.jsx";

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
  const [storageMessage, setStorageMessage] = useState("Comprobando almacenamiento seguro...");
  const [saving, setSaving] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const [workStage, setWorkStage] = useState("import");
  const [, setAuthorizationClock] = useState(0);
  const audioActiveRef = useRef(new Set());

  const refreshBatches = useCallback(async () => {
    const result = await repository.list();
    setStorageMessage(result.recovered ? "Catálogo recuperado desde copia cifrada." : "Almacenamiento seguro disponible.");
  }, [repository]);

  useEffect(() => {
    let active = true;
    repository.list().then(result => {
      if (!active) return;
      setStorageMessage(result.recovered ? "Almacenamiento disponible." : "Almacenamiento seguro disponible.");
    }).catch(() => { if (active) setStorageMessage("Abre el Connector para trabajar con los PDF y audios."); });
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
    try { const result = await repository.contacts(); return { ...snapshot, workers: synchronizeRecipients(snapshot.workers, result.contacts) }; }
    catch (error) { reportRecoveryDiagnostic(recoveryDiagnostic(error, "BATCH_CONTACTS")); return snapshot; }
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

  async function restoreBatch(id, { showStatus = true } = {}) {
    const operationId = ++batchOperationIdRef.current;
    if (showStatus) setStorageMessage("Abriendo evaluaciones guardadas...");
    try {
      const { snapshot, warnings } = await loadReviewableBatch(repository, id);
      if (operationId !== batchOperationIdRef.current) throw recoveryError("BATCH_INVALID");
      revokeBatchAudioObjectUrls(currentAnalysisRef.current);
      displayAnalysis(snapshot);
      setGreeting(snapshot.greeting);
      setSelectedPdfWorkerIndex(Math.max(0, snapshot.workers.findIndex(worker => worker.evaluation_id === snapshot.review_ui?.selected_id)));
      setStorageFailed(false);
      setStorageMessage(warnings.length ? `Evaluaciones abiertas. Contactos sin actualizar [${warnings[0].code}].` : "Almacenamiento seguro disponible.");
      warnings.forEach(reportRecoveryDiagnostic);
      // Audio recovery uses its own encrypted reference, without blocking review.
      for (const worker of snapshot.workers) {
        const reference = worker.app_fields?.audio_record || worker.app_fields?.audio_request;
        if (!reference?.configuration) continue;
        recoverAudio(worker, snapshot.greeting, repository, reference.configuration).then(recovered => {
          if (operationId !== batchOperationIdRef.current) { if (recovered.app_fields?.audio_url?.startsWith("blob:")) URL.revokeObjectURL(recovered.app_fields.audio_url); return; }
          const latest = currentAnalysisRef.current;
          const current = latest?.workers.find(value => value.evaluation_id === worker.evaluation_id);
          if (current !== worker) return;
          displayAnalysis({ ...latest, workers: latest.workers.map(value => value === worker ? recovered : value) });
        }).catch(error => reportRecoveryDiagnostic(recoveryDiagnostic(error, "BATCH_AUDIO")));
      }
      return snapshot;
    } catch (error) {
      const diagnostic = error.diagnostic || recoveryDiagnostic(error);
      reportRecoveryDiagnostic(diagnostic);
      if (showStatus) setStorageMessage(`No se pudieron abrir las evaluaciones [${diagnostic.code}]. Puedes reintentar; los PDF y lotes se conservan.`);
      throw Object.assign(error, { diagnostic });
    }
  }

  async function handlePersistentAudio(workerIndex, text, expectedItem, expectedConfiguration) {
    const expectedBatch = currentAnalysisRef.current;
    const expectedWorker = expectedBatch?.workers?.[workerIndex];
    await repository.flush();
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
      const configuration = await getTtsConfiguration().catch(error => {
        const reference = worker.app_fields?.audio_record;
        if (reference?.configuration && matchesApprovedAudio(worker, text, reference, reference.configuration)) return reference.configuration;
        throw error;
      });
      if (expectedConfiguration && JSON.stringify(canonical(configuration)) !== JSON.stringify(canonical(expectedConfiguration))) throw new Error("Cambió la configuración TTS. Recalcula la estimación.");
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
      if (!parsedAnalysis.workers?.length) throw recoveryError("PDF_IMPORT_EMPTY");
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
        analysis = { ...analysis, workers: await Promise.all(analysis.workers.map(worker => recoverAudio(worker, analysis.greeting, repository, configuration || (worker.app_fields?.audio_record || worker.app_fields?.audio_request)?.configuration))) };
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

      const diagnostic = recoveryDiagnostic(error, "PDF_IMPORT");
      reportRecoveryDiagnostic(diagnostic);
      setPdfPreview(`No se pudieron importar las evaluaciones [${diagnostic.code}]. Los PDF descargados se conservan.`);
      throw Object.assign(error, { diagnostic });
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

  function updateReviewUi(change) {
    const snapshot = currentAnalysisRef.current;
    if (snapshot) persistAnalysis({ ...snapshot, review_ui: { ...snapshot.review_ui, ...change } }).catch(() => {});
  }
  function selectWorker(index) {
    setSelectedPdfWorkerIndex(index);
    updateReviewUi({ selected_id: currentAnalysisRef.current?.workers[index]?.evaluation_id });
  }

  function handlePdfWorkerChange(workerIndex, nextWorker) {
    updatePdfWorkerAtIndex(workerIndex, nextWorker).catch(() => {});
  }

  function goToFlow(step) {
    setWorkStage(step);
    if (step !== "import") updateReviewUi({ flow_step: step });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function continueToTexts() {
    const index = currentAnalysisRef.current?.workers.findIndex(worker => worker.clinical_approval?.status !== "aprobada");
    if (index >= 0) selectWorker(index);
    goToFlow("review");
  }
  async function continueBatch() {
    const step = suggestedFlowStep(currentAnalysisRef.current);
    if (step === "delivery") return openDelivery();
    if (step === "review") return continueToTexts();
    return openContacts();
  }
  async function openContacts(evaluationId, reviewExisting = false) {
    try {
      const snapshot = await refreshRecipients();
      if (!snapshot) return;
      const pending = snapshot.workers.filter(worker => matchesReviewFilter(worker, "pendientes"));
      if (!pending.length && !reviewExisting) { continueToTexts(); return; }
      const candidates = pending.length ? pending : snapshot.workers;
      const selected = candidates.find(worker => worker.evaluation_id === evaluationId) || candidates.find(worker => worker.evaluation_id === snapshot.whatsapp_queue?.selected_evaluation_id) || candidates[0];
      await updateWhatsAppQueue({ ...snapshot.whatsapp_queue, filter: pending.length ? "pendientes" : "todos", visited: [], selected_evaluation_id: selected?.evaluation_id || null });
      goToFlow("whatsapp");
    } catch { setStorageMessage("No se pudo abrir la verificacion. Comprueba el Connector y reintenta."); }
  }
  async function openDelivery() {
    try { await repository.flush(); goToFlow("delivery"); }
    catch { setStorageMessage("No se pudo guardar el lote antes de preparar los envios."); }
  }
  const flow = flowSummary(pdfAnalysis);
  const completedSteps = [flow.total > 0, flow.total > 0 && flow.contactsResolved === flow.total, flow.total > 0 && flow.approved === flow.total, flow.total > 0 && flow.audio === flow.total, false];
  const activeStep = workStage === "import" ? 0 : workStage === "whatsapp" ? 1 : workStage === "delivery" ? 4 : flow.generating || (flow.approved === flow.total && flow.total > 0) ? 3 : 2;
  const batchAudioControls = pdfAnalysis ? (
<section className="audio-workspace">
                  <BulkAudioPanel compact key={`bulk-${pdfAnalysis.batch_id}`} analysis={pdfAnalysis} repository={repository}
                    onDeliver={openDelivery}
                    onSelectWorker={index => { selectWorker(index); goToFlow("review"); }}
                    getSnapshot={() => currentAnalysisRef.current} refreshRecipients={refreshRecipients}
                    saveQueue={queue => { const current = currentAnalysisRef.current; if (current?.batch_id !== queue.batch_id) return Promise.reject(new Error("El lote cambió.")); return persistAnalysis({ ...current, bulk_audio_queue: queue,
                      bulk_audio_history: current.bulk_audio_queue && current.bulk_audio_queue.id !== queue.id ? [...(current.bulk_audio_history || []), current.bulk_audio_queue] : current.bulk_audio_history }); }}
                    runAudio={(item, text, configuration) => { const index = currentAnalysisRef.current?.workers.findIndex(worker => worker.evaluation_id === item.evaluation_id); return handlePersistentAudio(index, text, item, configuration); }}
                    storageFailed={storageFailed} />
                  </section>
  ) : null;
  const delivery = <DeliveryInbox embedded initialBatchId={pdfAnalysis?.batch_id}
    onAuthorizeRecipient={row => confirmDeliveryRecipient(row, new EvaluationRepository(repository.request), undefined, undefined,
      row.batch_id === currentAnalysisRef.current?.batch_id ? evidence => verifyContact(row.evaluation_id, "confirmado_por_operador", evidence, row.batch_id) : undefined)}
    onClose={() => goToFlow("review")} onCorrect={async (batchId, evaluationId) => {
      const analysis = batchId === currentAnalysisRef.current?.batch_id ? currentAnalysisRef.current : await restoreBatch(batchId).catch(() => null);
      if (!analysis) return;
      selectWorker(analysis.workers.findIndex(worker => worker.evaluation_id === evaluationId));
      const worker = analysis.workers.find(worker => worker.evaluation_id === evaluationId);
      if (worker && !getRecipientChecks(worker).whatsapp) await openContacts(evaluationId, true);
      else goToFlow("review");
    }} />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__copy">
          <p className="eyebrow">Salud ocupacional</p>
          <h1>AudioEvaluaciones</h1>
          <p className="app-subtitle">
            Generacion de texto y audio desde evaluaciones ocupacionales en PDF
          </p>
        </div>

        <div className="app-header__meta">
          <span className="meta-chip">Trabajo seguro por lotes</span>
        </div>
      </header>

      <GoogleAccess />
      <div className="flow-toolbar">
        <ol className="flow-progress" aria-label="Flujo del lote">
          {["Importar", "WhatsApp", "Texto clínico", "Audio", "Enviar"].map((label, index) => <li key={label} aria-current={activeStep === index ? "step" : undefined} className={completedSteps[index] ? "is-complete" : ""}><span>{index + 1}</span>{label}</li>)}
        </ol>
        {pdfAnalysis && <button type="button" className="secondary-button" disabled={Boolean(saving || isPdfProcessing || flow.generating)} onClick={() => goToFlow("import")}>{workStage === "import" ? "Importación" : "Importar otro lote"}</button>}
      </div>
      <main className="workspace">
        <p className={`storage-status${storageFailed ? " is-error" : ""}`} role={storageFailed ? "alert" : "status"}>{saving ? "Guardando cambios..." : storageMessage}</p>
        <section className="surface">
          <div className="tab-content">
              <div id="import-workspace" className="import-workspace" hidden={workStage !== "import"}>
              <section className="pdf-source-selector" aria-label="Origen de evaluaciones">
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

                  </button>
                  <button
                    type="button"
                    className={`pdf-source-option${pdfSource === "manual" ? " is-active" : ""}`}
                    onClick={() => setPdfSource("manual")}
                    aria-pressed={pdfSource === "manual"}
                  >
                    <strong>Cargar PDF</strong>

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
                          handlePdfSelected(file).then(() => openContacts()).catch(() => {});
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
                    onRestoreBatch={id => restoreBatch(id, { showStatus: false })}
                    analysis={pdfAnalysis}
                    onReview={continueBatch}
                    nextActionLabel={pdfAnalysis?.review_ui?.flow_step ? "Continuar lote" : "Verificar WhatsApp"}
                  />
                </div>
              ) : null}

              </div>

              {pdfPreview && (
                <div className="preview-placeholder placeholder-box--narrative">
                  {pdfPreview}
                </div>
              )}

              {pdfAnalysis ? (
                <div id="pdf-workers-results" hidden={workStage === "import" || workStage === "delivery"} tabIndex="-1" className="pdf-results-focus-target">
                  {workStage === "whatsapp" && <WhatsAppReviewQueue analysis={pdfAnalysis} onVerifyContact={verifyContact} onUpdateQueue={updateWhatsAppQueue}
                    onUpdateWorker={(...args) => updatePdfWorkerAtIndex(...args)} onRefreshRecipients={refreshRecipients} onSelectWorker={selectWorker}
                    onClose={() => goToFlow("import")} onContinue={continueToTexts} />}
                  <div hidden={workStage !== "review"}>
                  <PdfWorkersPreview
                    key={pdfAnalysis.batch_id}
                    onReviewContacts={() => openContacts(undefined, true)}
                    batchAudioControls={batchAudioControls}
                    analysis={pdfAnalysis}
                    selectedWorkerIndex={selectedPdfWorkerIndex}
                    onSelectWorker={selectWorker}
                    onChangeWorker={handlePdfWorkerChange}
                    onUpdateWorker={(...args) => { const result = updatePdfWorkerAtIndex(...args); result.catch(() => {}); return result; }}
                    onGenerateAudio={handlePersistentAudio}
                    onReviewUiChange={updateReviewUi}
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
                </div>
              ) : (
                !pdfPreview && pdfSource === "manual" && (
                  <div className="preview-placeholder">
                    Selecciona un PDF para iniciar la extraccion y revision de trabajadores.
                  </div>
                )
              )}
              {workStage === "delivery" && delivery}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
