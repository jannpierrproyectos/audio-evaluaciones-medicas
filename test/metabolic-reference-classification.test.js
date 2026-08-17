import assert from "node:assert/strict";
import test from "node:test";
import { processWorkerClinicalNarrative } from "../src/clinical/index.js";
import { prepareTextForTts } from "../src/clinical/ttsNormalizer.js";
import {
  classifyByCategories,
  classifyBySimpleRange,
  evaluateMetabolicSourceStatement,
  parseReferenceExpression,
} from "../src/lib/data/metabolicReference.js";
import { extractMetabolicLaboratory } from "../src/lib/data/pdf/extractMetabolicLaboratory.js";
import { validateExtractedWorker } from "../src/lib/data/validateExtractedWorker.js";
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

test("glucosa usa solo el rango fuente, incluidos decimales y ausencia", () => {
  assert.equal(classifyBySimpleRange(90, simpleReference()).classification, "NORMAL");
  assert.equal(classifyBySimpleRange(69, simpleReference()).classification, "LOW");
  assert.equal(classifyBySimpleRange(101, simpleReference()).classification, "HIGH");
  assert.equal(classifyBySimpleRange(13.5, simpleReference("13,5 - 17,5")).classification, "NORMAL");
  assert.equal(classifyBySimpleRange(90, null).reason, "REFERENCE_MISSING");
  assert.equal(classifyBySimpleRange(90, { rawText: "no interpretable" }).reason, "REFERENCE_UNRESOLVED");
});

test("parser genérico conserva operadores, inclusividad, decimales y guiones Unicode", () => {
  assert.deepEqual(parseReferenceExpression("≤ 13,5"), {
    type: "comparison", rawText: "≤ 13,5", operator: "<=", boundary: 13.5,
    min: null, max: 13.5, minInclusive: false, maxInclusive: true,
  });
  assert.equal(parseReferenceExpression("70–100").max, 100);
  assert.equal(parseReferenceExpression("70 — 100").min, 70);
  assert.equal(parseReferenceExpression(">= 200").minInclusive, true);
  assert.equal(parseReferenceExpression("> 200").minInclusive, false);
});

test("colesterol respeta categorías, límites, huecos, solapamientos y ausencia", () => {
  assert.equal(classifyByCategories(199.9, cholesterolReference()).classification, "NORMAL");
  assert.equal(classifyByCategories(200, cholesterolReference()).classification, "BORDERLINE_HIGH");
  assert.equal(classifyByCategories(239, cholesterolReference()).classification, "BORDERLINE_HIGH");
  assert.equal(classifyByCategories(241, cholesterolReference()).classification, "HIGH");
  assert.equal(classifyByCategories(240, cholesterolReference()).reason, "REFERENCE_GAP");
  const overlap = categories([
    ["Normal", "<201", "NORMAL"],
    ["Limite Alto", "200-239", "BORDERLINE_HIGH"],
  ]);
  assert.equal(classifyByCategories(200, overlap).reason, "REFERENCE_OVERLAP");
  assert.equal(classifyByCategories(200, null).reason, "REFERENCE_MISSING");
});

test("triglicéridos conserva normal, límite alto, alto, muy alto y el hueco impreso", () => {
  assert.equal(classifyByCategories(149.9, triglyceridesReference()).classification, "NORMAL");
  assert.equal(classifyByCategories(150, triglyceridesReference()).classification, "BORDERLINE_HIGH");
  assert.equal(classifyByCategories(200, triglyceridesReference()).classification, "HIGH");
  assert.equal(classifyByCategories(499, triglyceridesReference()).classification, "HIGH");
  assert.equal(classifyByCategories(501, triglyceridesReference()).classification, "VERY_HIGH");
  assert.equal(classifyByCategories(500, triglyceridesReference()).reason, "REFERENCE_GAP");
});

test("extracción PDF estructurada no confunde límites con una celda de valor vacía", () => {
  const item = (text, x, y, sourceIndex) => ({ text, x, y, width: text.length * 3, height: 7, page: 1, sourceIndex });
  const page = { page: 1, items: [
    item("Glucosa", 45, 530, 0), item("90 mg/dl", 115, 530, 1), item("VR. 70 - 100", 160, 530, 2),
    item("Trigliceridos", 45, 510, 3), item("180 mg/dl", 115, 510, 4),
    item("Normal: <150", 160, 518, 5), item("Límite Alto: 150 - 199", 160, 510, 6),
    item("Alto: 200 - 499", 160, 502, 7), item("Muy Alto: >500", 160, 494, 8),
    item("Colesterol", 45, 470, 9), item("mg/dl", 115, 470, 10),
    item("Normal: <200", 160, 478, 11), item("Limite Alto: 200 - 239", 160, 470, 12), item("Alto: >240", 160, 462, 13),
  ] };
  const laboratory = extractMetabolicLaboratory([page]);
  assert.equal(laboratory.glucosa_valor, 90);
  assert.equal(laboratory.trigliceridos_valor, 180);
  assert.equal(laboratory.colesterol_valor, null);
  assert.equal(laboratory.colesterol_referencia.categories.length, 3);
  assert.equal(laboratory.glucosa_referencia.page, 1);
  assert.ok(laboratory.glucosa_referencia.textItems.length > 0);
});

test("referencia ausente, ambigua o no interpretable genera REVIEW específico", () => {
  const missing = validateExtractedWorker(baseWorker({ laboratorio_numerico: { glucosa_valor: 90 } }));
  assert.ok(missing.warnings.some((warning) => warning.type === "glucose_reference_missing"));
  const ambiguous = validateExtractedWorker(baseWorker({
    laboratorio_numerico: { colesterol_valor: 240, colesterol_referencia: cholesterolReference() },
  }));
  assert.ok(ambiguous.warnings.some((warning) => warning.type === "cholesterol_reference_ambiguous"));
  const unresolved = validateExtractedWorker(baseWorker({
    laboratorio_numerico: {
      trigliceridos_valor: 180,
      trigliceridos_referencia: { categories: [{ classification: "NORMAL", labelRaw: "Normal", expression: null }] },
    },
  }));
  assert.ok(unresolved.warnings.some((warning) => warning.type === "triglycerides_classification_unresolved"));
});

test("narrativa clasifica sin inventar diagnóstico ni recomendación", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_valor_fuente: "110", glucosa_unidad: "mg/dL", glucosa_referencia: simpleReference(),
      colesterol_valor: 250, colesterol_valor_fuente: "250", colesterol_unidad: "mg/dL", colesterol_referencia: cholesterolReference(),
      trigliceridos_valor: 260, trigliceridos_valor_fuente: "260", trigliceridos_unidad: "mg/dL", trigliceridos_referencia: triglyceridesReference(),
    },
  }));
  assert.match(result.displayText, /glucosa es de 110 mg\/dL.+por encima del rango/);
  assert.match(result.displayText, /colesterol total es de 250 mg\/dL.+rango alto/);
  assert.match(result.displayText, /triglicéridos son de 260 mg\/dL.+rango alto/);
  assert.doesNotMatch(result.displayText, /diabetes|hiperglucemia|hipercolesterolemia|hipertrigliceridemia|nutrición|endocrinología|dieta/i);
});

test("clasificación objetiva no fuerza un mapeo metabólico ambiguo", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_unidad: "mg/dL", glucosa_referencia: simpleReference(),
      colesterol_valor: 250, colesterol_unidad: "mg/dL", colesterol_referencia: cholesterolReference(),
    },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "1. CONTROL POR NUTRICION 2. CONTROL POR ENDOCRINOLOGIA",
    },
  }));
  assert.ok(result.reviewFlags.some((flag) => flag.type === "ambiguous_recommendation_mapping"));
  assert.equal(result.findings.narrative_groups.metabolico.association_status, "AMBIGUOUS_ASSOCIATION");
});

test("hallazgo fuente equivalente no duplica la clasificación de colesterol", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      colesterol_valor: 220, colesterol_valor_fuente: "220", colesterol_unidad: "mg/dL", colesterol_referencia: cholesterolReference(),
    },
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HIPERCOLESTEROLEMIA LIMITE ALTO" },
  }));
  assert.equal((result.displayText.match(/colesterol/gi) || []).length, 1);
  assert.ok(result.findings.hallazgos_relevantes.some(
    (finding) => finding.rule_id === "metabolic_source_equivalent_suppressed",
  ));
});

test("fuente metabólica distingue equivalencia, información adicional y discrepancia", () => {
  const laboratory = {
    glucosa_valor: 110, glucosa_referencia: simpleReference(),
    colesterol_valor: 220, colesterol_referencia: cholesterolReference(),
    trigliceridos_valor: 180, trigliceridos_referencia: triglyceridesReference(),
  };
  assert.equal(
    evaluateMetabolicSourceStatement("HIPERCOLESTEROLEMIA LIMITE ALTO", laboratory).status,
    "EXACT_EQUIVALENT",
  );
  assert.equal(
    evaluateMetabolicSourceStatement("HIPERGLICEMIA EN TRATAMIENTO", laboratory).status,
    "ADDITIONAL_SOURCE_INFORMATION",
  );
  assert.equal(
    evaluateMetabolicSourceStatement("HIPERCOLESTEROLEMIA DEFINIDA", laboratory).status,
    "DISCREPANT",
  );
});

test("discrepancia fuente-numero conserva ambos datos y genera REVIEW específico", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      colesterol_valor: 180, colesterol_valor_fuente: "180", colesterol_unidad: "mg/dL",
      colesterol_referencia: cholesterolReference(),
    },
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HIPERCOLESTEROLEMIA DEFINIDA" },
  }));
  assert.ok(result.reviewFlags.some((flag) => flag.type === "metabolic_source_classification_conflict"));
  assert.match(result.displayText, /resultado de colesterol se encuentra dentro del rango de referencia/i);
  assert.doesNotMatch(result.displayText, /colesterol total es de 180/i);
  assert.match(result.displayText, /fuente también reporta hipercolesterolemia definida/i);
  assert.match(result.displayText, /requiere revisión/i);
});

test("una asociación metabólica uno a uno es segura y una múltiple no se fuerza", () => {
  const safe = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_unidad: "mg/dL", glucosa_referencia: simpleReference(),
    },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "1. CONTROL POR NUTRICION" },
  }));
  assert.equal(safe.findings.narrative_groups.metabolico.association_status, "SAFE_ASSOCIATION");
  assert.equal(safe.findings.narrative_groups.metabolico.association_scope, "FINDING");

  const ambiguous = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      colesterol_valor: 250, colesterol_referencia: cholesterolReference(),
      trigliceridos_valor: 260, trigliceridos_referencia: triglyceridesReference(),
    },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR NUTRICION" },
  }));
  assert.equal(ambiguous.findings.narrative_groups.metabolico.association_status, "AMBIGUOUS_ASSOCIATION");
});

test("recomendación conjunta explícitamente numerada se narra una vez para el bloque", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_unidad: "mg/dL", glucosa_referencia: simpleReference(),
      trigliceridos_valor: 260, trigliceridos_unidad: "mg/dL", trigliceridos_referencia: triglyceridesReference(),
    },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "PARA EL BLOQUE METABOLICO: CONTROL POR NUTRICION",
    },
  }));
  assert.equal(result.findings.narrative_groups.metabolico.association_status, "SAFE_ASSOCIATION");
  assert.equal(result.findings.narrative_groups.metabolico.association_scope, "BLOCK");
  assert.equal((result.displayText.match(/control por nutrición/gi) || []).length, 1);
  assert.match(result.displayText, /Como parte de las recomendaciones de la evaluación/);
});

test("hallazgo metabólico sin fuente no crea recomendación ni conducta", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_unidad: "mg/dL", glucosa_referencia: simpleReference(),
      colesterol_valor: 250, colesterol_unidad: "mg/dL", colesterol_referencia: cholesterolReference(),
      trigliceridos_valor: 260, trigliceridos_unidad: "mg/dL", trigliceridos_referencia: triglyceridesReference(),
    },
  }));
  assert.doesNotMatch(result.displayText, /nutrición|endocrinología|dieta|medicación/i);
});

test("información metabólica adicional de fuente se conserva sin inventar tratamiento", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      glucosa_valor: 110, glucosa_valor_fuente: "110", glucosa_unidad: "mg/dL",
      glucosa_referencia: simpleReference(),
    },
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HIPERGLICEMIA EN TRATAMIENTO" },
  }));
  assert.match(result.displayText, /fuente reporta hiperglicemia en tratamiento/i);
  assert.doesNotMatch(result.displayText, /medicaci[oó]n|f[aá]rmaco/i);
});

test("hipercolesterolemia fuente no genera especialidad, dieta ni medicación", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    laboratorio_numerico: {
      colesterol_valor: 220, colesterol_valor_fuente: "220", colesterol_unidad: "mg/dL",
      colesterol_referencia: cholesterolReference(),
    },
    evaluaciones_cualitativas: { otros_hallazgos_resultado: "HIPERCOLESTEROLEMIA LIMITE ALTO" },
  }));
  assert.doesNotMatch(result.displayText, /nutrici[oó]n|endocrinolog[ií]a|dieta|medicaci[oó]n/i);
});

test("control ORL sin hallazgo auditivo permanece TRUE orphan", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { audiometria_resultado: "-" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR OTORRINOLARINGOLOGIA" },
  }));
  assert.ok(result.reviewFlags.some((flag) => flag.type === "orphan_recommendation"));
  assert.doesNotMatch(result.displayText, /hipoacusia|p[eé]rdida auditiva/i);
});

test("TTS verbaliza mg/dL sin modificar decimales ni políticas ajenas", () => {
  assert.equal(
    prepareTextForTts("Su glucosa es de 90.5 mg/dL."),
    "Su glucosa es de 90.5 miligramos por decilitro.",
  );
});
