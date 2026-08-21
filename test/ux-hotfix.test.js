import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { processWorkerClinicalNarrative } from "../src/clinical/index.js";
import { prepareTextForTts } from "../src/clinical/ttsNormalizer.js";
import {
  DEFAULT_NARRATIVE_GREETING,
  applyNarrativeGreeting,
} from "../src/lib/narrativeGreeting.js";
import {
  createAudioRequestGuard,
  getAudioGenerationIntent,
  hasExistingAudio,
} from "../src/lib/audioRequestGuard.js";
import {
  MEDIWEB_SOURCE_MODE,
  PDF_SOURCE_MODE,
  prepareAnalysisForReview,
  resolveEditableNarrative,
} from "../src/lib/workerReviewUx.js";

const BASE_NARRATIVE =
  "Buenos días, señor Juan Pérez. Le saludamos de parte de la clínica Innomedic.";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createSyntheticAudioFlow() {
  const guard = createAudioRequestGuard();
  let requestCount = 0;
  let audioUrl = "";

  return {
    guard,
    get requestCount() {
      return requestCount;
    },
    get audioUrl() {
      return audioUrl;
    },
    async generate(workerKey, request) {
      if (!guard.start(workerKey)) return false;

      try {
        requestCount += 1;
        const result = await request();
        if (!result?.audioUrl) throw new Error("Audio inválido");
        audioUrl = result.audioUrl;
        return true;
      } finally {
        guard.finish(workerKey);
      }
    },
  };
}

test("el saludo por defecto conserva Buenos días", () => {
  assert.equal(DEFAULT_NARRATIVE_GREETING, "Buenos días");
  assert.match(applyNarrativeGreeting(BASE_NARRATIVE), /^Buenos días,/);
});

test("el selector permite aplicar Buenas tardes y Buenas noches al displayText", () => {
  assert.match(
    applyNarrativeGreeting(BASE_NARRATIVE, "Buenas tardes"),
    /^Buenas tardes,/,
  );
  assert.match(
    applyNarrativeGreeting(BASE_NARRATIVE, "Buenas noches"),
    /^Buenas noches,/,
  );
});

test("cambiar varias veces deja exactamente un saludo inicial", () => {
  let displayText = applyNarrativeGreeting(BASE_NARRATIVE, "Buenas tardes");
  displayText = applyNarrativeGreeting(displayText, "Buenas noches");
  displayText = applyNarrativeGreeting(displayText, "Buenos días");

  assert.equal(
    (displayText.match(/Buenos días|Buenas tardes|Buenas noches/g) || []).length,
    1,
  );
  assert.match(displayText, /^Buenos días,/);
});

test("displayText y ttsText conservan el mismo saludo seleccionado", () => {
  const displayText = applyNarrativeGreeting(BASE_NARRATIVE, "Buenas tardes");
  const ttsText = prepareTextForTts(displayText);

  assert.match(displayText, /^Buenas tardes,/);
  assert.match(ttsText, /^Buenas tardes,/);
  assert.doesNotMatch(ttsText, /^Buenos días|^Buenas noches/);
});

test("el primer clic sintético realiza una sola llamada TTS mockeada", async () => {
  const flow = createSyntheticAudioFlow();
  const generated = await flow.generate("worker-a", async () => ({
    audioUrl: "blob:mock-audio",
  }));

  assert.equal(generated, true);
  assert.equal(flow.requestCount, 1);
  assert.equal(flow.audioUrl, "blob:mock-audio");
});

test("dos clics rápidos mantienen una sola request activa por trabajador", async () => {
  const flow = createSyntheticAudioFlow();
  const deferred = createDeferred();
  const firstRequest = flow.generate("worker-a", () => deferred.promise);
  const secondRequest = flow.generate("worker-a", async () => ({
    audioUrl: "blob:unexpected",
  }));

  assert.equal(flow.guard.isActive("worker-a"), true);
  assert.equal(flow.requestCount, 1);
  assert.equal(await secondRequest, false);

  deferred.resolve({ audioUrl: "blob:mock-audio" });
  assert.equal(await firstRequest, true);
  assert.equal(flow.guard.isActive("worker-a"), false);
  assert.equal(flow.requestCount, 1);
});

test("un audio existente exige confirmación y Cancelar no llama TTS", () => {
  const appFields = { audio_url: "blob:existing-audio" };
  const flow = createSyntheticAudioFlow();

  assert.equal(hasExistingAudio(appFields), true);
  assert.equal(getAudioGenerationIntent(appFields), "confirm");
  assert.equal(flow.requestCount, 0);
  assert.equal(flow.audioUrl, "");
});

test("Regenerar audio confirmado permite exactamente una nueva llamada", async () => {
  const appFields = { audio_url: "blob:existing-audio" };
  const flow = createSyntheticAudioFlow();

  assert.equal(
    getAudioGenerationIntent(appFields, { regenerationConfirmed: true }),
    "generate",
  );
  await flow.generate("worker-a", async () => ({ audioUrl: "blob:new-audio" }));

  assert.equal(flow.requestCount, 1);
  assert.equal(flow.audioUrl, "blob:new-audio");
});

test("un error no crea audio ni exige confirmación para el reintento", async () => {
  const flow = createSyntheticAudioFlow();

  await assert.rejects(
    flow.generate("worker-a", async () => {
      throw new Error("TTS mock falló");
    }),
    /TTS mock falló/,
  );

  assert.equal(flow.audioUrl, "");
  assert.equal(getAudioGenerationIntent({ audio_url: flow.audioUrl }), "generate");

  await flow.generate("worker-a", async () => ({ audioUrl: "blob:retry-audio" }));
  assert.equal(flow.requestCount, 2);
  assert.equal(flow.audioUrl, "blob:retry-audio");
});

test("la interfaz expone estado generando y confirmación con acciones seguras", async () => {
  const componentSource = await readFile(
    new URL("../src/components/PdfWorkersPreview.jsx", import.meta.url),
    "utf8",
  );
  assert.match(componentSource, /disabled={!canGenerateAudio}/);
  assert.match(componentSource, /Generando audio\.\.\./);
  assert.match(componentSource, /role="alertdialog"/);
  assert.match(componentSource, />\s*Cancelar\s*</);
  assert.match(componentSource, />\s*Regenerar audio\s*</);
});

test("MediWeb auto-confirma trabajadores sin eliminar validacion ni flags", () => {
  const warning = { severity: "REVIEW", message: "Revisar dato" };
  const analysis = prepareAnalysisForReview({
    workers: [{
      derived_states: { reviewed_by_user: false, needs_review: true },
      app_fields: { needs_review: true },
      validation: { warnings: [warning], has_errors: false },
      review_flags: [{ type: "synthetic_flag" }],
    }],
  }, MEDIWEB_SOURCE_MODE, "2026-08-20T12:00:00.000Z");

  assert.equal(analysis.source_mode, MEDIWEB_SOURCE_MODE);
  assert.equal(analysis.workers[0].derived_states.reviewed_by_user, true);
  assert.equal(analysis.workers[0].app_fields.needs_review, false);
  assert.deepEqual(analysis.workers[0].validation.warnings, [warning]);
  assert.deepEqual(analysis.workers[0].review_flags, [{ type: "synthetic_flag" }]);
});

test("el PDF manual usa la misma auto-confirmacion de interfaz y conserva errores", () => {
  const error = { severity: "ERROR", message: "Dato bloqueante" };
  const analysis = prepareAnalysisForReview({
    workers: [{
      derived_states: { reviewed_by_user: false },
      validation: { errors: [error], has_errors: true },
    }],
  }, PDF_SOURCE_MODE);

  assert.equal(analysis.source_mode, PDF_SOURCE_MODE);
  assert.equal(analysis.workers[0].derived_states.reviewed_by_user, true);
  assert.equal(analysis.workers[0].validation.has_errors, true);
  assert.deepEqual(analysis.workers[0].validation.errors, [error]);

  const clinicalResult = processWorkerClinicalNarrative({
    ...analysis.workers[0],
    identificacion: { nombres: "Ana", apellidos: "Prueba" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
  });
  assert.equal(clinicalResult.canGenerate, false);
  assert.ok(clinicalResult.blockingReasons.some((reason) => /errores/i.test(reason)));
});

test("MediWeb precarga el texto generado y preserva una edicion guardada", () => {
  assert.equal(resolveEditableNarrative({
    savedText: "",
    generatedText: "Narrativa ya generada",
  }), "Narrativa ya generada");
  assert.equal(resolveEditableNarrative({
    savedText: "Edicion manual",
    generatedText: "Narrativa ya generada",
  }), "Edicion manual");
});

test("PDF precarga la narrativa y da prioridad a la edicion manual", () => {
  assert.equal(resolveEditableNarrative({
    savedText: "",
    generatedText: "Narrativa ya generada",
  }), "Narrativa ya generada");
  assert.equal(resolveEditableNarrative({
    savedText: "Edicion PDF",
    generatedText: "Narrativa ya generada",
  }), "Edicion PDF");
});

test("MediWeb y PDF comparten Texto y audio y relegan auditoria a detalles", async () => {
  const componentSource = await readFile(
    new URL("../src/components/PdfWorkersPreview.jsx", import.meta.url),
    "utf8",
  );
  const reviewFormSource = await readFile(
    new URL("../src/components/PdfWorkerReviewForm.jsx", import.meta.url),
    "utf8",
  );

  const technicalStart = componentSource.indexOf("function TechnicalDetailsPanel");
  const operationalSource = componentSource.slice(0, technicalStart);
  const technicalSource = componentSource.slice(technicalStart);

  assert.match(componentSource, /useState\("text-audio"\)/);
  assert.doesNotMatch(componentSource, /id: "summary"/);
  assert.doesNotMatch(`${componentSource}\n${reviewFormSource}`, /Confirmar trabajador/);
  assert.doesNotMatch(componentSource, />\s*Generar texto final editable\s*</);
  assert.doesNotMatch(operationalSource, /Alertas principales|Elementos a revisar|Borrador generado/);
  assert.match(technicalSource, /<summary>Alertas principales<\/summary>/);
  assert.match(technicalSource, /<summary>Elementos a revisar<\/summary>/);
  assert.match(technicalSource, /<summary>Ver borrador original<\/summary>/);
  assert.match(componentSource, /trace=\{clinicalResult\.trace\}/);
  assert.match(componentSource, /!worker\?\.validation\?\.has_errors/);
});
