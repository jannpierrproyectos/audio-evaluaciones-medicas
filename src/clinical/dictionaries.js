export const EMPTY_CLINICAL_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  "---",
  "N/A",
  "NA",
  "NO APLICA",
  "NO REGISTRA",
  "SIN DATO",
  "NULL",
  "UNDEFINED",
]);

export const CLINICAL_ACRONYMS = [
  "IMC",
  "ECG",
  "VIH",
  "VHB",
  "VHC",
  "TGO",
  "TGP",
  "HDL",
  "LDL",
  "FEV1",
  "FVC",
];

export const CLINICAL_ACCENT_REPLACEMENTS = [
  [/\boftalmologia\b/giu, "oftalmología"],
  [/\baudiometria\b/giu, "audiometría"],
  [/\bespirometria\b/giu, "espirometría"],
  [/\bcardiologia\b/giu, "cardiología"],
  [/\bpsicologia\b/giu, "psicología"],
  [/\bvision\b/giu, "visión"],
  [/\baudicion\b/giu, "audición"],
  [/\brestriccion(es)?\b/giu, (_, suffix = "") => `restricción${suffix}`],
  [/\bevaluacion(es)?\b/giu, (_, suffix = "") => `evaluación${suffix}`],
  [/\bhipertension\b/giu, "hipertensión"],
  [/\bnutricion\b/giu, "nutrición"],
  [/\bendocrinologia\b/giu, "endocrinología"],
  [/\bmedicion\b/giu, "medición"],
  [/\bpresion\b/giu, "presión"],
  [/\bpatron(es)?\b/giu, (_, suffix = "") => `patrón${suffix}`],
  [/\bfisica\b/giu, "física"],
  [/\bcalorias\b/giu, "calorías"],
  [/\bindice\b/giu, "índice"],
  [/\bmusculo[ -]?esqueletico\b/giu, "musculoesquelético"],
];

export const TTS_ABBREVIATIONS = [
  [/\bIMC\b/g, "índice de masa corporal"],
  [/\bECG\b/g, "electrocardiograma"],
  [/\bPA(?=\s*[:=]|\s+fue|\s+de)\b/g, "presión arterial"],
  [/\bFEV1\b/g, "efe, e, uve, uno"],
  [/\bFVC\b/g, "efe, uve, ce"],
  [/\bHDL\b/g, "hache, de, ele"],
  [/\bLDL\b/g, "ele, de, ele"],
];

export const TTS_UNITS = [
  [/\bmg\s*\/\s*dL\b/giu, "miligramos por decilitro"],
  [/\bmmHg\b/giu, "milímetros de mercurio"],
  [/\bkg\b/giu, "kilogramos"],
  [/\bcm\b/giu, "centímetros"],
  [/(\d(?:[.,]\d+)?)\s*m\b/giu, "$1 metros"],
];
