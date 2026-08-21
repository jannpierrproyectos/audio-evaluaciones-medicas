import { useMemo, useState } from "react";
import PdfWorkerReviewForm from "./PdfWorkerReviewForm.jsx";
import { processWorkerClinicalNarrative } from "../clinical/index.js";
import { synthesizeAudioFromText } from "../lib/ttsClient.js";
import {
  DEFAULT_NARRATIVE_GREETING,
  NARRATIVE_GREETINGS,
  applyNarrativeGreeting,
} from "../lib/narrativeGreeting.js";
import {
  createAudioRequestGuard,
  getAudioGenerationIntent,
  hasExistingAudio,
} from "../lib/audioRequestGuard.js";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "reviewed", label: "Revisados" },
  { id: "needs-review", label: "Requieren revision" },
  { id: "errors", label: "Con errores" },
  { id: "warnings", label: "Con alertas" },
  { id: "apto", label: "Apto" },
  { id: "restricted", label: "Apto con restricciones" },
  { id: "not-apt", label: "No apto" },
];

const DETAIL_TABS = [
  { id: "summary", label: "Resumen" },
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

function getWarningCount(worker) {
  return worker?.validation?.warning_count || 0;
}

function canSendToNarrative(worker) {
  return !worker?.validation?.has_errors;
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
  const reviewedCount = workers.filter((worker) => worker?.derived_states?.reviewed_by_user).length;
  const needsReviewCount = workers.filter(
    (worker) => worker?.derived_states?.needs_review || worker?.app_fields?.needs_review,
  ).length;
  const warningsCount = workers.filter((worker) => getWarningCount(worker) > 0).length;
  const errorsCount = workers.filter((worker) => getErrorCount(worker) > 0).length;

  const stats = [
    ["Archivo", analysis.file_name || "Sin archivo"],
    ["Paginas", analysis.total_pages],
    ["Trabajadores", analysis.workers_detected || workers.length],
    ["Revisados", reviewedCount],
    ["Requieren revision", needsReviewCount],
    ["Con alertas", warningsCount],
    ["Con errores", errorsCount],
  ];

  return (
    <section className="pdf-summary-bar" aria-label="Resumen del PDF cargado">
      {stats.map(([label, value]) => (
        <div key={label} className="pdf-summary-item">
          <span>{label}</span>
          <strong>{renderValue(value)}</strong>
        </div>
      ))}
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
  if (filter === "warnings") return getWarningCount(worker) > 0;
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
        const warningCount = getWarningCount(worker);
        const errorCount = getErrorCount(worker);

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
            <span className="worker-row__badges">
              <span className={`count-badge${warningCount ? " is-warning" : ""}`}>
                A {warningCount}
              </span>
              <span className={`count-badge${errorCount ? " is-error" : ""}`}>
                E {errorCount}
              </span>
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

function hasAutomaticNameSplitWarning(warnings) {
  return warnings.some((warning) => {
    const field = String(warning?.field || "");
    const message = normalizeSearch(warning?.message || "");

    return (
      (field === "identificacion.nombres" || field === "identificacion.apellidos") &&
      message.includes("separados automaticamente")
    );
  });
}

function WorkerSummary({
  worker,
  findings,
  reviewFlags = [],
  isEditing,
  onToggleEditing,
  onConfirm,
  onChangeWorker,
}) {
  const pendingReviewFields = getPendingReviewFields(worker, findings);
  const warnings = worker?.validation?.warnings || [];
  const shouldReviewNameSplit = hasAutomaticNameSplitWarning(warnings);

  return (
    <div className="detail-tab-panel">
      <KeyValueGrid
        className="key-grid--worker-summary"
        items={[
          {
            label: "Apellidos detectados",
            value: worker?.identificacion?.apellidos,
            className: "key-grid__item--span-4",
          },
          {
            label: "Nombres detectados",
            value: worker?.identificacion?.nombres,
            className: "key-grid__item--span-4",
          },
          {
            label: "DNI",
            value: worker?.identificacion?.dni,
            className: "key-grid__item--span-4",
          },
          {
            label: "Empresa",
            value: worker?.identificacion?.empresa,
            className: "key-grid__item--span-4",
          },
          {
            label: "Teléfono",
            value: worker?.datos_operativos?.telefono,
            className: "key-grid__item--span-4",
          },
          {
            label: "Archivo PDF completo",
            value: worker?.datos_operativos?.archivo_pdf_completo,
            className: "key-grid__item--span-4",
          },
          {
            label: "Fecha",
            value: worker?.identificacion?.fecha_evaluacion,
            className: "key-grid__item--span-4",
          },
          {
            label: "Aptitud",
            value: worker?.aptitud_y_recomendaciones?.aptitud_final,
            className: "key-grid__item--span-4",
          },
          {
            label: "Estado",
            value: formatReviewStatus(worker),
            className: "key-grid__item--span-3",
          },
          {
            label: "Errores",
            value: getErrorCount(worker),
            className: "key-grid__item--span-3",
          },
          {
            label: "Alertas",
            value: getWarningCount(worker),
            className: "key-grid__item--span-3",
          },
          {
            label: "Puede narrar",
            value: canSendToNarrative(worker) ? "si" : "no",
            className: "key-grid__item--span-3",
          },
        ]}
      />

      {shouldReviewNameSplit && (
        <div className="summary-review-badge" role="status">
          Revisar separacion
        </div>
      )}

      <div className="detail-actions">
        <button type="button" className="secondary-button" onClick={onToggleEditing}>
          {isEditing ? "Ocultar edicion" : "Editar campos"}
        </button>
        <button type="button" className="primary-button" onClick={onConfirm}>
          Confirmar trabajador
        </button>
      </div>

      {warnings.length > 0 && (
        <details className="technical-detail" open>
          <summary>Alertas principales</summary>
          <NarrativeList
            items={warnings.slice(0, 5)}
            emptyLabel="Sin alertas automaticas."
            renderItem={(warning) => `[${warning.severity}] ${warning.message}`}
          />
        </details>
      )}

      {reviewFlags.some((flag) => flag.confidence !== "automatic") && (
        <details className="technical-detail" open>
          <summary>Elementos a revisar</summary>
          <NarrativeList
            items={reviewFlags.filter((flag) => flag.confidence !== "automatic")}
            emptyLabel="Sin elementos clínicos pendientes."
            renderItem={(flag) => `${flag.message} (${flag.sourceField})`}
          />
        </details>
      )}

      {pendingReviewFields.length > 0 && (
        <p className="muted-text">
          Campos pendientes de revision: {pendingReviewFields.join(", ")}
        </p>
      )}

      {isEditing && (
        <div className="review-form-shell">
          <PdfWorkerReviewForm worker={worker} onChange={onChangeWorker} onConfirm={onConfirm} />
        </div>
      )}
    </div>
  );
}

function WorkerTextAudioPanel({
  draft,
  worker,
  workerIndex,
  onUpdateWorker,
  isDraftVisible,
  onDraftVisibilityChange,
  audioRequestGuard,
}) {
  const [isRegenerationConfirmationOpen, setIsRegenerationConfirmationOpen] = useState(false);
  const canUseAsFinal = Boolean(
    draft.can_generate && worker?.derived_states?.reviewed_by_user,
  );
  const finalText = draft.applyGreeting(worker?.app_fields?.texto_final || "");
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

  function handleUseAsFinal() {
    if (!canUseAsFinal || !draft.text) return;

    onUpdateWorker?.(workerIndex, (currentWorker) => {
      const currentHasAudio = hasExistingAudio(currentWorker.app_fields);

      return {
        ...currentWorker,
        derived_states: {
          ...(currentWorker.derived_states || {}),
          reviewed_by_user: true,
        },
        app_fields: {
          ...(currentWorker.app_fields || {}),
          texto_borrador: draft.text,
          texto_final: draft.text,
          audio_status: currentHasAudio
            ? currentWorker.app_fields.audio_status
            : "pendiente",
          audio_error: "",
          audio_stale: currentHasAudio,
          last_generated_at: new Date().toISOString(),
        },
      };
    });

    onDraftVisibilityChange(false);
  }

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
      ) : (
        <div className="narrative-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleUseAsFinal}
            disabled={!canUseAsFinal}
          >
            Generar texto final editable
          </button>
          <button
            type="button"
            className={`secondary-button${isDraftVisible ? " is-active-toggle" : ""}`}
            onClick={() => onDraftVisibilityChange(!isDraftVisible)}
          >
            {isDraftVisible ? "Ocultar borrador generado" : "Ver borrador generado"}
          </button>
        </div>
      )}

      <details className="draft-preview-shell" open={isDraftVisible}>
        <summary onClick={(event) => {
          event.preventDefault();
          onDraftVisibilityChange(!isDraftVisible);
        }}>
          Borrador generado
        </summary>
        <textarea
          className="editor-area pdf-editor pdf-editor--preview"
          value={draft.text}
          readOnly
          rows={8}
          aria-label="Borrador narrativo preliminar"
        />
      </details>

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
    </div>
  );
}

function TechnicalDetailsPanel({ worker, findings, reviewFlags = [] }) {
  const narrativeGroupEntries = Object.entries(findings.narrative_groups || {}).filter(
    ([, group]) => group.narrar,
  );
  const pendingReviewFields = getPendingReviewFields(worker, findings);
  const reviewedFields = getReviewedFields(findings);

  return (
    <div className="technical-stack">
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
  onConfirmWorker,
  onUpdateWorker,
  audioRequestGuard,
}) {
  const [activeTab, setActiveTab] = useState("summary");
  const [isEditing, setIsEditing] = useState(false);
  const [isDraftVisible, setIsDraftVisible] = useState(false);

  function handleConfirmWorker() {
    onConfirmWorker?.(workerIndex);
    setIsEditing(false);
    setActiveTab("text-audio");
    setIsDraftVisible(true);
  }

  return (
    <section className="pdf-detail-panel">
      <div className="pdf-detail-header">
        <div>
          <p className="section-label">Detalle del trabajador</p>
          <h3>{getWorkerName(worker)}</h3>
          <p className="section-text">
            {worker?.identificacion?.dni || "DNI pendiente"} ·{" "}
            {worker?.aptitud_y_recomendaciones?.aptitud_final || "Aptitud pendiente"}
          </p>
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
        {activeTab === "summary" && (
          <WorkerSummary
            worker={worker}
            findings={findings}
            reviewFlags={reviewFlags}
            isEditing={isEditing}
            onToggleEditing={() => setIsEditing((value) => !value)}
            onConfirm={handleConfirmWorker}
            onChangeWorker={(nextWorker) => onChangeWorker?.(workerIndex, nextWorker)}
          />
        )}

        {activeTab === "text-audio" && (
          <WorkerTextAudioPanel
            draft={draft}
            worker={worker}
            workerIndex={workerIndex}
            onUpdateWorker={onUpdateWorker}
            isDraftVisible={isDraftVisible}
            onDraftVisibilityChange={setIsDraftVisible}
            audioRequestGuard={audioRequestGuard}
          />
        )}

        {activeTab === "technical" && (
          <TechnicalDetailsPanel worker={worker} findings={findings} reviewFlags={reviewFlags} />
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
  onConfirmWorker,
  onUpdateWorker,
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [greeting, setGreeting] = useState(DEFAULT_NARRATIVE_GREETING);
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
        onGreetingChange={setGreeting}
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
            onConfirmWorker={onConfirmWorker}
            onUpdateWorker={onUpdateWorker}
            audioRequestGuard={audioRequestGuard}
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
