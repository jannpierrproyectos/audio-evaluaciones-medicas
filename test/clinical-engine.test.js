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
  assert.match(result.displayText, /triglicéridos son de 180 mg\/dL.+rango límite alto/);
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

function structuredOtherLines(...texts) {
  return texts.map((text, index) => ({
    text,
    page: 1,
    x: 147,
    y: 320 - index * 8.25,
    width: text.length * 4,
    height: 7.5,
    sourceIndex: index,
    textItems: [{ text, x: 147, y: 320 - index * 8.25, page: 1 }],
  }));
}

test("asocia de forma segura hallazgo y recomendación dermatológica estructurados", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      otros_hallazgos_resultado: "DESCARTAR ONICOMICOSIS PEDIA DERECHA",
      otros_hallazgos_items: structuredOtherLines("DESCARTAR ONICOMICOSIS PEDIA DERECHA"),
    },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "EVALUACIÓN POR DERMATOLOGÍA." },
  }));
  assert.equal(result.findings.narrative_groups.dermatologia.association_status, "SAFE_ASSOCIATION");
  assert.ok(!result.reviewFlags.some((flag) => flag.type === "orphan_recommendation"));
});

test("asocia de forma segura hallazgos vascular y alérgico en líneas independientes", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      otros_hallazgos_resultado: "INSUFICIENCIA VENOSA PERIFERICA I° BILATERAL ALERGIA A LA CEFTRIAXONA",
      otros_hallazgos_items: structuredOtherLines(
        "INSUFICIENCIA VENOSA PERIFERICA I° BILATERAL",
        "ALERGIA A LA CEFTRIAXONA",
      ),
    },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "1. REALIZAR PAUSAS PASIVAS Y EVITAR BIPEDESTACIÓN PROLONGADA. 2. EVITAR USO DE MEDICAMENTO ALÉRGENO.",
    },
  }));
  assert.equal(result.findings.narrative_groups.vascular.association_status, "SAFE_ASSOCIATION");
  assert.equal(result.findings.narrative_groups.alergias.association_status, "SAFE_ASSOCIATION");
  assert.ok(!result.reviewFlags.some((flag) => flag.type === "ambiguous_other_findings_structure"));
});

test("vincula un hallazgo musculoesquelético explícito con una única recomendación traumatológica", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { musculoesqueletico_resultado: "SECUELA DE LESIÓN EN MANO DERECHA" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR TRAUMATOLOGÍA." },
  }));
  assert.equal(result.findings.narrative_groups.traumatologia.association_status, "SAFE_ASSOCIATION");
  assert.match(result.displayText, /secuela de lesión en mano derecha/i);
  assert.ok(!result.reviewFlags.some((flag) => flag.type === "orphan_recommendation"));
});

test("detecta hallazgo oftalmológico mixto con emetropía y lo asocia", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: { oftalmologia_resultado: "EMETROPE PTERIGION DE II° OJO DERECHO" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "USO DE HIDRATANTES OCULARES. CONTROL POR OFTALMOLOGÍA." },
  }));
  assert.equal(result.findings.narrative_groups.oftalmologia.association_status, "SAFE_ASSOCIATION");
  assert.match(result.displayText, /pterigión/i);
  assert.ok(!result.reviewFlags.some((flag) => flag.type === "orphan_recommendation"));
});

test("dos hallazgos del área con una recomendación potencial permanecen en REVIEW", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      otros_hallazgos_resultado: "MICOSIS DERMATITIS",
      otros_hallazgos_items: structuredOtherLines("MICOSIS", "DERMATITIS"),
    },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR DERMATOLOGÍA." },
  }));
  assert.equal(result.findings.narrative_groups.dermatologia.association_status, "AMBIGUOUS_ASSOCIATION");
  assert.ok(result.reviewFlags.some((flag) => flag.type === "ambiguous_recommendation_mapping"));
});

test("correctores oculares sin hallazgo siguen siendo TRUE orphan", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "NO REALIZAR ACTIVIDADES SIN EL USO OBLIGATORIO DE CORRECTORES OCULARES.",
    },
  }));
  assert.ok(result.reviewFlags.some((flag) => flag.type === "orphan_recommendation"));
  assert.equal(result.findings.narrative_groups.oftalmologia.hallazgos.length, 0);
});

test("narra cinco hallazgos fuente de forma neutral sin inventar conducta", () => {
  const inputs = [
    ["EOSINOFILIA: DESCARTAR PARASITOSIS Y/O ALERGIAS", /eosinofilia: descartar parasitosis y\/o alergias/i],
    ["FARINGITIS", /se registra faringitis/i],
    ["LEUCOPENIA", /se registra leucopenia/i],
    ["LIPOMATOSIS EN MANO DERECHA", /lipomatosis en mano derecha/i],
    ["QUEMADURA DE TERCER GRADO", /quemadura de tercer grado/i],
  ];
  inputs.forEach(([source, expected]) => {
    const result = processWorkerClinicalNarrative(baseWorker({
      evaluaciones_cualitativas: {
        otros_hallazgos_resultado: source,
        otros_hallazgos_items: structuredOtherLines(source),
      },
    }));
    assert.match(result.displayText, expected, source);
    assert.ok(!result.reviewFlags.some((flag) => flag.type === "unsupported_pattern"), source);
    assert.doesNotMatch(result.displayText, /antibiótico|hematología|tratamiento para|presenta parasitosis/i, source);
  });
});

test("dos hallazgos visuales no se concatenan ni crean una regla conjunta", () => {
  const result = processWorkerClinicalNarrative(baseWorker({
    evaluaciones_cualitativas: {
      otros_hallazgos_resultado: "DESCARTAR ONICOMICOSIS LEUCOPENIA",
      otros_hallazgos_items: structuredOtherLines("DESCARTAR ONICOMICOSIS", "LEUCOPENIA"),
    },
  }));
  assert.doesNotMatch(result.displayText, /onicomicosis leucopenia/i);
  assert.match(result.displayText, /descartar onicomicosis/i);
  assert.match(result.displayText, /leucopenia/i);
});
