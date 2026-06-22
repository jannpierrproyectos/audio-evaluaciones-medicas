import { useState } from "react";
import "./App.css";
import SheetsWorkspace from "./components/SheetsWorkspace.jsx";
import Tabs from "./components/Tabs.jsx";
import UploadZone from "./components/UploadZone.jsx";
import PdfWorkersPreview from "./components/PdfWorkersPreview.jsx";
import { analyzePdfBatch } from "./lib/data/pdf/analyzePdfBatch.js";
import { validateExtractedWorker } from "./lib/data/validateExtractedWorker.js";

const tabs = [
  {
    id: "pdf",
    label: "Importar PDF",
    description: "Flujo principal",
    primary: true,
  },
  {
    id: "sheets",
    label: "Sheets principal",
    description: "Opcion secundaria",
  },
  {
    id: "excel",
    label: "Importar Excel",
    description: "Proximamente",
  },
];

function App() {
  const [activeTab, setActiveTab] = useState("pdf");
  const [pdfPreview, setPdfPreview] = useState("");
  const [pdfAnalysis, setPdfAnalysis] = useState(null);
  const [selectedPdfWorkerIndex, setSelectedPdfWorkerIndex] = useState(0);
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);

  async function handlePdfSelected(file) {
    try {
      setIsPdfProcessing(true);
      setPdfAnalysis(null);
      setSelectedPdfWorkerIndex(0);
      setPdfPreview(`Procesando PDF: ${file.name}`);

      const analysis = await analyzePdfBatch(file);

      console.log("Resultado completo del analisis PDF:", analysis);

      setPdfAnalysis(analysis);
      setSelectedPdfWorkerIndex(0);
      setPdfPreview("");
    } catch (error) {
      console.error("Error analizando PDF:", error);
      setPdfAnalysis(null);

      setPdfPreview(
        `No se pudo procesar el PDF.

Detalle:
${error?.message || "Error desconocido"}`
      );
    } finally {
      setIsPdfProcessing(false);
    }
  }

  function updatePdfWorkerAtIndex(workerIndex, getNextWorker) {
    setPdfAnalysis((currentAnalysis) => {
      if (!currentAnalysis?.workers?.[workerIndex]) {
        return currentAnalysis;
      }

      const currentWorker = currentAnalysis.workers[workerIndex];
      const nextWorker =
        typeof getNextWorker === "function"
          ? getNextWorker(currentWorker)
          : getNextWorker;
      const validation = validateExtractedWorker(nextWorker);
      const reviewedByUser = Boolean(nextWorker.derived_states?.reviewed_by_user);
      const needsReview =
        validation.has_errors ||
        (!reviewedByUser &&
          (validation.has_warnings ||
            Boolean(nextWorker.derived_states?.needs_review) ||
            Boolean(nextWorker.app_fields?.needs_review)));
      const nextWorkers = currentAnalysis.workers.map((worker, index) => {
        if (index !== workerIndex) {
          return worker;
        }

        return {
          ...nextWorker,
          validation,
          derived_states: {
            ...(nextWorker.derived_states || {}),
            validation_warnings: validation.warnings,
            validation_error_count: validation.error_count,
            validation_warning_count: validation.warning_count,
            needs_review: needsReview,
          },
          app_fields: {
            ...(nextWorker.app_fields || {}),
            needs_review: needsReview,
          },
        };
      });

      return {
        ...currentAnalysis,
        workers: nextWorkers,
      };
    });
  }

  function handlePdfWorkerChange(workerIndex, nextWorker) {
    updatePdfWorkerAtIndex(workerIndex, {
      ...nextWorker,
      derived_states: {
        ...(nextWorker.derived_states || {}),
        reviewed_by_user: false,
        reviewed_at: "",
      },
      app_fields: {
        ...(nextWorker.app_fields || {}),
        needs_review: true,
      },
    });
  }

  function handlePdfWorkerConfirm(workerIndex) {
    updatePdfWorkerAtIndex(workerIndex, (currentWorker) => ({
      ...currentWorker,
      derived_states: {
        ...(currentWorker.derived_states || {}),
        needs_review: false,
        reviewed_by_user: true,
        reviewed_at: new Date().toISOString(),
      },
      app_fields: {
        ...(currentWorker.app_fields || {}),
        needs_review: false,
      },
    }));
  }

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
          <span className="meta-chip">Base visual lista para escalar</span>
        </div>
      </header>

      <main className="workspace">
        <section className="surface">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

          {activeTab === "sheets" && (
            <SheetsWorkspace isActive={activeTab === "sheets"} />
          )}

          {activeTab === "excel" && (
            <div className="tab-content">
              <UploadZone
                panelId="excel"
                sectionLabel="Importacion estandar"
                title="Importar Excel"
                description="Se aceptara un archivo Excel con el formato estandar definido por el sistema."
                buttonLabel="Seleccionar archivo Excel"
                fileHint=".xlsx o .xls"
                previewTitle="Vista previa"
                previewDescription="La estructura detectada y los registros listos para revision apareceran aqui."
                accept=".xlsx,.xls"
              />
            </div>
          )}

          {activeTab === "pdf" && (
            <div className="tab-content">
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

              {pdfPreview && (
                <div className="preview-placeholder placeholder-box--narrative">
                  {pdfPreview}
                </div>
              )}

              {pdfAnalysis ? (
                <PdfWorkersPreview
                  analysis={pdfAnalysis}
                  selectedWorkerIndex={selectedPdfWorkerIndex}
                  onSelectWorker={setSelectedPdfWorkerIndex}
                  onChangeWorker={handlePdfWorkerChange}
                  onConfirmWorker={handlePdfWorkerConfirm}
                  onUpdateWorker={updatePdfWorkerAtIndex}
                />
              ) : (
                !pdfPreview && (
                  <div className="preview-placeholder">
                    Selecciona un PDF para iniciar la extraccion y revision de trabajadores.
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
