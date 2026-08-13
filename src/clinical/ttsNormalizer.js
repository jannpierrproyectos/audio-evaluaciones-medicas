import { TTS_ABBREVIATIONS, TTS_UNITS } from "./dictionaries.js";
import { normalizeNarrativeForDisplay } from "./narrativeBuilder.js";

const SMALL_NUMBERS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

export function numberToSpanish(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 999) return String(value);
  if (number < 30) return SMALL_NUMBERS[number];
  if (number === 100) return "cien";
  if (number < 100) {
    const unit = number % 10;
    return unit ? `${TENS[Math.floor(number / 10)]} y ${SMALL_NUMBERS[unit]}` : TENS[number / 10];
  }
  const remainder = number % 100;
  return remainder ? `${HUNDREDS[Math.floor(number / 100)]} ${numberToSpanish(remainder)}` : HUNDREDS[number / 100];
}

function normalizeBloodPressure(text) {
  return text.replace(
    /\b(\d{2,3})\s*\/\s*(\d{2,3})(?=\s*(?:mmHg|milímetros de mercurio))/giu,
    (_, systolic, diastolic) => `${numberToSpanish(systolic)} sobre ${numberToSpanish(diastolic)}`,
  );
}

function normalizePercentages(text) {
  return text.replace(/\b(\d{1,3})\s*%/g, (_, value) => `${numberToSpanish(value)} por ciento`);
}

export function prepareTextForTts(displayText, options = {}) {
  let text = normalizeNarrativeForDisplay(displayText);
  TTS_ABBREVIATIONS.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
  text = normalizeBloodPressure(text);
  TTS_UNITS.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
  text = normalizePercentages(text)
    .replace(/≤/g, " menor o igual que ")
    .replace(/≥/g, " mayor o igual que ")
    .replace(/</g, " menor que ")
    .replace(/>/g, " mayor que ")
    .replace(/±/g, " más o menos ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  const overrides = options.pronunciationOverrides || {};
  Object.entries(overrides).forEach(([display, pronunciation]) => {
    if (display && pronunciation) text = text.replaceAll(display, pronunciation);
  });
  return text;
}
