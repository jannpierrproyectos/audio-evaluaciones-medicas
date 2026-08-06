import test from "node:test";
import assert from "node:assert/strict";
import { classifyAptitud } from "../src/aptitud.js";
import { extractRowData, resolveColumnIndexes } from "../src/mediwebTable.js";

const HEADERS = [
  "Código",
  "Fecha",
  "Criterios de aptitud",
  "Empresa",
  "Paciente",
  "T. Doc",
  "Aptitud",
  "Imp S.F",
];

test("resuelve APTITUD exacto y rechaza CRITERIOS DE APTITUD", () => {
  const indexes = resolveColumnIndexes(HEADERS);
  assert.equal(indexes.aptitud, 6);
  assert.notEqual(indexes.aptitud, 2);

  const row = [
    "PQ001",
    "06-08-2026",
    "INNOMEDIC INTERNACIONAL...",
    "EMPRESA A",
    "PACIENTE PRUEBA",
    "DNI",
    "APTO CON RESTRICCIÓN",
    "enlace",
  ];
  const extracted = extractRowData(HEADERS, row);
  assert.equal(extracted.aptitud, "APTO CON RESTRICCIÓN");
  assert.equal(classifyAptitud(extracted.aptitud).eligible, true);
});

test("extrae y clasifica estados desde la columna APTITUD exacta", () => {
  const cases = [
    ["OBSERVADO: INTERCONSULTA POR ENDOCRINOLOGÍA", "observado"],
    ["PENDIENTE: EVALUACIÓN DE ESPIROMETRÍA", "pendiente"],
    ["NO APTO", "no_apto"],
    ["APTO", "apto"],
  ];

  for (const [aptitud, category] of cases) {
    const row = ["PQ", "06-08-2026", "CRITERIO QUE NO ES ESTADO", "EMPRESA", "PACIENTE", "DNI", aptitud, "enlace"];
    const extracted = extractRowData(HEADERS, row);
    assert.equal(extracted.aptitud, aptitud);
    assert.equal(classifyAptitud(extracted.aptitud).category, category);
  }
});
