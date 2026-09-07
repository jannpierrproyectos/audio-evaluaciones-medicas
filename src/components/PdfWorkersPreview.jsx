import { useEffect, useMemo, useRef, useState } from "react";
import PdfWorkerReviewForm from "./PdfWorkerReviewForm.jsx";
import { processWorkerClinicalNarrative } from "../clinical/index.js";
import { synthesizeAudioFromText } from "../lib/ttsClient.js";
import {
  revealManagedFile,
  saveWhatsAppAudio,
  validateManagedFile,
} from "../services/mediwebService.js";
import {
  NARRATIVE_GREETINGS,
  applyNarrativeGreeting,
} from "../lib/narrativeGreeting.js";
import {
  createAudioRequestGuard,
  getAudioGenerationIntent,
  hasExistingAudio,
} from "../lib/audioRequestGuard.js";
import {
  getWorkerFullPdfName,
  getWorkerPhone,
  resolveEditableNarrative,
} from "../lib/workerReviewUx.js";
import {
  buildWhatsAppAudioFilename,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  getWhatsAppAvailability,
} from "../lib/whatsappMessage.js";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "reviewed", label: "Revisados" },
  { id: "needs-review", label: "Requieren revision" },
  { id: "errors", label: "Con errores" },
  { id: "apto", label: "Apto" },
  { id: "restricted", label: "Apto con restricciones" },
  { id: "not-apt", label: "No apto" },
];

const DETAIL_TABS = [
  { id: "text-audio", label: "Texto y audio" },
  { id: "technical", label: "Detalles tecnicos" },
];

function formatReviewStatus(worker) {
  const validation = worker?.validation;

  if (validation?.has_errors) return "Bloqueado por error";
  if (worker?.derived_states?.reviewed_by_user) return "Revisado";
  if (worker?.derived_states?.needs_review || validation?.has_warnings) {
    return "Requiere revision";
  }

  return "Listo";
}

function getErrorCount(worker) {
  return worker?.validation?.error_count || 0;
}

function getMissingFields(worker) {
  return worker?.derived_states?.missing_required_fields || [];
}

function getPendingReviewFields(worker, findings) {
  if (findings?.review_status) {
    return findings.review_status.pending_review_fields || [];
  }

  return worker?.derived_states?.low_confidence_fields || [];
}

function getReviewedFields(findings) {
  return findings?.review_status?.reviewed_fields || [];
}

function renderValue(value) {
  if (value === null || value === undefined || value === "") return "pendiente";
  if (typeof value === "boolean") return value ? "si" : "no";
  return String(value);
}

function normalizeComparable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getWorkerName(worker) {
  return (
    worker?.identificacion?.nombre_completo_original ||
    [worker?.identificacion?.apellidos, worker?.identificacion?.nombres]
      .filter(Boolean)
      .join(" ") ||
    "Sin nombre"
  );
}

function createPdfAudioFilenameHint(worker) {
  const dni = worker?.identificacion?.dni || "sin-dni";
  const name =
    [worker?.identificacion?.nombres, worker?.identificacion?.apellidos]
      .filter(Boolean)
      .join(" ") ||
    worker?.identificacion?.nombre_completo_original ||
    "trabajador";

  const safeName =
    `${name}_${dni}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "trabajador";

  return `audio_${safeName}`;
}

function getPdfAudioStatusLabel(status) {
  const normalizedStatus = String(status || "pendiente").toLowerCase();

  if (normalizedStatus === "generando") return "Generando";
  if (normalizedStatus === "listo" || normalizedStatus === "generado") return "Generado";
  if (normalizedStatus === "error") return "Error";

  return "Pendiente";
}

function NarrativeList({ items, emptyLabel, renderItem }) {
  if (!items?.length) return <p className="muted-text">{emptyLabel}</p>;

  return (
    <ul className="compact-list">
      {items.map((item, index) => (
        <li key={`${item.area || item.field || item}-${index}`}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

function PdfSummaryBar({ analysis, workers, greeting, onGreetingChange }) {
  const metadata = analysis.batch_metadata || {
    fileName: analysis.file_name || "",
    pageCount: analysis.total_pages ?? null,
    workerCount: analysis.workers_detected ?? workers.length,
  };

  return (
    <section className="pdf-summary-bar is-compact" aria-label="Resumen del lote cargado">
      <div className="pdf-summary-item" title={metadata.fileName || undefined}>
        <span>Archivo</span>
        <strong>{renderValue(metadata.fileName)}</strong>
      </div>
      <div className="pdf-summary-item">
        <span>Paginas</span>
        <strong>{renderValue(metadata.pageCount)}</strong>
      </div>
      <div className="pdf-summary-item">
        <span>Trabajadores</span>
        <strong>{renderValue(metadata.workerCount)}</strong>
      </div>
      <label className="pdf-greeting-selector">
        <span>Saludo:</span>
        <select value={greeting} onChange={(event) => onGreetingChange(event.target.value)}>
          {NARRATIVE_GREETINGS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function WorkerFilters({ query, onQueryChange, activeFilter, onFilterChange }) {
  return (
    <div className="worker-filters">
      <label className="worker-search">
        <span>Buscar trabajador</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Nombre, DNI o empresa"
        />
      </label>

      <div className="filter-chips" aria-label="Filtros de trabajadores">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`filter-chip${activeFilter === filter.id ? " is-active" : ""}`}
            onClick={() => onFilterChange(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function workerMatchesFilter(worker, filter) {
  const aptitud = normalizeComparable(worker?.aptitud_y_recomendaciones?.aptitud_final);

  if (filter === "reviewed") return Boolean(worker?.derived_states?.reviewed_by_user);
  if (filter === "needs-review") {
    return Boolean(worker?.derived_states?.needs_review || worker?.app_fields?.needs_review);
  }
  if (filter === "errors") return getErrorCount(worker) > 0;
  if (filter === "apto") return aptitud === "APTO";
  if (filter === "restricted") return aptitud === "APTO CON RESTRICCIONES";
  if (filter === "not-apt") return aptitud === "NO APTO";

  return true;
}

function WorkerList({
  workers,
  selectedWorkerIndex,
  onSelectWorker,
  query,
  activeFilter,
}) {
  const filteredWorkers = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);

    return workers
      .map((worker, index) => ({ worker, index }))
      .filter(({ worker }) => workerMatchesFilter(worker, activeFilter))
      .filter(({ worker }) => {
        if (!normalizedQuery) return true;

        const haystack = normalizeSearch(
          [
            getWorkerName(worker),
            worker?.identificacion?.dni,
            worker?.identificacion?.empresa,
          ].join(" "),
        );

        return haystack.includes(normalizedQuery);
      });
  }, [activeFilter, query, workers]);

  if (!filteredWorkers.length) {
    return (
      <div className="worker-list-empty">
        No hay trabajadores que coincidan con los filtros seleccionados.
      </div>
    );
  }

  return (
    <div className="worker-list" role="listbox" aria-label="Trabajadores extraidos">
      {filteredWorkers.map(({ worker, index }) => {
        const isSelected = index === selectedWorkerIndex;
        return (
          <button
            key={`${worker?.identificacion?.dni || "sin-dni"}-${index}`}
            type="button"
            className={`worker-row${isSelected ? " is-selected" : ""}`}
            onClick={() => onSelectWorker(index)}
            aria-selected={isSelected}
            role="option"
          >
            <span className="worker-row__index">{index + 1}</span>
            <span className="worker-row__main">
              <strong>{getWorkerName(worker)}</strong>
              <small>
                DNI: {worker?.identificacion?.dni || "pendiente"} ·{" "}
                {worker?.identificacion?.empresa || "sin empresa"}
              </small>
            </span>
            <span className="worker-row__meta">
              <span>{worker?.aptitud_y_recomendaciones?.aptitud_final || "Pendiente"}</span>
              <small>{formatReviewStatus(worker)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function KeyValueGrid({ items, className = "" }) {
  return (
    <dl className={`key-grid${className ? ` ${className}` : ""}`}>
      {items.map((item) => {
        const normalizedItem = Array.isArray(item)
          ? { label: item[0], value: item[1] }
          : item;
        const itemClassName = normalizedItem.className
          ? `key-grid__item ${normalizedItem.className}`
          : "key-grid__item";

        return (
          <div key={normalizedItem.label} className={itemClassName}>
            <dt>{normalizedItem.label}</dt>
            <dd>{renderValue(normalizedItem.value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function WorkerTextAudioPanel({
  draft,
  worker,
  workerIndex,
  onUpdateWorker,
  audioRequestGuard,
}) {
  const [isRegenerationConfirmationOpen, setIsRegenerationConfirmationOpen] = useState(false);
  const editableNarrative = resolveEditableNarrative({
    savedText: worker?.app_fields?.texto_final,
    generatedText: draft.text,
  });
  const finalText = draft.applyGreeting(editableNarrative);
  const audioStatus = String(worker?.app_fields?.audio_status || "pendiente").toLowerCase();
  const aptitud = normalizeComparable(worker?.aptitud_y_recomendaciones?.aptitud_final);
  const canGenerateAudio = Boolean(
    finalText.trim() &&
      worker?.derived_states?.reviewed_by_user &&
      (!worker?.app_fields?.needs_review || worker?.derived_states?.reviewed_by_user) &&
      aptitud &&
      aptitud !== "PENDIENTE" &&
      !worker?.validation?.has_errors &&
      audioStatus !== "generando",
  );
  const hasGeneratedAudio = hasExistingAudio(worker?.app_fields);
  const workerRequestKey = worker?.identificacion?.dni || `worker-${workerIndex}`;

  function handleFinalTextChange(value) {
    onUpdateWorker?.(workerIndex, (currentWorker) => {
      const currentHasAudio = hasExistingAudio(currentWorker.app_fields);

      return {
        ...currentWorker,
        app_fields: {
          ...(currentWorker.app_fields || {}),
          texto_final: value,
          audio_status: currentHasAudio
            ? currentWorker.app_fields.audio_status
            : "pendiente",
          audio_error: "",
          audio_stale: currentHasAudio,
          last_edited_at: new Date().toISOString(),
        },
      };
    });
  }

  async function handleGenerateAudio({ regenerationConfirmed = false } = {}) {
    if (!canGenerateAudio) return;

    if (
      getAudioGenerationIntent(worker?.app_fields, { regenerationConfirmed }) ===
      "confirm"
    ) {
      setIsRegenerationConfirmationOpen(true);
      return;
    }

    if (!audioRequestGuard.start(workerRequestKey)) return;

    setIsRegenerationConfirmationOpen(false);

    onUpdateWorker?.(workerIndex, (currentWorker) => ({
      ...currentWorker,
      app_fields: {
        ...(currentWorker.app_fields || {}),
        audio_status: "generando",
        audio_error: "",
        audio_stale: hasExistingAudio(currentWorker.app_fields),
      },
    }));

    try {
      const result = await synthesizeAudioFromText({
        text: finalText,
        filenameHint: createPdfAudioFilenameHint(worker),
      });

      if (!result?.audioUrl || !result?.audioFilename) {
        throw new Error("La síntesis no devolvió un archivo de audio válido.");
      }

      onUpdateWorker?.(workerIndex, (currentWorker) => {
        const previousAudioUrl = currentWorker.app_fields?.audio_url;

        if (
          typeof previousAudioUrl === "string" &&
          previousAudioUrl.startsWith("blob:")
        ) {
          window.URL.revokeObjectURL(previousAudioUrl);
        }

        return {
          ...currentWorker,
          app_fields: {
            ...(currentWorker.app_fields || {}),
            audio_status: "listo",
            audio_url: result.audioUrl,
            audio_filename: result.audioFilename,
            audio_mime_type: result.mimeType,
            texto_tts: result.ttsText,
            audio_error: "",
            audio_stale: false,
            whatsapp_audio_file_id: "",
            whatsapp_audio_filename: "",
            whatsapp_audio_sha256: "",
            last_audio_generated_at: new Date().toISOString(),
          },
        };
      });
    } catch {
      onUpdateWorker?.(workerIndex, (currentWorker) => ({
        ...currentWorker,
        app_fields: {
          ...(currentWorker.app_fields || {}),
          audio_status: hasExistingAudio(currentWorker.app_fields) ? "listo" : "error",
          audio_error:
            "No se pudo generar el audio. Verifique que el servicio TTS este encendido y vuelva a intentar.",
        },
      }));
    } finally {
      audioRequestGuard.finish(workerRequestKey);
    }
  }

  return (
    <div className="detail-tab-panel">
      {!draft.can_generate ? (
        <div className="inline-feedback is-error">
          <strong>No se puede generar texto final todavia.</strong>
          <NarrativeList
            items={draft.blocking_reasons}
            emptyLabel="Sin motivos bloqueantes."
            renderItem={(reason) => reason}
          />
        </div>
      ) : null}

      <h4>Texto final editable</h4>
      <textarea
        className="editor-area pdf-editor"
        value={finalText}
        rows={16}
        onChange={(event) => handleFinalTextChange(event.target.value)}
        placeholder="Genera o escribe el texto final editable para este trabajador."
        aria-label="Texto final editable PDF"
      />

      {worker?.app_fields?.audio_stale && (
        <p className="muted-text">
          El texto fue editado despues del ultimo audio. Genera un nuevo audio para actualizarlo.
        </p>
      )}

      <div className="audio-section-inline">
        <h4>Audio</h4>
      <div className="audio-control-panel">
        <span className={`audio-status-badge is-${audioStatus}`}>
          Estado audio: {getPdfAudioStatusLabel(audioStatus)}
        </span>

        <button
          type="button"
          className="primary-button"
          onClick={handleGenerateAudio}
          disabled={!canGenerateAudio}
        >
          {audioStatus === "generando"
            ? "Generando audio..."
            : hasGeneratedAudio
              ? "Regenerar audio"
              : "Generar audio"}
        </button>
      </div>

      {isRegenerationConfirmationOpen && (
        <div
          className="audio-regeneration-confirmation"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="audio-regeneration-title"
          aria-describedby="audio-regeneration-description"
        >
          <strong id="audio-regeneration-title">Confirmar regeneración</strong>
          <p id="audio-regeneration-description">
            Ya existe un audio generado. Generar una nueva versión volverá a consumir créditos de voz. ¿Deseas continuar?
          </p>
          <div className="audio-regeneration-confirmation__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsRegenerationConfirmationOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => handleGenerateAudio({ regenerationConfirmed: true })}
            >
              Regenerar audio
            </button>
          </div>
        </div>
      )}

      {!finalText.trim() && (
        <p className="muted-text">El texto final esta vacio. Genera o escribe el texto antes de crear audio.</p>
      )}

      {worker?.app_fields?.audio_error && (
        <p className="audio-error-message">{worker.app_fields.audio_error}</p>
      )}

      {hasGeneratedAudio && (
        <div className="audio-player-shell">
          <audio controls src={worker.app_fields.audio_url} className="audio-player">
            Tu navegador no soporta reproduccion de audio.
          </audio>
          <a
            className="download-button"
            href={worker.app_fields.audio_url}
            download={worker.app_fields.audio_filename || "audio-evaluacion.mp3"}
          >
            Descargar MP3
          </a>
          <p className="audio-filename">
            Archivo: {worker.app_fields.audio_filename || "audio-evaluacion.mp3"}
          </p>
        </div>
      )}
      </div>

      <WhatsAppPreparationPanel
        worker={worker}
        workerIndex={workerIndex}
        onUpdateWorker={onUpdateWorker}
      />
    </div>
  );
}

function WhatsAppPreparationPanel({ worker, workerIndex, onUpdateWorker }) {
  const [preparation, setPreparation] = useState({
    status: "idle",
    feedback: "",
    pdfShown: false,
    audioShown: false,
    audioFile: null,
  });
  const requestControllerRef = useRef(null);
  const availability = getWhatsAppAvailability(worker);
  const isPreparing = preparation.status === "preparing";

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  async function persistCurrentAudio(signal) {
    const expectedAudioUrl = worker?.app_fields?.audio_url;
    const file = await saveWhatsAppAudio({
      audioUrl: expectedAudioUrl,
      fileName: buildWhatsAppAudioFilename(worker),
      signal,
    });
    if (signal?.aborted) throw new Error("La preparación fue cancelada.");
    onUpdateWorker?.(workerIndex, (currentWorker) => {
      if (currentWorker?.app_fields?.audio_url !== expectedAudioUrl) return currentWorker;
      return {
        ...currentWorker,
        app_fields: {
          ...(currentWorker.app_fields || {}),
          whatsapp_audio_file_id: file.id,
          whatsapp_audio_filename: file.name,
          whatsapp_audio_sha256: file.sha256,
        },
      };
    });
    return file;
  }

  async function handlePrepareWhatsApp() {
    if (!availability.canPrepare || requestControllerRef.current) {
      setPreparation((current) => ({
        ...current,
        feedback: availability.missing.join(" "),
      }));
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    const whatsappUrl = buildWhatsAppUrl({
      phone: availability.phone,
      message: buildWhatsAppMessage(worker),
    });
    const whatsappWindow = window.open("about:blank", "_blank");
    if (!whatsappWindow) {
      requestControllerRef.current = null;
      setPreparation((current) => ({
        ...current,
        feedback: "El navegador bloqueó la ventana de WhatsApp. Permite ventanas emergentes e inténtalo nuevamente.",
      }));
      return;
    }

    let whatsappOpened = false;
    setPreparation((current) => ({ ...current, status: "preparing", feedback: "Preparando archivos locales…" }));
    try {
      const existingAudioId = worker?.app_fields?.whatsapp_audio_file_id;
      const audioPromise = existingAudioId
        ? Promise.resolve({
            id: existingAudioId,
            name: worker?.app_fields?.whatsapp_audio_filename || buildWhatsAppAudioFilename(worker),
          })
        : persistCurrentAudio(controller.signal);
      const [audioFile] = await Promise.all([
        audioPromise,
        validateManagedFile(availability.pdfFileId, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) throw new Error("La preparación fue cancelada.");

      whatsappWindow.opener = null;
      whatsappWindow.location.replace(whatsappUrl);
      whatsappOpened = true;

      await revealManagedFile(availability.pdfFileId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPreparation({
        status: "prepared",
        feedback: "WhatsApp abierto y PDF mostrado en el Explorador. Envía primero el mensaje y luego adjunta el PDF.",
        pdfShown: true,
        audioShown: false,
        audioFile,
      });
    } catch (error) {
      if (!whatsappOpened) whatsappWindow.close();
      if (controller.signal.aborted) return;
      setPreparation((current) => ({
        ...current,
        status: "error",
        feedback: error?.message || "No se pudo preparar el envío por WhatsApp.",
      }));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }

  async function handleSelectAudio() {
    if (requestControllerRef.current) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setPreparation((current) => ({ ...current, status: "preparing", feedback: "Mostrando el audio…" }));
    try {
      let audioFile = preparation.audioFile;
      if (!audioFile?.id) audioFile = await persistCurrentAudio(controller.signal);
      try {
        await revealManagedFile(audioFile.id, { signal: controller.signal });
      } catch (error) {
        if (error?.code !== "FILE_NOT_FOUND") throw error;
        audioFile = await persistCurrentAudio(controller.signal);
        await revealManagedFile(audioFile.id, { signal: controller.signal });
      }
      if (controller.signal.aborted) return;
      setPreparation((current) => ({
        ...current,
        status: "prepared",
        feedback: "Audio mostrado en el Explorador. Adjúntalo manualmente al mismo chat después del PDF.",
        audioShown: true,
        audioFile,
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setPreparation((current) => ({
        ...current,
        status: "prepared",
        feedback: error?.message || "No se pudo mostrar el audio en el Explorador.",
      }));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }

  return (
    <section className="whatsapp-panel" aria-labelledby={`whatsapp-title-${workerIndex}`}>
      <div className="whatsapp-panel__header">
        <div>
          <p className="section-label">Envío manual asistido</p>
          <h4 id={`whatsapp-title-${workerIndex}`}>WhatsApp</h4>
        </div>
        {preparation.status === "prepared" ? <span className="status-pill">Envío preparado</span> : null}
      </div>

      <dl className="whatsapp-availability">
        <div className={availability.hasValidPhone ? "is-available" : "is-missing"}>
          <dt>Teléfono</dt>
          <dd>{availability.hasValidPhone ? `✓ ${worker.datos_operativos.telefono}` : "Inválido"}</dd>
        </div>
        <div className={availability.hasPdf ? "is-available" : "is-missing"}>
          <dt>PDF</dt>
          <dd>{availability.hasPdf ? "✓ Disponible" : "Faltante"}</dd>
        </div>
        <div className={availability.hasAudio ? "is-available" : "is-missing"}>
          <dt>Audio</dt>
          <dd>{availability.hasAudio ? "✓ Disponible" : "Faltante"}</dd>
        </div>
      </dl>

      {!availability.canPrepare ? (
        <ul className="whatsapp-missing-list">
          {availability.missing.map((message) => <li key={message}>{message}</li>)}
        </ul>
      ) : null}

      {preparation.status !== "prepared" ? (
        <button
          type="button"
          className="primary-button"
          onClick={handlePrepareWhatsApp}
          disabled={!availability.canPrepare || isPreparing}
        >
          {isPreparing ? "Preparando envío…" : "Preparar envío por WhatsApp"}
        </button>
      ) : (
        <div className="whatsapp-prepared-steps">
          <div>
            <strong>1. Mensaje</strong>
            <span>Chat abierto con el mensaje predeterminado</span>
            <small>WhatsApp abierto</small>
          </div>
          <div>
            <strong>2. PDF</strong>
            <span title={availability.pdfName}>{availability.pdfName}</span>
            <small>{preparation.pdfShown ? "PDF mostrado en Explorer" : "PDF preparado"}</small>
          </div>
          <div>
            <strong>3. Audio</strong>
            <span title={preparation.audioFile?.name}>{preparation.audioFile?.name}</span>
            <small>{preparation.audioShown ? "Audio mostrado en Explorer" : "Audio preparado"}</small>
            <button type="button" className="secondary-button" onClick={handleSelectAudio} disabled={isPreparing}>
              Seleccionar audio en carpeta
            </button>
          </div>
          <button
            type="button"
            className="secondary-button is-quiet"
            onClick={() => setPreparation({ status: "idle", feedback: "", pdfShown: false, audioShown: false, audioFile: null })}
          >
            Finalizar preparación
          </button>
        </div>
      )}

      {preparation.feedback ? <p className="whatsapp-feedback" aria-live="polite">{preparation.feedback}</p> : null}
      <p className="muted-text">AudioEvaluaciones prepara los archivos; el operador realiza y confirma cada envío en WhatsApp.</p>
    </section>
  );
}

function TechnicalDetailsPanel({
  worker,
  findings,
  reviewFlags = [],
  trace = [],
  draft,
  isEditing,
  onToggleEditing,
  onChangeWorker,
}) {
  const narrativeGroupEntries = Object.entries(findings.narrative_groups || {}).filter(
    ([, group]) => group.narrar,
  );
  const pendingReviewFields = getPendingReviewFields(worker, findings);
  const reviewedFields = getReviewedFields(findings);

  return (
    <div className="technical-stack">
      <div className="detail-actions detail-actions--technical">
        <button type="button" className="secondary-button is-quiet" onClick={onToggleEditing}>
          {isEditing ? "Ocultar edicion de campos" : "Editar campos"}
        </button>
      </div>

      {isEditing ? (
        <div className="review-form-shell">
          <PdfWorkerReviewForm worker={worker} onChange={onChangeWorker} />
        </div>
      ) : null}

      <details className="technical-detail">
        <summary>Alertas principales</summary>
        <NarrativeList
          items={[...(worker?.validation?.errors || []), ...(worker?.validation?.warnings || [])]}
          emptyLabel="Sin alertas automaticas."
          renderItem={(item) => `[${item.severity}] ${item.message}`}
        />
      </details>

      <details className="technical-detail">
        <summary>Elementos a revisar</summary>
        <NarrativeList
          items={reviewFlags}
          emptyLabel="Sin flags del motor clinico."
          renderItem={(flag) => `[${flag.confidence}] ${flag.type}: ${flag.message} (${flag.sourceField})`}
        />
      </details>

      <details className="technical-detail">
        <summary>Ver borrador original</summary>
        <textarea
          className="editor-area pdf-editor pdf-editor--preview"
          value={draft?.text || ""}
          readOnly
          rows={8}
          aria-label="Borrador narrativo original"
        />
      </details>

      <details className="technical-detail">
        <summary>Campos detectados</summary>
        <KeyValueGrid
          items={[
            ["Nombre original", worker?.identificacion?.nombre_completo_original],
            ["Nombres", worker?.identificacion?.nombres],
            ["Apellidos", worker?.identificacion?.apellidos],
            ["DNI", worker?.identificacion?.dni],
            ["Empresa", worker?.identificacion?.empresa],
            ["Fecha evaluacion", worker?.identificacion?.fecha_evaluacion],
            ["Aptitud", worker?.aptitud_y_recomendaciones?.aptitud_final],
            ["IMC", worker?.datos_generales_narrables?.imc],
            ["Glucosa", worker?.laboratorio_numerico?.glucosa_valor],
            ["Colesterol", worker?.laboratorio_numerico?.colesterol_valor],
            ["Trigliceridos", worker?.laboratorio_numerico?.trigliceridos_valor],
          ]}
        />
      </details>

      <details className="technical-detail">
        <summary>Revision y validacion</summary>
        <KeyValueGrid
          items={[
            ["Campos faltantes", getMissingFields(worker).join(", ") || "ninguno"],
            ["Campos pendientes", pendingReviewFields.join(", ") || "ninguno"],
            ["Campos revisados", reviewedFields.join(", ") || "ninguno"],
            ["Revisado por usuario", worker?.derived_states?.reviewed_by_user ? "si" : "no"],
            ["Fecha revision", worker?.derived_states?.reviewed_at],
          ]}
        />
        <NarrativeList
          items={worker?.validation?.warnings || []}
          emptyLabel="Sin alertas automaticas."
          renderItem={(warning) => `[${warning.severity}] ${warning.message}`}
        />
        <NarrativeList
          items={reviewFlags}
          emptyLabel="Sin flags del motor clínico."
          renderItem={(flag) => `[${flag.confidence}] ${flag.type}: ${flag.message}`}
        />
      </details>

      <details className="technical-detail">
        <summary>Hallazgos narrables</summary>
        <NarrativeList
          items={findings.hallazgos_relevantes}
          emptyLabel="Sin hallazgos relevantes detectados."
          renderItem={(item) =>
            `${item.area}: ${item.resultado} | tipo: ${item.tipo} | severidad: ${item.severidad} | narrar: ${item.narrar ? "si" : "no"}`
          }
        />
      </details>

      <details className="technical-detail">
        <summary>Laboratorio y examenes normales</summary>
        <NarrativeList
          items={findings.laboratorio_relevante}
          emptyLabel="Sin laboratorio relevante."
          renderItem={(item) => `${item.label}: ${item.value} - ${item.status}`}
        />
        <NarrativeList
          items={findings.examenes_normales_resumibles}
          emptyLabel="Sin examenes normales resumibles."
          renderItem={(item) => `${item.area}: ${item.value}`}
        />
      </details>

      <details className="technical-detail">
        <summary>Grupos narrativos</summary>
        {narrativeGroupEntries.length ? (
          narrativeGroupEntries.map(([area, group]) => (
            <div key={area} className="technical-subsection">
              <strong>{area}</strong>
              <NarrativeList
                items={group.hallazgos}
                emptyLabel="Sin hallazgos."
                renderItem={(item) => `${item.resultado} | tipo: ${item.tipo}`}
              />
              <NarrativeList
                items={group.recomendaciones}
                emptyLabel="Sin recomendaciones."
                renderItem={(item) =>
                  `${item.item ? `[${item.item}] ` : ""}${item.texto_normalizado || item.texto_original}`
                }
              />
            </div>
          ))
        ) : (
          <p className="muted-text">Sin grupos narrativos activos.</p>
        )}
      </details>

      <details className="technical-detail">
        <summary>Trazas clinicas y de normalizacion</summary>
        <NarrativeList
          items={trace}
          emptyLabel="Sin trazas disponibles."
          renderItem={(item) => `${item.ruleId || item.field || "trace"}: ${item.message || item.action || JSON.stringify(item)}`}
        />
      </details>
    </div>
  );
}

function WorkerDetailPanel({
  worker,
  workerIndex,
  findings,
  draft,
  reviewFlags,
  onChangeWorker,
  onUpdateWorker,
  audioRequestGuard,
  trace,
}) {
  const [activeTab, setActiveTab] = useState("text-audio");
  const [isEditing, setIsEditing] = useState(false);
  const workerPhone = getWorkerPhone(worker);
  const workerFullPdfName = getWorkerFullPdfName(worker);

  return (
    <section className="pdf-detail-panel is-simplified">
      <div className="pdf-detail-header">
        <div>
          <h3>{getWorkerName(worker)}</h3>
          <p className="section-text">
            {worker?.identificacion?.dni || "DNI pendiente"} ·{" "}
            <span className="worker-aptitude-inline">
              {worker?.aptitud_y_recomendaciones?.aptitud_final || "Aptitud pendiente"}
            </span>
          </p>
          <p className="worker-company-inline">
            {worker?.identificacion?.empresa || "Empresa pendiente"}
          </p>
          {workerPhone ? (
            <p className="worker-phone-inline">Teléfono: {workerPhone}</p>
          ) : null}
          {workerFullPdfName ? (
            <p className="worker-pdf-inline" title={workerFullPdfName}>
              PDF: {workerFullPdfName}
            </p>
          ) : null}
        </div>
        <span className="status-pill">{formatReviewStatus(worker)}</span>
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Detalle PDF">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`detail-tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pdf-detail-scroll">
        {activeTab === "text-audio" && (
          <WorkerTextAudioPanel
            draft={draft}
            worker={worker}
            workerIndex={workerIndex}
            onUpdateWorker={onUpdateWorker}
            audioRequestGuard={audioRequestGuard}
          />
        )}

        {activeTab === "technical" && (
          <TechnicalDetailsPanel
            worker={worker}
            findings={findings}
            reviewFlags={reviewFlags}
            trace={trace}
            draft={draft}
            isEditing={isEditing}
            onToggleEditing={() => setIsEditing((value) => !value)}
            onChangeWorker={(nextWorker) => onChangeWorker?.(workerIndex, nextWorker)}
          />
        )}
      </div>
    </section>
  );
}

function PdfWorkersPreview({
  analysis,
  selectedWorkerIndex,
  onSelectWorker,
  onChangeWorker,
  onUpdateWorker,
  greeting,
  onGreetingChange,
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [audioRequestGuard] = useState(() => createAudioRequestGuard());

  if (!analysis) {
    return (
      <div className="preview-placeholder">
        Selecciona un PDF para ver los trabajadores detectados.
      </div>
    );
  }

  const workers = analysis.workers || [];
  const selectedWorker = workers[selectedWorkerIndex] || workers[0];
  const selectedIndex = workers.indexOf(selectedWorker);
  const clinicalResult = selectedWorker
    ? processWorkerClinicalNarrative(selectedWorker)
    : null;
  const narrativeFindings = clinicalResult?.findings || null;
  const narrativeDraft = clinicalResult
    ? {
        can_generate: clinicalResult.canGenerate,
        blocking_reasons: clinicalResult.blockingReasons,
        text: applyNarrativeGreeting(clinicalResult.displayText, greeting),
        applyGreeting: (text) => applyNarrativeGreeting(text, greeting),
      }
    : null;

  return (
    <div className="pdf-workspace">
      <PdfSummaryBar
        analysis={analysis}
        workers={workers}
        greeting={greeting}
        onGreetingChange={onGreetingChange}
      />

      <div className="pdf-operational-layout">
        <section className="pdf-worker-panel">
          <div className="panel__header pdf-panel-header">
            <div>
              <p className="section-label">Trabajadores extraidos</p>
              <h3>Revision de lote</h3>
            </div>
            <span className="ghost-chip">{workers.length} registros</span>
          </div>

          <WorkerFilters
            query={query}
            onQueryChange={setQuery}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />

          <WorkerList
            workers={workers}
            selectedWorkerIndex={selectedWorkerIndex}
            onSelectWorker={onSelectWorker}
            query={query}
            activeFilter={activeFilter}
          />
        </section>

        {selectedWorker && narrativeFindings && narrativeDraft ? (
          <WorkerDetailPanel
            key={selectedIndex}
            worker={selectedWorker}
            workerIndex={selectedIndex}
            findings={narrativeFindings}
            draft={narrativeDraft}
            reviewFlags={clinicalResult.reviewFlags}
            onChangeWorker={onChangeWorker}
            onUpdateWorker={onUpdateWorker}
            audioRequestGuard={audioRequestGuard}
            trace={clinicalResult.trace}
          />
        ) : (
          <section className="pdf-detail-panel">
            <div className="preview-placeholder">
              Selecciona un trabajador para ver su detalle.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default PdfWorkersPreview;
