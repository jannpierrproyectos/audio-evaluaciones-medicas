import test from "node:test";
import assert from "node:assert/strict";
import { classifyAptitud } from "../src/aptitud.js";

const CASES = [
  ["APTO", true, "apto"],
  ["APTO CON RESTRICCIÓN", true, "apto"],
  ["APTO CON RESTRICCIONES USO DE PROTECTORES AUDITIVOS", true, "apto"],
  ["apto con restriccion", true, "apto"],
  ["NO APTO", false, "no_apto"],
  ["NO APTO TEMPORAL", false, "no_apto"],
  ["OBSERVADO : INTERCONSULTA POR ENDOCRINOLOGIA", false, "observado"],
  ["OBSERVADO: REEVALUACION", false, "observado"],
  ["PENDIENTE : EVALUACION DE ESPIROMETRIA", false, "pendiente"],
  ["PENDIENTE", false, "pendiente"],
  ["", false, "aptitud_no_elegible"],
  ["ESTADO DESCONOCIDO", false, "aptitud_no_elegible"],
];

for (const [value, eligible, category] of CASES) {
  test(`clasifica aptitud: ${value || "texto vacío"}`, () => {
    const classification = classifyAptitud(value);
    assert.equal(classification.eligible, eligible);
    assert.equal(classification.category, category);
  });
}

test("evalúa NO APTO antes que APTO y normaliza puntuación", () => {
  assert.deepEqual(classifyAptitud("  NO.  APTO:\nTEMPORAL  "), {
    eligible: false,
    category: "no_apto",
    normalized: "NO APTO TEMPORAL",
  });
});
