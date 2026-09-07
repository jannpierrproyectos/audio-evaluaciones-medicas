import test from "node:test";
import assert from "node:assert/strict";
import { numberToSpanish, prepareTextForTts } from "../src/clinical/ttsNormalizer.js";

test("verbaliza la fracción decimal como un número completo", () => {
  assert.equal(numberToSpanish(17), "diecisiete");

  for (const [input, expected] of [
    ["32.17", "treinta y dos punto diecisiete"],
    ["11.9", "once punto nueve"],
    ["0.84", "cero punto ochenta y cuatro"],
    ["26.4", "veintiséis punto cuatro"],
  ]) {
    assert.equal(prepareTextForTts(input), expected, input);
  }

  const seventeenFraction = prepareTextForTts("32.17");
  assert.doesNotMatch(seventeenFraction, /\buno\s+siete\b|unosiete/iu);
});

test("preserva verbalmente los ceros iniciales de la fracción", () => {
  for (const [input, expected] of [
    ["1.05", "uno punto cero cinco"],
    ["0.08", "cero punto cero ocho"],
    ["10.02", "diez punto cero dos"],
    ["1.00", "uno punto cero cero"],
  ]) {
    assert.equal(prepareTextForTts(input), expected, input);
  }
});

test("verbaliza fracciones frecuentes sin truncar ceros finales", () => {
  for (const [input, expected] of [
    ["1.0", "uno punto cero"],
    ["1.10", "uno punto diez"],
    ["1.25", "uno punto veinticinco"],
    ["1.50", "uno punto cincuenta"],
    ["1.75", "uno punto setenta y cinco"],
  ]) {
    assert.equal(prepareTextForTts(input), expected, input);
  }
});

test("mantiene presión, unidades, porcentajes y enteros sin regresiones", () => {
  const displayText = "PA: 120/80 mmHg. Hemoglobina: 14.2 g/dL. Glucosa: 220 mg/dL. Saturación: 98%.";
  const ttsText = prepareTextForTts(displayText);

  assert.equal(
    ttsText,
    "presión arterial: ciento veinte sobre ochenta milímetros de mercurio. Hemoglobina: catorce punto dos gramos por decilitro. Glucosa: 220 miligramos por decilitro. Saturación: 98 por ciento.",
  );
  assert.equal(displayText, "PA: 120/80 mmHg. Hemoglobina: 14.2 g/dL. Glucosa: 220 mg/dL. Saturación: 98%.");
});

test("la normalización decimal permanece idempotente", () => {
  const once = prepareTextForTts("IMC de 32.17. Hemoglobina de 14.2 g/dL y valor de 1.05.");
  assert.equal(prepareTextForTts(once), once);
  assert.doesNotMatch(once, /por decilitro por decilitro|punto punto/iu);
});
