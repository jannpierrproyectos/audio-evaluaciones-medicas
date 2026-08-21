import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  collectBatchAudioObjectUrls,
  createBatchMetadata,
  resetBatchSnapshot,
} from "../src/lib/batchState.js";
import {
  MEDIWEB_SOURCE_MODE,
  PDF_SOURCE_MODE,
  getWorkerFullPdfName,
  getWorkerPhone,
  prepareAnalysisForReview,
} from "../src/lib/workerReviewUx.js";
import { attachMediwebWorkerMetadata } from "../src/lib/importMediwebPdf.js";

function syntheticAnalysis(fileName, pageCount, workerCount) {
  return {
    file_name: fileName,
    total_pages: pageCount,
    workers_detected: workerCount,
    workers: Array.from({ length: workerCount }, (_, index) => ({
      identificacion: { dni: String(index + 1) },
      app_fields: {},
      derived_states: {},
    })),
  };
}

test("iniciar MediWeb limpia lote, seleccion, metadata y audio sin cambiar saludo", () => {
  const revoked = [];
  const snapshot = {
    analysis: {
      ...syntheticAnalysis("lote-anterior.pdf", 10, 10),
      batch_metadata: { fileName: "lote-anterior.pdf", pageCount: 10, workerCount: 10 },
      workers: [
        { app_fields: { audio_url: "blob:audio-anterior" } },
        { app_fields: { audio_url: "https://example.test/audio.mp3" } },
      ],
    },
    selectedWorkerIndex: 4,
    preview: "texto anterior",
    greeting: "Buenas noches",
  };

  assert.deepEqual(collectBatchAudioObjectUrls(snapshot.analysis), ["blob:audio-anterior"]);
  const reset = resetBatchSnapshot(snapshot, (url) => revoked.push(url));

  assert.equal(reset.analysis, null);
  assert.equal(reset.selectedWorkerIndex, null);
  assert.equal(reset.preview, "");
  assert.equal(reset.greeting, "Buenas noches");
  assert.deepEqual(revoked, ["blob:audio-anterior"]);
});

test("MediWeb y PDF comparten metadata real del análisis", () => {
  const mediweb = prepareAnalysisForReview(
    syntheticAnalysis("lote-mediweb.pdf", 12, 12),
    MEDIWEB_SOURCE_MODE,
    "2026-08-20T12:00:00.000Z",
  );
  const manual = prepareAnalysisForReview(
    syntheticAnalysis("evaluaciones.pdf", 5, 5),
    PDF_SOURCE_MODE,
    "2026-08-20T12:00:00.000Z",
  );

  assert.deepEqual(mediweb.batch_metadata, {
    sourceMode: MEDIWEB_SOURCE_MODE,
    fileName: "lote-mediweb.pdf",
    pageCount: 12,
    workerCount: 12,
  });
  assert.deepEqual(manual.batch_metadata, {
    sourceMode: PDF_SOURCE_MODE,
    fileName: "evaluaciones.pdf",
    pageCount: 5,
    workerCount: 5,
  });
  assert.notEqual(mediweb.batch_metadata.fileName, manual.batch_metadata.fileName);
  assert.deepEqual(createBatchMetadata(manual), manual.batch_metadata);
});

test("el reset ocurre al iniciar operaciones, no al cambiar solamente de modo", async () => {
  const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const importerSource = await readFile(
    new URL("../src/components/MediwebImporter.jsx", import.meta.url),
    "utf8",
  );

  assert.match(appSource, /async function handlePdfSelected[\s\S]*?resetCurrentBatch\(\)/);
  assert.match(appSource, /onBatchStarted=\{resetCurrentBatch\}/);
  assert.match(appSource, /onClick=\{\(\) => setPdfSource\("manual"\)\}/);
  assert.match(appSource, /setPdfSource\("mediweb"\);\s*setMediwebActivated\(true\);/);
  assert.doesNotMatch(appSource, /setPdfSource\("mediweb"\);\s*resetCurrentBatch/);
  assert.match(
    importerSource,
    /await createMediwebJob[\s\S]*?onBatchStarted\?\.\(\)[\s\S]*?setJobId/,
  );
});

test("el resumen usa metadata propagada y no hardcodea el nombre MediWeb", async () => {
  const previewSource = await readFile(
    new URL("../src/components/PdfWorkersPreview.jsx", import.meta.url),
    "utf8",
  );

  assert.match(previewSource, /metadata\.fileName/);
  assert.match(previewSource, /metadata\.pageCount/);
  assert.match(previewSource, /metadata\.workerCount/);
  assert.doesNotMatch(previewSource, /primeras-hojas\.pdf|primeras-hojas-mediweb\.pdf/);
});

test("el encabezado conserva teléfono y PDF individual sin cruzar trabajadores", async () => {
  const mediweb = attachMediwebWorkerMetadata({
    groups: [{ start_page: 1 }, { start_page: 2 }],
    workers: [
      { identificacion: { dni: "11111111" } },
      { identificacion: { dni: "22222222" } },
    ],
  }, {
    workers: [
      {
        numeroDocumento: "22222222",
        paginaConsolidado: 2,
        telefono: "999222222",
        archivoPdfCompleto: "paciente-b.pdf",
      },
      {
        numeroDocumento: "11111111",
        paginaConsolidado: 1,
        telefono: "999111111",
        archivoPdfCompleto: "paciente-a.pdf",
      },
    ],
  });
  const manualWithPhone = {
    datos_operativos: { telefono: "933333333", archivo_pdf_completo: "manual-individual.pdf" },
  };
  const withoutPhone = { datos_operativos: { telefono: "" } };
  const phoneWithoutPdf = { datos_operativos: { telefono: "944444444" } };

  assert.equal(getWorkerPhone(mediweb.workers[0]), "999111111");
  assert.equal(getWorkerFullPdfName(mediweb.workers[0]), "paciente-a.pdf");
  assert.equal(getWorkerPhone(mediweb.workers[1]), "999222222");
  assert.equal(getWorkerFullPdfName(mediweb.workers[1]), "paciente-b.pdf");
  assert.notEqual(getWorkerFullPdfName(mediweb.workers[0]), "paciente-b.pdf");
  assert.notEqual(getWorkerFullPdfName(mediweb.workers[1]), "paciente-a.pdf");
  assert.equal(getWorkerPhone(manualWithPhone), "933333333");
  assert.equal(getWorkerFullPdfName(manualWithPhone), "manual-individual.pdf");
  assert.equal(getWorkerPhone(withoutPhone), "");
  assert.equal(getWorkerPhone(phoneWithoutPdf), "944444444");
  assert.equal(getWorkerFullPdfName(phoneWithoutPdf), "");
  assert.equal(getWorkerFullPdfName({}), "");
  assert.equal(getWorkerPhone({}), "");

  const previewSource = await readFile(
    new URL("../src/components/PdfWorkersPreview.jsx", import.meta.url),
    "utf8",
  );
  assert.match(previewSource, /workerPhone \? \(/);
  assert.match(previewSource, /Teléfono: \{workerPhone\}/);
  assert.match(previewSource, /workerFullPdfName \? \(/);
  assert.match(previewSource, /PDF: \{workerFullPdfName\}/);
  assert.match(previewSource, /title=\{workerFullPdfName\}/);
});
