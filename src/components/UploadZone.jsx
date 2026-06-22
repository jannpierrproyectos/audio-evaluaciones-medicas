function UploadZone({
  panelId,
  sectionLabel,
  title,
  description,
  buttonLabel,
  fileHint,
  previewTitle,
  previewDescription,
  editablePreview = false,
  accept = "",
  onFileSelected,
  isProcessing = false,
  processingMessage = "Procesando archivo...",
  previewValue = "",
  previewContent = null,
}) {
  const inputId = `file-input-${panelId}`;

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (typeof onFileSelected === "function") {
      onFileSelected(file);
    }

    event.target.value = "";
  }

  return (
    <div
      className="import-layout"
      id={`panel-${panelId}`}
      role="tabpanel"
      aria-labelledby={`tab-${panelId}`}
    >
      <section className="panel upload-panel">
        <div className="panel__header">
          <div>
            <p className="section-label">{sectionLabel}</p>
            <h2>{title}</h2>
            <p className="section-text">{description}</p>
          </div>
        </div>

        <div className="upload-dropzone">
          <div className="upload-dropzone__icon" aria-hidden="true">
            <span></span>
          </div>

          <strong>Zona de carga preparada</strong>

          <p>
            Selecciona un archivo para iniciar la lectura y validacion inicial.
          </p>

          <input
            id={inputId}
            type="file"
            accept={accept}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          <label htmlFor={inputId} className="secondary-button">
            {isProcessing ? processingMessage : buttonLabel}
          </label>

          <span className="upload-hint">Formato esperado: {fileHint}</span>
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="panel__header">
          <div>
            <p className="section-label">Resultado esperado</p>
            <h3>{previewTitle}</h3>
            <p className="section-text">{previewDescription}</p>
          </div>
        </div>

        {previewContent ? (
          previewContent
        ) : editablePreview ? (
          <textarea
            className="editor-area editor-area--preview"
            value={
              previewValue ||
              `Campo trabajador: pendiente
Empresa: pendiente
Ficha: pendiente
Aptitud: pendiente

Esta vista previa editable simula el mapeo futuro desde PDF hacia la estructura estandar.`
            }
            readOnly
            aria-label="Vista previa editable"
          />
        ) : (
          <div className="preview-placeholder">
            {previewValue ||
              "La vista previa del archivo cargado aparecera aqui una vez que se conecte el procesamiento real."}
          </div>
        )}
      </section>
    </div>
  );
}

export default UploadZone;