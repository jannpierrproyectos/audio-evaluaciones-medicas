import assert from "node:assert/strict";
import test from "node:test";
import { processWorkerClinicalNarrative } from "../src/clinical/index.js";
import { prepareTextForTts } from "../src/clinical/ttsNormalizer.js";
import { parseInnomedicMedicalResult } from "../src/lib/data/pdf/parseInnomedicMedicalResult.js";
import { validateExtractedWorker } from "../src/lib/data/validateExtractedWorker.js";
import { analyzeNarrativeCases } from "../scripts/lib/narrative-audit-core.js";
import { baseWorker } from "./fixtures/clinical-cases.js";

test("corrige restricciones y concordancia radiológica sin narrar estado musculoesquelético regular", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      radiografia_torax_resultado: "SIGNOS RADIOLOGICOS EN LOBULO SUEPERIOR DERECHO",
      musculoesqueletico_resultado: "EN REGULAR ESTADO FISICO MUSCULO ESQUELETICO",
    },
    aptitud_y_recomendaciones: {
      aptitud_final: "APTO CON RESTRICCIONES",
      restricciones_texto: "- USO DE PROTECCION AUDITIVA. - NO REALIZAR TRABAJO EN ALTURA.",
    },
  }));
  assert.match(result.displayText, /apto con restricciones/i);
  assert.doesNotMatch(result.displayText, /restricciónes|se evidencia signos|se evidencia en regular/i);
  assert.match(result.displayText, /se registran signos radiológicos en lóbulo superior derecho/i);
  assert.doesNotMatch(result.displayText, /musculoesquel/i);
  assert.doesNotMatch(result.displayText, /(?:,|y)\s+-\s+/i);
});

test("limpia numeración compacta y deduplica seguimiento por especialidad", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { audiometria_resultado: "HIPOACUSIA LEVE" },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "1Y2. SEGUIMIENTO Y CONTROL POR OTORRINOLARINGOLOGIA. SEGUIR INDICACIONES DE MEDICO ESPECIALISTA. PROXIMO CONTROL ANUAL.",
    },
  }));
  assert.doesNotMatch(result.displayText, /1Y2/i);
  assert.equal((result.displayText.match(/otorrinolaringología/gi) || []).length, 1);
  assert.match(result.displayText, /el próximo control está indicado de forma anual/i);
});

test("conecta hallazgos oftalmológicos y separa hallazgos genéricos delimitados", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      oftalmologia_resultado: "PRESBICIA PARCIALMENTE CORREGIDA AMETROPIA PTERIGION II° BILATERAL",
      otros_hallazgos_resultado: "HALLAZGO SINTETICO A; HALLAZGO SINTETICO B",
    },
  }));
  assert.match(result.displayText, /presbicia parcialmente corregida, ametropía, pterigión de segundo grado bilateral/i);
  assert.match(result.displayText, /hallazgo sintetico a y hallazgo sintetico b/i);
});

test("audiometría conserva hallazgo y recomendación sin causalidad artificial", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { audiometria_resultado: "OTRAS ALTERACIONES NO DEBIDAS A RUIDO" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "USO DE PROTECTORES AUDITIVOS EN ZONA DE RUIDO" },
  }));
  assert.match(result.displayText, /alteraciones no debidas a ruido\. Asimismo, se recomienda el uso de protectores/i);
  assert.doesNotMatch(result.displayText, /no debidas a ruido, por lo que/i);
});

test("normaliza comparadores en orden y expande EPP/dB solo en contexto seguro", () => {
  assert.equal(prepareTextForTts("Uso de EPP auditivo >= 85 dB."), "Uso de equipo de protección personal auditivo mayor o igual que 85 decibeles.");
  assert.equal(prepareTextForTts("Valor <= 10."), "Valor menor o igual que 10.");
  assert.equal(prepareTextForTts("Valor > 10 y < 20."), "Valor mayor que 10 y menor que 20.");
  assert.match(prepareTextForTts("Guantes de PVC."), /PVC/i);
});

test("normaliza símbolos TTS solo en contextos inequívocos y conserva presión arterial", () => {
  const text = prepareTextForTts("PA: 120/80 mmHg. Descartar alergia y/o parasitosis. Usar mascarilla/respirador. Guantes (nitrilo o PVC). Fecha 13/01/2027.");
  assert.match(text, /ciento veinte sobre ochenta milímetros de mercurio/i);
  assert.match(text, /y o parasitosis/i);
  assert.match(text, /mascarilla o respirador/i);
  assert.match(text, /nitrilo o PVC/i);
  assert.match(text, /trece de enero de dos mil veintisiete/i);
  assert.doesNotMatch(text, /[/()]/);
});

test("retira paréntesis de variante normal sin alterar el significado para TTS", () => {
  const text = prepareTextForTts("Se reporta bradicardia auricular (variante normal).");
  assert.equal(text, "Se reporta bradicardia auricular variante normal.");
  assert.doesNotMatch(text, /[()]/);
});

test("asocia unidad explícita de hemoglobina y conserva nombre multilínea completo", () => {
  const group = {
    template_confidence: 1,
    start_page: 1,
    end_page: 1,
    pages: [{
      text: "Clínica ÁREA DATOS DEL TRABAJADOR Apellidos y Nombres: PRUEBA FICTICIA ANA\nLUZ DNI: 12345678 Edad: 35 Sexo: MASCULINO Empresa: EMPRESA SINTETICA Area: OPERATIVA Puesto de Trabajo: TECNICO Grupo Sanguineo: O POSITIVO Proyecto / Sede: SEDE RESUMEN DE RESULTADOS PA: 120/80 mmHg Hemoglobina 14.5 g/dl Ficha Odontograma: - Otros: - RESTRICCIONES - APTITUD X APTO - RECOMENDACIONES Fecha de Emision: 01/01/2026 Firma y Sello del Medico",
    }],
  };
  const worker = parseInnomedicMedicalResult(group);
  assert.equal(worker.identificacion.nombre_completo_original, "PRUEBA FICTICIA ANA LUZ");
  assert.equal(worker.identificacion.nombres, "ANA LUZ");
  assert.equal(worker.laboratorio_numerico.hemoglobina_unidad, "g/dl");
});

test("reclasifica warnings conocidos y reserva unknown_value para lo no clasificado", () => {
  const worker = baseWorker({
    datos_generales_narrables: { imc: 26 },
    laboratorio_numerico: { glucosa_valor: 110, trigliceridos_valor: 160, colesterol_valor: 210 },
    evaluaciones_cualitativas: { ecg_resultado: "-", audiometria_resultado: "-" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "2Y3. CONTROL POR NUTRICION" },
    derived_states: { low_confidence_fields: ["identificacion.nombres"] },
  });
  const warnings = validateExtractedWorker(worker).warnings;
  const types = new Set(warnings.map((warning) => warning.type));
  [
    "identity_name_split_detected",
    "imc_recommendation_review",
    "glucose_reference_missing",
    "triglycerides_reference_missing",
    "cholesterol_reference_missing",
    "ecg_not_reported",
    "audiometry_not_reported",
    "recommendation_compact_numbering",
  ].forEach((type) => assert.ok(types.has(type), type));
  assert.equal(warnings.filter((warning) => warning.type === "unknown_value").length, 0);
});

test("decimales son solo informational y no convierten un caso en problemático", () => {
  const result = analyzeNarrativeCases([{
    caseNumber: 1,
    fileName: "sintetico.pdf",
    pageStart: 1,
    flags: [],
    rawClinical: {},
    displayText: "Su índice de masa corporal es 24.8.",
    ttsText: "Su índice de masa corporal es 24.8.",
  }]);
  assert.deepEqual(result.statusCounts, { ERROR: 0, REVIEW: 0, INFORMATIONAL: 1, OK: 0 });
});

test("divide restricciones extensas en oraciones sintácticas", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    aptitud_y_recomendaciones: {
      aptitud_final: "APTO CON RESTRICCIONES",
      restricciones_texto: "- USAR PROTECCION AUDITIVA. - USAR PROTECCION OCULAR. - EVITAR TRABAJO EN ALTURA. - REALIZAR PAUSAS DURANTE LA JORNADA.",
    },
  }));
  const longest = Math.max(...result.displayText.split(/(?<=[.!?])\s+/).map((sentence) => sentence.split(/\s+/).length));
  assert.ok(longest <= 50);
});
