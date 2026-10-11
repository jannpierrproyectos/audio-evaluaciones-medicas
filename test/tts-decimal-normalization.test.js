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

test("omite unidades y porcentajes sin alterar presión, decimales y enteros", () => {
  const displayText = "PA: 120/80 mmHg. Hemoglobina: 14.2 g/dL. Glucosa: 220 mg/dL. Saturación: 98%.";
  const ttsText = prepareTextForTts(displayText);

  assert.equal(
    ttsText,
    "presión arterial: ciento veinte sobre ochenta. Hemoglobina: catorce punto dos. Glucosa: 220. Saturación: 98.",
  );
  assert.equal(displayText, "PA: 120/80 mmHg. Hemoglobina: 14.2 g/dL. Glucosa: 220 mg/dL. Saturación: 98%.");
});

test("conserva solo kilogramos y centímetros, también con unidades escritas", () => {
  assert.equal(
    prepareTextForTts("Peso 72 kg. Talla 165 cm. IMC 26.4 kg/m². Glucosa 90.5 miligramos por decilitro. PA: 120/80 milímetros de mercurio. Ruido >= 85 dB. Valor 14.2 (g/dL)."),
    "Peso 72 kilogramos. Talla 165 centímetros. índice de masa corporal veintiséis punto cuatro. Glucosa noventa punto cinco. presión arterial: ciento veinte sobre ochenta. Ruido mayor o igual que 85. Valor catorce punto dos.",
  );
  assert.equal(prepareTextForTts("98 por ciento. 26 kilogramos por metro cuadrado. Control en 6 meses. ECG normal."),
    "98. 26. Control en 6 meses. electrocardiograma normal.");
});

test("la normalización decimal permanece idempotente", () => {
  const once = prepareTextForTts("IMC de 32.17. Hemoglobina de 14.2 g/dL y valor de 1.05.");
  assert.equal(prepareTextForTts(once), once);
  assert.doesNotMatch(once, /por decilitro por decilitro|punto punto/iu);
});

test("omite unidades pegadas al valor sin afectar siglas, fechas ni decimales", () => {
  assert.equal(prepareTextForTts("Hemoglobina: 14.2g/dL. Pulso: 72lpm. Temperatura: 36.5°C. Frecuencia: 4000 Hz. HDL y LDL. Control: 13/01/2027."),
    "Hemoglobina: catorce punto dos. Pulso: 72. Temperatura: treinta y seis punto cinco. Frecuencia: 4000. hache, de, ele y ele, de, ele. Control: trece de enero de dos mil veintisiete.");
});
