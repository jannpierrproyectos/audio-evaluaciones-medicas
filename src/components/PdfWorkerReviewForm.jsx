const REVIEW_FIELDS = [
  {
    label: "Nombres",
    section: "identificacion",
    field: "nombres",
    type: "text",
  },
  {
    label: "Apellidos",
    section: "identificacion",
    field: "apellidos",
    type: "text",
  },
  {
    label: "DNI",
    section: "identificacion",
    field: "dni",
    type: "text",
  },
  {
    label: "Empresa",
    section: "identificacion",
    field: "empresa",
    type: "text",
  },
  {
    label: "Fecha evaluacion",
    section: "identificacion",
    field: "fecha_evaluacion",
    type: "text",
  },
  {
    label: "Aptitud final",
    section: "aptitud_y_recomendaciones",
    field: "aptitud_final",
    type: "select",
    options: ["APTO", "APTO CON RESTRICCIONES", "NO APTO", "PENDIENTE"],
  },
  {
    label: "Recomendaciones generales",
    section: "aptitud_y_recomendaciones",
    field: "recomendaciones_generales_texto",
    type: "textarea",
  },
  {
    label: "Oftalmologia",
    section: "evaluaciones_cualitativas",
    field: "oftalmologia_resultado",
    type: "textarea",
  },
  {
    label: "Audiometria",
    section: "evaluaciones_cualitativas",
    field: "audiometria_resultado",
    type: "textarea",
  },
  {
    label: "Espirometria",
    section: "evaluaciones_cualitativas",
    field: "espirometria_resultado",
    type: "textarea",
  },
  {
    label: "Otros hallazgos",
    section: "evaluaciones_cualitativas",
    field: "otros_hallazgos_resultado",
    type: "textarea",
  },
];

function getFieldValue(worker, section, field) {
  return worker?.[section]?.[field] ?? "";
}

function updateWorkerField(worker, section, field, value) {
  return {
    ...worker,
    [section]: {
      ...(worker?.[section] || {}),
      [field]: value,
    },
  };
}

function PdfWorkerReviewForm({ worker, onChange, onConfirm }) {
  if (!worker) {
    return null;
  }

  return (
    <form
      style={{ display: "grid", gap: "0.85rem" }}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm?.();
      }}
    >
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {REVIEW_FIELDS.map((item) => {
          const value = getFieldValue(worker, item.section, item.field);
          const id = `pdf-review-${item.section}-${item.field}`;

          return (
            <label key={id} htmlFor={id} style={{ display: "grid", gap: "0.35rem" }}>
              <span>
                <strong>{item.label}</strong>
              </span>

              {item.type === "textarea" ? (
                <textarea
                  id={id}
                  className="editor-area"
                  value={value}
                  rows={3}
                  onChange={(event) =>
                    onChange(
                      updateWorkerField(
                        worker,
                        item.section,
                        item.field,
                        event.target.value,
                      ),
                    )
                  }
                />
              ) : item.type === "select" ? (
                <select
                  id={id}
                  value={value}
                  onChange={(event) =>
                    onChange(
                      updateWorkerField(
                        worker,
                        item.section,
                        item.field,
                        event.target.value,
                      ),
                    )
                  }
                  style={{
                    width: "100%",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    padding: "0.7rem 0.75rem",
                    background: "var(--panel)",
                    color: "var(--text-strong)",
                  }}
                >
                  <option value="">Seleccionar</option>
                  {item.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type={item.type}
                  value={value}
                  onChange={(event) =>
                    onChange(
                      updateWorkerField(
                        worker,
                        item.section,
                        item.field,
                        event.target.value,
                      ),
                    )
                  }
                  style={{
                    width: "100%",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    padding: "0.7rem 0.75rem",
                    background: "var(--panel)",
                    color: "var(--text-strong)",
                  }}
                />
              )}
            </label>
          );
        })}
      </div>

      <button type="submit" className="primary-button">
        Confirmar trabajador
      </button>
    </form>
  );
}

export default PdfWorkerReviewForm;
