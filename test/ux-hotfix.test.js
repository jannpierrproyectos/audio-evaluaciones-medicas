import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
