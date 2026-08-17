import assert from "node:assert/strict";
import test from "node:test";
import { processWorkerClinicalNarrative } from "../src/clinical/index.js";
import { parseReferenceExpression } from "../src/lib/data/metabolicReference.js";
import { baseWorker } from "./fixtures/clinical-cases.js";

function simpleReference(raw = "70 - 100") {
  return { rawText: `VR. ${raw}`, expression: parseReferenceExpression(raw) };
}

function categories(entries) {
  return {
    rawText: entries.map(([label, expression]) => `${label}: ${expression}`).join(" | "),
    categories: entries.map(([labelRaw, expressionRaw, classification]) => ({
      labelRaw,
      expressionRaw,
      classification,
      expression: parseReferenceExpression(expressionRaw),
    })),
  };
}

const cholesterolReference = () => categories([
  ["Normal", "<200", "NORMAL"],
  ["Limite Alto", "200-239", "BORDERLINE_HIGH"],
  ["Alto", ">240", "HIGH"],
]);

const triglyceridesReference = () => categories([
  ["Normal", "<150", "NORMAL"],
  ["Limite Alto", "150-199", "BORDERLINE_HIGH"],
  ["Alto", "200-499", "HIGH"],
  ["Muy Alto", ">500", "VERY_HIGH"],
]);

function metabolicWorker({ glucose, cholesterol, triglycerides }) {
  return baseWorker({
    laboratorio_numerico: {
      ...(glucose === undefined ? {} : {
        glucosa_valor: glucose,
        glucosa_valor_fuente: String(glucose),
        glucosa_unidad: "mg/dL",
        glucosa_referencia: simpleReference(),
      }),
      ...(cholesterol === undefined ? {} : {
        colesterol_valor: cholesterol,
        colesterol_valor_fuente: String(cholesterol),
        colesterol_unidad: "mg/dL",
        colesterol_referencia: cholesterolReference(),
      }),
      ...(triglycerides === undefined ? {} : {
        trigliceridos_valor: triglycerides,
        trigliceridos_valor_fuente: String(triglycerides),
        trigliceridos_unidad: "mg/dL",
        trigliceridos_referencia: triglyceridesReference(),
      }),
    },
  });
}

test("agrupa glucosa, colesterol y triglicéridos normales sin valores", () => {
  const result = processWorkerClinicalNarrative(metabolicWorker({
    glucose: 90,
    cholesterol: 180,
    triglycerides: 120,
  }));

  assert.match(result.displayText, /resultados de glucosa, colesterol y triglicéridos se encuentran dentro de los rangos de referencia/i);
  assert.doesNotMatch(result.displayText, /\b(?:90|180|120)\b|mg\/dL/i);
  assert.doesNotMatch(result.ttsText, /\b(?:90|180|120)\b|miligramos por decilitro/i);
});

test("agrupa dos analitos normales e individualiza triglicéridos altos", () => {
  const result = processWorkerClinicalNarrative(metabolicWorker({
    glucose: 92,
    cholesterol: 180,
    triglycerides: 260,
  }));

  assert.match(result.displayText, /resultados de glucosa y colesterol se encuentran dentro de los rangos de referencia/i);
  assert.match(result.displayText, /triglicéridos son de 260 mg\/dL.+rango alto reportado/i);
  assert.doesNotMatch(result.displayText, /\b(?:92|180)\b/);
  assert.match(result.ttsText, /260 miligramos por decilitro/i);
});

test("resume triglicéridos normales e individualiza glucosa alta y colesterol límite alto", () => {
  const result = processWorkerClinicalNarrative(metabolicWorker({
    glucose: 118,
    cholesterol: 220,
    triglycerides: 100,
  }));

  assert.match(result.displayText, /resultado de triglicéridos se encuentra dentro del rango de referencia/i);
  assert.match(result.displayText, /glucosa es de 118 mg\/dL.+por encima del rango/i);
  assert.match(result.displayText, /colesterol total es de 220 mg\/dL.+límite alto/i);
  assert.doesNotMatch(result.displayText, /triglicéridos son de 100/i);
});

test("un único analito normal se resume sin valor exacto", () => {
  const result = processWorkerClinicalNarrative(metabolicWorker({ glucose: 96 }));

  assert.match(result.displayText, /resultado de glucosa se encuentra dentro del rango de referencia/i);
  assert.doesNotMatch(result.displayText, /\b96\b|mg\/dL/i);
});

test("omite musculoesquelético regular incluso con IMC elevado", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    datos_generales_narrables: { peso_kg: 82, talla_cm: 165, imc: 30.1 },
    evaluaciones_cualitativas: {
      musculoesqueletico_resultado: "EN REGULAR ESTADO FISICO MUSCULO ESQUELETICO RELACIONADO AL IMC",
    },
  }));

  assert.match(result.displayText, /índice de masa corporal/i);
  assert.doesNotMatch(result.displayText, /evaluación musculoesquelética|estado físico musculoesquelético/i);
});

test("conserva un hallazgo musculoesquelético anormal reconocido", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      musculoesqueletico_resultado: "SECUELA DE LESIÓN EN MANO DERECHA",
    },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "CONTROL POR TRAUMATOLOGIA",
    },
  }));

  assert.match(result.displayText, /secuela de lesión en mano derecha/i);
  assert.match(result.displayText, /traumatología/i);
});

test("anemia y recomendación fuente de Medicina Interna se narran juntas", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "ANEMIA" },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "CONTROL POR MEDICINA INTERNA",
    },
  }));

  assert.match(result.displayText, /Se reporta anemia\. Se recomienda (?:mantener )?control por medicina interna\./i);
  assert.doesNotMatch(result.displayText, /otros hallazgos.+anemia/i);
  assert.equal(result.findings.narrative_groups.medicina_interna.association_status, "SAFE_ASSOCIATION");
});

test("anemia sin recomendación no inventa Medicina Interna", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "ANEMIA" },
  }));

  assert.match(result.displayText, /anemia/i);
  assert.doesNotMatch(result.displayText, /medicina interna/i);
});

test("Medicina Interna sin anemia no inventa anemia", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "CONTROL POR MEDICINA INTERNA",
    },
  }));

  assert.match(result.displayText, /control por medicina interna/i);
  assert.doesNotMatch(result.displayText, /anemia/i);
});
