import test from "node:test";
import assert from "node:assert/strict";
import { JobManager } from "../src/http/jobManager.js";

const OPTIONS = {
  mode: "first",
  limit: 1,
  maxPages: null,
  perPageLimit: null,
  singlePage: false,
  delay: 0,
};

function manifestFromTotals(totals) {
  return {
    ...totals,
    reportesCompletosGenerados: 0,
    primerasHojasAgregadas: totals.totalProcesado,
    errores: 0,
    pagination: { motivoFinalizacion: "limite_alcanzado" },
  };
}

test("el preview de 100 no se suma al job de 100 con limit 1", async () => {
  const firstPageTotals = {
    totalPaginasVisitadas: 1,
    totalDetectado: 100,
    totalUnico: 100,
    totalElegible: 63,
    totalExcluido: 37,
    totalSeleccionado: 1,
    totalProcesado: 1,
  };
  const engine = {
    browserOpen: true,
    async detectSummary() {
      return { detected: 100, eligible: 63, excluded: { observado: 23, pendiente: 7, noApto: 1, otros: 6 } };
    },
    async run(_options, { onProgress }) {
      const manifest = manifestFromTotals(firstPageTotals);
      onProgress({ type: "page_completed", currentPage: 1, totals: firstPageTotals, manifest });
      return { status: "completed", manifest, paths: {} };
    },
  };
  const preview = await engine.detectSummary();
  assert.equal(preview.detected, 100);

  const manager = new JobManager({ engine });
  const created = manager.create(OPTIONS);
  await manager.waitForIdle();
  const job = manager.publicJob(manager.get(created.id));
  assert.equal(job.detected, 100);
  assert.notEqual(job.detected, 200);
  assert.equal(job.unique, 100);
  assert.equal(job.eligible, 63);
  assert.equal(job.excluded, 37);
  assert.equal(job.selected, 1);
  assert.equal(job.processed, 1);
});

test("dos paginas de 100 y 80 producen totalDetectado 180", async () => {
  const pageOne = {
    totalPaginasVisitadas: 1, totalDetectado: 100, totalUnico: 100,
    totalElegible: 63, totalExcluido: 37, totalSeleccionado: 63, totalProcesado: 63,
  };
  const pageTwo = {
    totalPaginasVisitadas: 2, totalDetectado: 180, totalUnico: 180,
    totalElegible: 113, totalExcluido: 67, totalSeleccionado: 113, totalProcesado: 113,
  };
  const engine = {
    browserOpen: true,
    async run(_options, { onProgress }) {
      onProgress({ type: "page_completed", currentPage: 1, totals: pageOne, manifest: manifestFromTotals(pageOne) });
      const manifest = manifestFromTotals(pageTwo);
      onProgress({ type: "page_completed", currentPage: 2, totals: pageTwo, manifest });
      return { status: "completed", manifest, paths: {} };
    },
  };
  const manager = new JobManager({ engine });
  const created = manager.create({ ...OPTIONS, limit: null });
  await manager.waitForIdle();
  const job = manager.publicJob(manager.get(created.id));
  assert.equal(job.detected, 180);
  assert.equal(job.currentPage, 2);
});
