import {
  normalizeRecommendationsForArea,
  normalizeRestrictionItems,
} from "./clinicalRecommendationNormalizer.js";

function group(recomendaciones = [], hallazgos = []) {
  return {
    narrar: true,
    recomendaciones: recomendaciones.map((texto) => ({
      texto_original: texto,
      texto_normalizado: texto,
    })),
    hallazgos: hallazgos.map((resultado) => ({
      resultado,
      narrar: true,
    })),
  };
}

function expectIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label}: falta "${expected}". Recibido: ${JSON.stringify(values)}`);
  }
}

function expectCount(values, term, count, label) {
  const found = values.filter((value) => value.includes(term)).length;
  if (found !== count) {
    throw new Error(`${label}: se esperaban ${count} apariciones de "${term}", pero hubo ${found}.`);
  }
}

const metabolic = normalizeRecommendationsForArea(
  "metabolico",
  group(
    [
      "AUMENTAR LA ACTIVIDAD FISICA, DIETA BAJA EN GRASAS Y CALORIAS. CONTROL MENSUAL DE PESO Y CONTROL POR ENDOCRINOLOGÍA Y NUTRICIÓN.",
      "EVALUACIÓN POR ENDOCRINOLOGIA.",
    ],
    ["OBESIDAD TIPO I", "HIPERGLICEMIA"],
  ),
);
expectIncludes(metabolic, "acudir a control por endocrinología y nutrición", "Caso 1");
expectCount(metabolic, "endocrinología", 1, "Caso 1");

const ophthalmology = normalizeRecommendationsForArea(
  "oftalmologia",
  group([
    "USO DE CORRECTORES OCULARES, RENOVACIÓN Y CONTROL POR OFTALMOLOGÍA.",
    "USO DE HIDRATANTES OCULARES Y CONTROL POR OFTALMOLOGÍA.",
  ]),
);
expectIncludes(ophthalmology, "usar correctores oculares", "Caso 2");
expectIncludes(ophthalmology, "renovar la medida si corresponde", "Caso 2");
expectIncludes(ophthalmology, "usar hidratantes oculares si fueron indicados", "Caso 2");
expectCount(ophthalmology, "oftalmología", 1, "Caso 2");

const audiometry = normalizeRecommendationsForArea(
  "audiometria",
  group(["USO DE PROTECTORES AUDITIVOS EN ZONA DE RUIDO."]),
);
const noiseRestriction = normalizeRecommendationsForArea(
  "ocupacional",
  group(["NO REALIZAR ACTIVIDADES EXPUESTO A RUIDO POR ENCIMA DE LOS LÍMITES MÁXIMOS PERMITIDOS SIN EL USO DE PROTECCIÓN AUDITIVA."]),
);
expectIncludes(audiometry, "uso de protectores auditivos en zonas de ruido", "Caso 3");
expectIncludes(noiseRestriction, "no debe exponerse a ruido por encima de los límites máximos permitidos sin protección auditiva", "Caso 3");

const dermatology = normalizeRecommendationsForArea(
  "dermatologia",
  group(["SE RECOMIENDA EVALUACION POR DERMATOLOGÍA."], ["DESCARTAR ONICOMICOSIS PEDIA BILATERAL."]),
);
expectIncludes(dermatology, "evaluación por dermatología", "Caso 4");

const pneumology = normalizeRecommendationsForArea(
  "neumologia",
  group(["CONTROL POR NEUMOLOGIA."], ["Evaluación espirométrica: RESTRICCION LEVE."]),
);
expectIncludes(pneumology, "mantener control por neumología", "Caso 5");

const heightRestriction = normalizeRestrictionItems("NO DEBE TRABAJAR EN ALTURA MAYOR A 1.80 METROS.");
expectIncludes(heightRestriction, "No debe trabajar en altura mayor a un metro ochenta", "Caso 6");

console.log("clinicalRecommendationNormalizer examples OK");
