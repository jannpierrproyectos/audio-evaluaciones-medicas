import assert from "node:assert/strict";
import test from "node:test";

import { processWorkerClinicalNarrative } from "../src/clinical/index.js";
import { parseInnomedicMedicalResult } from "../src/lib/data/pdf/parseInnomedicMedicalResult.js";
import { baseWorker } from "./fixtures/clinical-cases.js";

function flagTypes(result) {
  return new Set(result.reviewFlags.map((flag) => flag.type));
}

function hemoglobinWorker(sex, value, range = {}, extra = {}) {
  return baseWorker({
    identificacion: { sexo: sex },
    laboratorio_numerico: {
      hemoglobina_valor: value,
      hemoglobina_unidad: "g/dl",
      ...range,
      ...extra,
    },
  });
}

const maleRange = {
  hemoglobina_rango_masculino_min: 13,
  hemoglobina_rango_masculino_max: 18,
};
const femaleRange = {
  hemoglobina_rango_femenino_min: 12,
  hemoglobina_rango_femenino_max: 16,
};

test("ECG sin cardiología se omite deliberadamente y queda informational", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { ecg_resultado: "BRADICARDIA SINUSAL" },
  }));
  assert.doesNotMatch(result.displayText, /bradicardia|electrocardiograma/i);
  assert.ok(flagTypes(result).has("ecg_not_narrated_no_cardiology_recommendation"));
  assert.ok(!flagTypes(result).has("orphan_recommendation"));
});

test("ECG con una recomendación cardiológica inequívoca narra ambos sin diagnóstico adicional", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { ecg_resultado: "BRADICARDIA SINUSAL" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR CARDIOLOGIA" },
  }));
  assert.match(result.displayText, /electrocardiograma se reporta bradicardia sinusal/i);
  assert.match(result.displayText, /control por cardiología/i);
  assert.doesNotMatch(result.displayText, /grave|causad|tratamiento/i);
  assert.ok(!flagTypes(result).has("orphan_recommendation"));
});

test("ECG y otro candidato cardiovascular conservan asociación ambigua", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      ecg_resultado: "BRADICARDIA SINUSAL",
      otros_hallazgos_resultado: "HIPERTENSION ARTERIAL CONTROLADA",
    },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR CARDIOLOGIA" },
  }));
  assert.doesNotMatch(result.displayText, /electrocardiograma se reporta/i);
  assert.ok(flagTypes(result).has("ecg_cardiology_association_ambiguous"));
  assert.ok(flagTypes(result).has("ambiguous_recommendation_mapping"));
});

for (const [source, expected, forbidden] of [
  ["ONICOMICOSIS", /se reporta onicomicosis/i, /descartar onicomicosis/i],
  ["DESCARTAR ONICOMICOSIS PEDIA BILATERAL", /se indica descartar onicomicosis en ambos pies/i, /presenta onicomicosis/i],
  ["SOSPECHA DE DERMATITIS", /se reporta sospecha de dermatitis/i, /presenta dermatitis/i],
  ["COMPATIBLE CON DERMATITIS", /hallazgo compatible con dermatitis/i, /presenta dermatitis/i],
]) {
  test(`dermatología preserva certeza fuente: ${source}`, () => {
    const result = processWorkerClinicalNarrative(baseWorker({
      evaluaciones_cualitativas: { otros_hallazgos_resultado: source },
    }));
    assert.match(result.displayText, expected);
    assert.doesNotMatch(result.displayText, forbidden);
    assert.doesNotMatch(result.displayText, /hallazgos dermatológicos registrados/i);
  });
}

test("dermatología solo narra la recomendación cuando existe en fuente", () => {
  const withoutRecommendation = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "ONICOMICOSIS" },
  }));
  const withRecommendation = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "ONICOMICOSIS" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR DERMATOLOGIA" },
  }));
  assert.doesNotMatch(withoutRecommendation.displayText, /se recomienda/i);
  assert.match(withRecommendation.displayText, /se recomienda evaluación por dermatología/i);
});

test("asociación segura elimina orphan y asociación ambigua permanece REVIEW", () => {
  const safe = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "INSUFICIENCIA VENOSA PERIFERICA I° BILATERAL" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "EVITAR BIPEDESTACION PROLONGADA Y REALIZAR PAUSAS PASIVAS" },
  }));
  const ambiguous = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "ALERGIA A LA CEFTRIAXONA INSUFICIENCIA VENOSA PERIFERICA I° BILATERAL" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "EVITAR USO DE MEDICAMENTO ALERGENO. EVITAR BIPEDESTACION PROLONGADA Y REALIZAR PAUSAS PASIVAS" },
  }));
  assert.ok(!flagTypes(safe).has("orphan_recommendation"));
  assert.match(safe.displayText, /evaluación vascular.*insuficiencia venosa periférica/i);
  assert.ok(flagTypes(ambiguous).has("ambiguous_other_findings_structure"));
  assert.ok(flagTypes(ambiguous).has("ambiguous_recommendation_mapping"));
  assert.doesNotMatch(ambiguous.displayText, /por ello, se recomienda/i);
});

test("recomendación sin hallazgo y recomendación general no inventan hallazgos", () => {
  const noFinding = processWorkerClinicalNarrative(baseWorker({
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR TRAUMATOLOGIA" },
  }));
  const general = processWorkerClinicalNarrative(baseWorker({
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL ANUAL" },
  }));
  assert.ok(flagTypes(noFinding).has("orphan_recommendation"));
  assert.doesNotMatch(noFinding.displayText, /por presentar|debido a/i);
  assert.ok(!flagTypes(general).has("orphan_recommendation"));
  assert.doesNotMatch(general.displayText, /por presentar|debido a/i);
});

test("otro hallazgo claro se narra neutralmente sin inventar recomendación", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HALLAZGO SINTETICO EXPLICITO" },
  }));
  assert.match(result.displayText, /otros hallazgos se registra hallazgo sintetico explicito/i);
  assert.doesNotMatch(result.displayText, /se recomienda/i);
  assert.ok(flagTypes(result).has("unsupported_pattern"));
});

test("parser extrae rangos de hemoglobina del documento y detecta variantes ambiguas", () => {
  const baseText = "Apellidos y Nombres: PERSONA SINTETICA DNI: 12345678 Edad: 30 Sexo: MASCULINO Empresa: EMPRESA SINTETICA Area: OPERATIVA Puesto de Trabajo: TECNICO Grupo Sanguineo: O POSITIVO Proyecto / Sede: SEDE RESUMEN DE RESULTADOS";
  const tail = "Glucosa 90 mg/dl Ficha Odontograma: - Otros: - RESTRICCIONES - APTITUD X APTO - RECOMENDACIONES Fecha de Emision: 01/01/2026 Firma y Sello del Medico";
  const parsed = parseInnomedicMedicalResult({ template_confidence: 1, start_page: 1, end_page: 1, pages: [{ text: `${baseText} Hemoglobina 14.5 g/dl V.R Hombres: 13.0 - 18.0 HEMOGRAMA COMPLETO Mujeres: 12.0 - 16.0 ${tail}` }] });
  const ambiguous = parseInnomedicMedicalResult({ template_confidence: 1, start_page: 1, end_page: 1, pages: [{ text: `${baseText} Hemoglobina 14.5 g/dl V.R Hombres: 13.0 - 18.0 Hombres: 14.0 - 17.0 Mujeres: 12.0 - 16.0 ${tail}` }] });
  assert.deepEqual([
    parsed.laboratorio_numerico.hemoglobina_rango_masculino_min,
    parsed.laboratorio_numerico.hemoglobina_rango_masculino_max,
    parsed.laboratorio_numerico.hemoglobina_rango_femenino_min,
    parsed.laboratorio_numerico.hemoglobina_rango_femenino_max,
  ], [13, 18, 12, 16]);
  assert.equal(parsed.laboratorio_numerico.hemoglobina_rango_ambiguo, false);
  assert.equal(ambiguous.laboratorio_numerico.hemoglobina_rango_ambiguo, true);
});

for (const [label, worker, expectedStatus, expectedText] of [
  ["masculina normal", hemoglobinWorker("MASCULINO", 14.5, maleRange), "NORMAL", /dentro del rango normal/i],
  ["masculina baja", hemoglobinWorker("MASCULINO", 12.9, maleRange), "LOW", /se encuentra baja/i],
  ["masculina alta", hemoglobinWorker("MASCULINO", 18.1, maleRange), "HIGH", /se encuentra elevada/i],
  ["femenina normal", hemoglobinWorker("FEMENINO", 13, femaleRange), "NORMAL", /dentro del rango normal/i],
  ["femenina baja", hemoglobinWorker("FEMENINO", 11.9, femaleRange), "LOW", /se encuentra baja/i],
  ["femenina alta", hemoglobinWorker("FEMENINO", 16.1, femaleRange), "HIGH", /se encuentra elevada/i],
]) {
  test(`hemoglobina usa únicamente rango fuente: ${label}`, () => {
    const result = processWorkerClinicalNarrative(worker);
    assert.equal(result.findings.laboratorio_basico.hemoglobina_estado, expectedStatus);
    assert.match(result.displayText, expectedText);
    assert.match(result.ttsText, /gramos por decilitro/i);
    assert.doesNotMatch(result.displayText, /anemia|policitemia/i);
  });
}

test("hemoglobina sin rango, ambigua o sin sexo no se clasifica", () => {
  const missing = processWorkerClinicalNarrative(hemoglobinWorker("MASCULINO", 12.9));
  const ambiguous = processWorkerClinicalNarrative(hemoglobinWorker("MASCULINO", 14.5, maleRange, { hemoglobina_rango_ambiguo: true }));
  const noSex = processWorkerClinicalNarrative(hemoglobinWorker("", 14.5, { ...maleRange, ...femaleRange }));
  for (const result of [missing, ambiguous, noSex]) {
    assert.equal(result.findings.laboratorio_basico.hemoglobina_estado, "");
    assert.doesNotMatch(result.displayText, /rango normal|se encuentra baja|se encuentra elevada/i);
  }
  assert.ok(flagTypes(missing).has("hemoglobin_reference_range_missing"));
  assert.ok(flagTypes(ambiguous).has("hemoglobin_reference_range_ambiguous"));
  assert.ok(flagTypes(noSex).has("hemoglobin_reference_range_ambiguous"));
});
