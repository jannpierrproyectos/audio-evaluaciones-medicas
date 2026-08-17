import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPdfFieldVisualLines,
  getPdfLineYTolerance,
  groupPdfTextItemsByVisualLine,
} from "../src/lib/data/pdf/pdfTextGeometry.js";

function item(text, x, y, width = 30, height = 7.5, sourceIndex = 0) {
  return { text, x, y, width, height, page: 1, sourceIndex };
}

test("geometría PDF: tres Y distintas en una columna producen tres líneas", () => {
  const lines = groupPdfTextItemsByVisualLine([
    item("HALLAZGO C", 147, 303, 60, 7.5, 2),
    item("HALLAZGO A", 147, 319, 60, 7.5, 0),
    item("HALLAZGO B", 147, 311, 60, 7.5, 1),
  ]);
  assert.deepEqual(lines.map((line) => line.text), ["HALLAZGO A", "HALLAZGO B", "HALLAZGO C"]);
});

test("geometría PDF: fragmentos cercanos forman una sola línea", () => {
  const lines = groupPdfTextItemsByVisualLine([
    item("HALLAZGO", 147, 319, 40, 7.5, 0),
    item("DERECHO", 191, 319, 32, 7.5, 1),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "HALLAZGO DERECHO");
});

test("geometría PDF: dos columnas no se mezclan", () => {
  const lines = groupPdfTextItemsByVisualLine([
    item("COLUMNA A", 45, 319, 45, 7.5, 0),
    item("COLUMNA B", 300, 319, 45, 7.5, 1),
  ]);
  assert.deepEqual(lines.map((line) => line.text), ["COLUMNA A", "COLUMNA B"]);
});

test("geometría PDF: pequeñas diferencias Y se agrupan con tolerancia derivada", () => {
  const items = [
    item("MISMA", 147, 319, 30, 7.5, 0),
    item("LÍNEA", 181, 318.1, 28, 7.5, 1),
  ];
  assert.equal(getPdfLineYTolerance(items), 2.625);
  assert.equal(groupPdfTextItemsByVisualLine(items).length, 1);
});

test("geometría PDF: líneas separadas por 7.2 puntos no se concatenan", () => {
  const lines = groupPdfTextItemsByVisualLine([
    item("PRIMERA", 147, 319, 35, 7.5, 0),
    item("SEGUNDA", 147, 311.8, 35, 7.5, 1),
  ]);
  assert.deepEqual(lines.map((line) => line.text), ["PRIMERA", "SEGUNDA"]);
});

test("extrae Otros después de su ancla y conserva orden y trazabilidad", () => {
  const items = [
    item("Otros:", 45, 700, 25, 7.5, 0),
    item("OPCIÓN DE EXAMEN", 147, 700, 80, 7.5, 1),
    item("Ficha Odontograma: -", 45, 330, 90, 7.5, 2),
    item("Otros:", 45, 318, 25, 7.5, 3),
    item("LEUCOPENIA", 147, 310, 50, 7.5, 5),
    item("DESCARTAR ONICOMICOSIS", 147, 318, 100, 7.5, 4),
    item("RESTRICCIONES", 45, 300, 60, 7.5, 6),
  ];
  const lines = extractPdfFieldVisualLines([{ page: 1, items }], {
    anchorLabels: ["Ficha Odontograma"],
    startLabels: ["Otros"],
    endLabels: ["RESTRICCIONES"],
    field: "evaluaciones_cualitativas.otros_hallazgos_resultado",
  });
  assert.deepEqual(lines.map((line) => line.text), ["DESCARTAR ONICOMICOSIS", "LEUCOPENIA"]);
  assert.equal(lines[0].page, 1);
  assert.equal(lines[0].sourceIndex, 4);
  assert.equal(lines[0].field, "evaluaciones_cualitativas.otros_hallazgos_resultado");
  assert.equal(lines[0].textItems.length, 1);
});
