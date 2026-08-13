import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClinicalText,
  normalizePersonName,
  processWorkerClinicalNarrative,
} from "../src/clinical/index.js";
import { prepareTextForTts } from "../src/clinical/ttsNormalizer.js";
import { clinicalCases, baseWorker } from "./fixtures/clinical-cases.js";
import { clinicalGolden } from "./fixtures/clinical-golden.js";

test("normaliza placeholders, mayúsculas, tildes y nombres sin inventar tildes", () => {
  assert.equal(normalizeClinicalText("  AUDIOMETRIA   NORMAL :  SIN ALTERACIONES  "), "Audiometría normal: sin alteraciones");
  assert.equal(normalizeClinicalText("N/A"), null);
  assert.equal(normalizeClinicalText("---"), null);
  assert.equal(normalizeClinicalText("SIN DATO"), null);
  assert.equal(normalizeClinicalText("GLUCOSA: 98mg/dL"), "Glucosa: 98 mg/dL");
  assert.equal(normalizePersonName("JUAN PEREZ GARCIA"), "Juan Perez Garcia");
});

test("prepara dicción sin modificar el display", () => {
  const display = "PA: 120/80 mmHg. IMC 24.8. Glucosa: 98 mg/dL. Saturación: 98%. ECG normal. Resultado ≥ 10 y < 20.";
  const tts = prepareTextForTts(display);
  assert.equal(display, "PA: 120/80 mmHg. IMC 24.8. Glucosa: 98 mg/dL. Saturación: 98%. ECG normal. Resultado ≥ 10 y < 20.");
  assert.equal(
    tts,
    "presión arterial: ciento veinte sobre ochenta milímetros de mercurio. índice de masa corporal 24.8. Glucosa: 98 miligramos por decilitro. Saturación: noventa y ocho por ciento. electrocardiograma normal. Resultado mayor o igual que 10 y menor que 20.",
  );
});

test("los diez fixtures sintéticos atraviesan el pipeline determinista", () => {
  Object.values(clinicalCases).forEach((worker) => {
    const first = processWorkerClinicalNarrative(worker);
    const second = processWorkerClinicalNarrative(worker);
    assert.deepEqual(first, second);
  });
});

test("golden: cinco narrativas display/TTS permanecen estables", () => {
  Object.entries(clinicalGolden).forEach(([key, expected]) => {
    const result = processWorkerClinicalNarrative(clinicalCases[key]);
    assert.equal(result.displayText, expected.displayText, `${key} display`);
    assert.equal(result.ttsText, expected.ttsText, `${key} TTS`);
  });
});

test("no inventa glucosa, audición ni diagnósticos ausentes", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { oftalmologia_resultado: "AMETROPIA" },
  }));
  assert.doesNotMatch(result.displayText, /glucosa/i);
  assert.doesNotMatch(result.displayText, /audici[oó]n|audiometr/i);
  assert.doesNotMatch(result.displayText, /diabetes|hipertensi[oó]n/i);
});

test("un conflicto no elige silenciosamente una interpretación", () => {
  const result = processWorkerClinicalNarrative(clinicalCases.J_CONFLICT);
  assert.equal(result.canGenerate, false);
  assert.equal(result.displayText, "");
  assert.ok(result.reviewFlags.some((flag) => flag.type === "conflicting_values"));
});

test("conserva un hallazgo desconocido y solicita revisión", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HALLAZGO NO CATALOGADO" },
  }));
  assert.match(result.displayText, /hallazgo no catalogado/i);
  assert.ok(result.reviewFlags.some((flag) => flag.type === "unsupported_pattern"));
});

test("los placeholders se conservan en raw y se omiten del modelo normalizado", () => {
  const result = processWorkerClinicalNarrative(clinicalCases.G_INCOMPLETE);
  assert.equal(result.rawWorker.datos_generales_narrables.imc, "N/A");
  assert.equal(result.normalizedWorker.datos_generales_narrables.imc, null);
  assert.doesNotMatch(result.displayText, /N\/A|SIN DATO|NO REGISTRA/);
});

test("golden A: solo resume áreas explícitamente normales", () => {
  const result = processWorkerClinicalNarrative(clinicalCases.A_NORMAL);
  assert.match(result.displayText, /No se reportan alteraciones relevantes en/);
  assert.match(result.displayText, /audiometría/);
  assert.match(result.displayText, /evaluación oftalmológica/);
  assert.match(result.displayText, /espirometría/);
  assert.doesNotMatch(result.displayText, /los demás exámenes/i);
});

test("golden B: sobrepeso y triglicéridos usan solo recomendaciones fuente", () => {
  const result = processWorkerClinicalNarrative(clinicalCases.B_METABOLIC);
  assert.match(result.displayText, /correspondiente a sobrepeso/);
  assert.match(result.displayText, /triglicéridos en límite alto/);
  assert.match(result.displayText, /control por nutrición/);
  assert.doesNotMatch(result.displayText, /medicamento|diabetes/i);
});

test("golden C, D y E: conserva interpretaciones fuente por especialidad", () => {
  const ophthalmology = processWorkerClinicalNarrative(clinicalCases.C_OPHTHALMOLOGY);
  const audiometry = processWorkerClinicalNarrative(clinicalCases.D_AUDIOMETRY);
  const spirometry = processWorkerClinicalNarrative(clinicalCases.E_SPIROMETRY);
  assert.match(ophthalmology.displayText, /ametropía/i);
  assert.match(ophthalmology.displayText, /oftalmología/i);
  assert.match(audiometry.displayText, /hipoacusia leve/i);
  assert.match(audiometry.displayText, /otorrinolaringología/i);
  assert.match(spirometry.displayText, /patrón restrictivo leve/i);
  assert.match(spirometry.displayText, /neumología/i);
});

test("deduplica recomendaciones equivalentes", () => {
  const result = processWorkerClinicalNarrative(clinicalCases.I_DUPLICATES);
  const matches = result.displayText.match(/control por oftalmología/gi) || [];
  assert.equal(matches.length, 1);
});
