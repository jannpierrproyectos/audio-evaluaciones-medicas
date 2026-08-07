import test from "node:test";
import assert from "node:assert/strict";
import { runPaginatedWorkflow } from "../src/paginationWorkflow.js";

function report(id, aptitud = "APTO") {
  return { idcomprobante: String(id), idpaciente: `P${id}`, codigo: `C${id}`, aptitud, url: `https://local.invalid/report?idcomprobante=${id}` };
}

function extraction(atenciones, raw = atenciones.length) {
  return { atenciones, totalFilasDetectadas: raw, encabezadosEncontrados: [] };
}

async function simulate(pages, options = {}) {
  let current = 0;
  const processed = [];
  const classified = [];
  let clicks = 0;
  const result = await runPaginatedWorkflow({
    firstExtraction: pages[0],
    limit: options.limit ?? null,
    perPageLimit: options.perPageLimit ?? null,
    maxPages: options.maxPages ?? null,
    singlePage: options.singlePage ?? false,
    processAttention: async (item, meta) => {
      processed.push({ id: item.idcomprobante, pagina: item.paginaMediWeb, fileOrder: meta.fileOrder });
      return { orden: item.ordenDetectado, estado: "correcto" };
    },
    onPageClassified: async (page) => classified.push(page),
    advance: async () => {
      clicks += 1;
      current += 1;
      return current < pages.length ? { status: "advanced", extraction: pages[current] } : { status: "last_page" };
    },
  });
  return { ...result, processed, classified, clicks };
}

test("recorre 100 + 100 + 47 filas, filtra y conserva orden/numeración global", async () => {
  const statuses = ["APTO", "APTO CON RESTRICCIÓN", "OBSERVADO", "PENDIENTE", "NO APTO"];
  const makePage = (start, count) => extraction(Array.from({ length: count }, (_, index) => report(start + index, statuses[index % statuses.length])));
  const run = await simulate([makePage(1, 100), makePage(101, 100), makePage(201, 47)]);

  assert.equal(run.totals.totalPaginasVisitadas, 3);
  assert.equal(run.totals.totalDetectado, 247);
  assert.equal(run.totals.totalUnico, 247);
  assert.equal(run.totals.totalElegible, 100);
  assert.equal(run.totals.totalExcluido, 147);
  assert.equal(run.processed.length, 100);
  assert.deepEqual(run.processed.map((item) => item.fileOrder), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.deepEqual(run.processed.slice(0, 3).map((item) => item.id), ["1", "2", "6"]);
  assert.equal(run.motivoFinalizacion, "ultima_pagina");
  assert.equal(run.clicks, 3);
});

test("--limit es global y evita visitar la tercera página", async () => {
  const run = await simulate([
    extraction([report("A"), report("B"), report("C")]),
    extraction([report("D"), report("E"), report("F"), report("G")]),
    extraction([report("H"), report("I"), report("J")]),
  ], { limit: 5 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A", "B", "C", "D", "E"]);
  assert.equal(run.totals.totalSeleccionado, 5);
  assert.equal(run.totals.totalPaginasVisitadas, 2);
  assert.equal(run.clicks, 1);
  assert.equal(run.motivoFinalizacion, "limite_alcanzado");
});

test("deduplica identificadores entre páginas", async () => {
  const run = await simulate([
    extraction([report("A"), report("B"), report("C")]),
    extraction([report("C"), report("D"), report("E")]),
  ]);
  assert.deepEqual(run.processed.map((item) => item.id), ["A", "B", "C", "D", "E"]);
  assert.equal(run.totals.totalDetectado, 6);
  assert.equal(run.totals.totalUnico, 5);
  assert.equal(run.totals.totalDuplicado, 1);
});

test("detecta un ciclo A -> B -> A sin reprocesar", async () => {
  const warnings = [];
  const pages = [extraction([report("A")]), extraction([report("B")]), extraction([report("A")])];
  let current = 0;
  const processed = [];
  const run = await runPaginatedWorkflow({
    firstExtraction: pages[0],
    processAttention: async (item) => { processed.push(item.idcomprobante); return { estado: "correcto" }; },
    onWarning: async (warning) => warnings.push(warning),
    advance: async () => ({ status: "advanced", extraction: pages[++current] }),
  });
  assert.deepEqual(processed, ["A", "B"]);
  assert.equal(run.motivoFinalizacion, "pagina_repetida");
  assert.equal(run.totals.totalPaginasVisitadas, 2);
  assert.match(warnings[0], /evitar un bucle/);
});

test("termina normalmente cuando Siguiente no existe o está deshabilitado", async () => {
  const run = await simulate([extraction([report("A")])]);
  assert.equal(run.motivoFinalizacion, "ultima_pagina");
  assert.equal(run.totals.totalPaginasVisitadas, 1);
});

test("--max-pages visita dos páginas y no abre la tercera", async () => {
  const run = await simulate([
    extraction([report("A")]), extraction([report("B")]), extraction([report("C")]),
  ], { maxPages: 2 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A", "B"]);
  assert.equal(run.clicks, 1);
  assert.equal(run.motivoFinalizacion, "max_pages_alcanzado");
});

test("--single-page no intenta pulsar Siguiente", async () => {
  const run = await simulate([extraction([report("A")]), extraction([report("B")])], { singlePage: true });
  assert.deepEqual(run.processed.map((item) => item.id), ["A"]);
  assert.equal(run.clicks, 0);
  assert.equal(run.motivoFinalizacion, "single_page");
});

test("tras recuperar sesión atraviesa páginas conocidas y continúa en la primera nueva", async () => {
  const pages = [
    { status: "advanced", extraction: extraction([report("B")]) },
    { status: "advanced", extraction: extraction([report("A")]), allowVisited: true },
    { status: "advanced", extraction: extraction([report("B")]), allowVisited: true },
    { status: "advanced", extraction: extraction([report("C")]), allowVisited: true },
    { status: "last_page" },
  ];
  let advances = 0;
  const processed = [];
  const run = await runPaginatedWorkflow({
    firstExtraction: extraction([report("A")]),
    processAttention: async (item) => { processed.push(item.idcomprobante); return { estado: "correcto" }; },
    advance: async () => pages[advances++],
  });
  assert.deepEqual(processed, ["A", "B", "C"]);
  assert.equal(run.totals.totalPaginasVisitadas, 3);
  assert.equal(run.totals.totalDuplicado, 0);
  assert.equal(run.motivoFinalizacion, "ultima_pagina");
});

test("un fallo definitivo al avanzar conserva totales y termina como error de paginación", async () => {
  const run = await runPaginatedWorkflow({
    firstExtraction: extraction([report("A")]),
    processAttention: async () => ({ estado: "correcto" }),
    advance: async () => ({ status: "error" }),
  });
  assert.equal(run.totals.totalProcesado, 1);
  assert.equal(run.motivoFinalizacion, "error_paginacion");
});

test("--per-page-limit procesa 3 elegibles en cada una de dos páginas", async () => {
  const page = (prefix) => extraction(Array.from({ length: 10 }, (_, index) => report(`${prefix}${index + 1}`)));
  const run = await simulate([page("A"), page("B"), page("C")], { perPageLimit: 3, maxPages: 2 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A1", "A2", "A3", "B1", "B2", "B3"]);
  assert.deepEqual(run.classified.map((item) => item.selected.length), [3, 3]);
  assert.equal(run.totals.totalElegible, 20);
  assert.equal(run.totals.totalSeleccionado, 6);
  assert.equal(run.totals.totalPaginasVisitadas, 2);
  assert.equal(run.motivoFinalizacion, "max_pages_alcanzado");
});

test("--limit global se combina con --per-page-limit y evita la tercera página", async () => {
  const page = (prefix) => extraction(Array.from({ length: 10 }, (_, index) => report(`${prefix}${index + 1}`)));
  const run = await simulate([page("A"), page("B"), page("C")], {
    limit: 5, perPageLimit: 3, maxPages: 3,
  });
  assert.deepEqual(run.processed.map((item) => item.id), ["A1", "A2", "A3", "B1", "B2"]);
  assert.deepEqual(run.classified.map((item) => item.selected.length), [3, 2]);
  assert.equal(run.totals.totalSeleccionado, 5);
  assert.equal(run.totals.totalPaginasVisitadas, 2);
  assert.equal(run.clicks, 1);
  assert.equal(run.motivoFinalizacion, "limite_alcanzado");
});

test("--per-page-limit no completa artificialmente páginas con menos elegibles", async () => {
  const run = await simulate([
    extraction([report("A1"), report("A2")]),
    extraction([report("B1"), report("B2"), report("B3"), report("B4"), report("B5")]),
  ], { perPageLimit: 3 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A1", "A2", "B1", "B2", "B3"]);
  assert.deepEqual(run.classified.map((item) => item.selected.length), [2, 3]);
});

test("el límite por página no altera exclusiones ni totalElegible", async () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => report(`O${index}`, "OBSERVADO")),
    ...Array.from({ length: 10 }, (_, index) => report(`P${index}`, "PENDIENTE")),
    ...Array.from({ length: 5 }, (_, index) => report(`N${index}`, "NO APTO")),
    ...Array.from({ length: 65 }, (_, index) => report(`A${index + 1}`, "APTO")),
  ];
  const run = await simulate([extraction(rows)], { perPageLimit: 3 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A1", "A2", "A3"]);
  assert.equal(run.totals.totalElegible, 65);
  assert.equal(run.totals.totalSeleccionado, 3);
  assert.equal(run.totals.totalExcluido, 35);
  assert.equal(run.totals.excluidosObservado, 20);
  assert.equal(run.totals.excluidosPendiente, 10);
  assert.equal(run.totals.excluidosNoApto, 5);
  assert.equal(run.totals.totalProcesado, 3);
});

test("numeración y secuencia del consolidado permanecen globales entre páginas", async () => {
  const fullOrder = [];
  const consolidatedOrder = [];
  let current = 0;
  const pages = [
    extraction(Array.from({ length: 5 }, (_, index) => report(`A${index + 1}`))),
    extraction(Array.from({ length: 5 }, (_, index) => report(`B${index + 1}`))),
  ];
  const run = await runPaginatedWorkflow({
    firstExtraction: pages[0],
    perPageLimit: 3,
    maxPages: 2,
    processAttention: async (item, { fileOrder }) => {
      fullOrder.push(`${String(fileOrder).padStart(3, "0")}:${item.idcomprobante}`);
      consolidatedOrder.push(item.idcomprobante);
      return { estado: "correcto" };
    },
    advance: async () => ({ status: "advanced", extraction: pages[++current] }),
  });
  assert.deepEqual(fullOrder, ["001:A1", "002:A2", "003:A3", "004:B1", "005:B2", "006:B3"]);
  assert.deepEqual(consolidatedOrder, ["A1", "A2", "A3", "B1", "B2", "B3"]);
  assert.equal(run.totals.totalSeleccionado, 6);
});

test("--single-page puede combinarse con --per-page-limit", async () => {
  const run = await simulate([
    extraction([report("A1"), report("A2"), report("A3"), report("A4")]),
    extraction([report("B1")]),
  ], { singlePage: true, perPageLimit: 3 });
  assert.deepEqual(run.processed.map((item) => item.id), ["A1", "A2", "A3"]);
  assert.equal(run.clicks, 0);
  assert.equal(run.motivoFinalizacion, "single_page");
});
