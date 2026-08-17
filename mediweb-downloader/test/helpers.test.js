import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { parseArgs } from "../src/args.js";
import { createCsv } from "../src/csv.js";
import { sanitizeFilePart } from "../src/fileNames.js";
import { normalizeText } from "../src/mediwebTable.js";
import {
  createManifest,
  isAptitudExtractionFailure,
  saveControl,
  selectAttentions,
  summarizeManifest,
} from "../src/manifest.js";

test("parsea los argumentos del MVP", () => {
  assert.deepEqual(parseArgs(["--mode", "both", "--limit", "1", "--delay", "500"]), {
    mode: "both", limit: 1, perPageLimit: null, output: null, delay: 500, maxPages: null, singlePage: false,
  });
  assert.throws(() => parseArgs(["--mode", "invalid"]));
  assert.throws(() => parseArgs(["--limit", "0"]));
  assert.equal(parseArgs(["--max-pages", "2"]).maxPages, 2);
  assert.equal(parseArgs(["--single-page"]).singlePage, true);
  assert.throws(() => parseArgs(["--max-pages", "0"]));
  assert.throws(() => parseArgs(["--max-pages", "2.5"]));
  assert.throws(() => parseArgs(["--single-page", "--max-pages", "2"]));
  assert.equal(parseArgs(["--per-page-limit", "3"]).perPageLimit, 3);
  assert.throws(() => parseArgs(["--per-page-limit", "0"]), /entero mayor que cero/);
  assert.throws(() => parseArgs(["--per-page-limit", "2.5"]), /entero mayor que cero/);
});

test("normaliza encabezados con tildes, puntos y espacios", () => {
  assert.equal(normalizeText("  CÓDIGO.\nAtención  "), "codigo atencion");
});

test("sanitiza nombres incompatibles con Windows", () => {
  assert.equal(sanitizeFilePart('CON'), "_CON");
  assert.equal(sanitizeFilePart('Paciente: Uno?.  '), "Paciente Uno");
  assert.equal(sanitizeFilePart("", "ATENCION"), "ATENCION");
});

test("CSV escapa comillas, comas y saltos de linea", () => {
  const csv = createCsv([{ orden: 1, empresa: 'Empresa, "Uno"\nLima' }]);
  assert.ok(csv.startsWith("\uFEFForden,"));
  assert.ok(csv.includes("orden,paginaMediWeb,codigo"));
  assert.ok(csv.includes("aptitud,categoriaAptitud"));
  assert.ok(csv.includes("estado,telefono,numeroDocumento,archivoCompleto,archivoPdfCompleto"));
  assert.ok(csv.includes('"Empresa, ""Uno""\nLima"'));
});

test("control reemplaza manifest y CSV de forma segura", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mediweb-downloader-test-"));
  const control = path.join(root, "control");
  const paths = { manifest: path.join(control, "manifest.json"), csv: path.join(control, "resultados.csv") };
  try {
    await mkdir(control);
    const manifest = { estadoEjecucion: "en_progreso", atenciones: [] };
    await saveControl(manifest, paths);
    manifest.estadoEjecucion = "completado";
    await saveControl(manifest, paths);
    assert.equal(JSON.parse(await readFile(paths.manifest, "utf8")).estadoEjecucion, "completado");
    assert.match(await readFile(paths.csv, "utf8"), /^\uFEFForden,/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("flujo posterior a confirmar conserva los totales al aplicar limit", () => {
  const atencionesDetectadas = [
    { codigo: "PQ1", aptitud: "APTO" },
    { codigo: "PQ2", aptitud: "APTO CON RESTRICCIÓN" },
    { codigo: "PQ3", aptitud: "APTO" },
  ];
  const seleccion = selectAttentions(atencionesDetectadas, 1);

  assert.equal(seleccion.totalDetectado, 3);
  assert.equal(seleccion.totalElegible, 3);
  assert.equal(seleccion.totalExcluido, 0);
  assert.equal(seleccion.totalSeleccionado, 1);
  assert.deepEqual(seleccion.atencionesSeleccionadas.map((item) => item.codigo), ["PQ1"]);

  const manifest = createManifest({
    mode: "both",
    limit: 1,
    selection: seleccion,
    outputDirectory: "C:\\salida-ficticia",
  });
  assert.equal(manifest.totalDetectado, 3);
  assert.equal(manifest.totalElegible, 3);
  assert.equal(manifest.totalExcluido, 0);
  assert.equal(manifest.totalSeleccionado, 1);
  assert.equal(manifest.totalProcesado, 0);
  assert.equal(manifest.totalPaginasVisitadas, 1);
  assert.equal(manifest.totalUnico, 3);
  assert.equal(manifest.perPageLimit, null);
  assert.deepEqual(manifest.pages, []);
  assert.deepEqual(manifest.pagination, {
    enabled: true, singlePage: false, maxPages: null, paginasVisitadas: 1, ultimaPaginaCompletada: 1,
    motivoFinalizacion: null,
  });
  assert.deepEqual(manifest.atenciones, []);
});

test("exclusiones no incrementan procesados ni errores", () => {
  const selection = selectAttentions([
    { codigo: "OBS", aptitud: "OBSERVADO" },
    { codigo: "OK", aptitud: "APTO" },
  ], null);
  const manifest = createManifest({ mode: "both", limit: null, selection, outputDirectory: "C:\\salida-ficticia" });
  summarizeManifest(manifest);
  assert.equal(manifest.totalProcesado, 0);
  assert.equal(manifest.errores, 0);

  manifest.atenciones.push({ orden: 2, estado: "correcto" });
  summarizeManifest(manifest);
  assert.equal(manifest.totalProcesado, 1);
  assert.equal(manifest.correctos, 1);
  assert.equal(manifest.errores, 0);
});

test("detecta fallo silencioso cuando todas las aptitudes son desconocidas", () => {
  const selection = selectAttentions([
    { codigo: "PQ1", aptitud: "CRITERIO MEDICO UNO" },
    { codigo: "PQ2", aptitud: "" },
  ], null);
  assert.equal(selection.totalDetectado, 2);
  assert.equal(selection.totalElegible, 0);
  assert.equal(selection.excluidosOtros, 2);
  assert.equal(isAptitudExtractionFailure(selection), true);
});
