import path from "node:path";
import { writeFile, rename } from "node:fs/promises";
import { createCsv } from "./csv.js";
import { APTITUD_CATEGORIES, classifyAptitud } from "./aptitud.js";

const EXCLUDED_STATES = Object.freeze({
  [APTITUD_CATEGORIES.OBSERVADO]: "excluido_observado",
  [APTITUD_CATEGORIES.PENDIENTE]: "excluido_pendiente",
  [APTITUD_CATEGORIES.NO_APTO]: "excluido_no_apto",
  [APTITUD_CATEGORIES.NO_ELEGIBLE]: "excluido_aptitud_no_elegible",
});

export function selectAttentions(atencionesDetectadas, limit) {
  const atencionesClasificadas = atencionesDetectadas.map((atencion, index) => ({
    ...atencion,
    ordenDetectado: index + 1,
    aptitudClassification: classifyAptitud(atencion.aptitud),
  }));
  const totalDetectado = atencionesClasificadas.length;
  const atencionesElegibles = atencionesClasificadas.filter((atencion) => atencion.aptitudClassification.eligible);
  const atencionesExcluidas = atencionesClasificadas.filter((atencion) => !atencion.aptitudClassification.eligible);
  const atencionesSeleccionadas = limit
    ? atencionesElegibles.slice(0, limit)
    : atencionesElegibles;
  const totalElegible = atencionesElegibles.length;
  const totalExcluido = atencionesExcluidas.length;
  const totalSeleccionado = atencionesSeleccionadas.length;
  const filasConAptitud = atencionesClasificadas.filter((atencion) => atencion.aptitudClassification.normalized).length;
  const filasConAptitudVacia = totalDetectado - filasConAptitud;
  const excludedCount = (category) => atencionesExcluidas
    .filter((atencion) => atencion.aptitudClassification.category === category).length;

  return {
    atencionesDetectadas: atencionesClasificadas,
    atencionesElegibles,
    atencionesExcluidas,
    atencionesSeleccionadas,
    totalDetectado,
    totalElegible,
    totalExcluido,
    totalSeleccionado,
    filasConAptitud,
    filasConAptitudVacia,
    excluidosObservado: excludedCount(APTITUD_CATEGORIES.OBSERVADO),
    excluidosPendiente: excludedCount(APTITUD_CATEGORIES.PENDIENTE),
    excluidosNoApto: excludedCount(APTITUD_CATEGORIES.NO_APTO),
    excluidosOtros: excludedCount(APTITUD_CATEGORIES.NO_ELEGIBLE),
  };
}

export function isAptitudExtractionFailure(selection) {
  return selection.totalDetectado > 0
    && selection.totalElegible === 0
    && selection.excluidosOtros === selection.totalDetectado;
}

export function createManifest({
  mode, limit, perPageLimit = null, selection = null, outputDirectory, singlePage = false, maxPages = null,
}) {
  const initial = selection ?? {
    totalDetectado: 0, totalElegible: 0, totalExcluido: 0, totalSeleccionado: 0,
    excluidosObservado: 0, excluidosPendiente: 0, excluidosNoApto: 0, excluidosOtros: 0,
    atencionesExcluidas: [],
  };
  return {
    fechaInicio: new Date().toISOString(),
    fechaFin: null,
    modo: mode,
    limite: limit,
    perPageLimit,
    totalPaginasVisitadas: selection ? 1 : 0,
    totalDetectado: initial.totalDetectado,
    totalUnico: initial.totalDetectado,
    totalElegible: initial.totalElegible,
    totalExcluido: initial.totalExcluido,
    totalSeleccionado: initial.totalSeleccionado,
    totalProcesado: 0,
    totalDuplicado: 0,
    excluidosObservado: initial.excluidosObservado,
    excluidosPendiente: initial.excluidosPendiente,
    excluidosNoApto: initial.excluidosNoApto,
    excluidosOtros: initial.excluidosOtros,
    correctos: 0,
    errores: 0,
    reportesCompletosGenerados: 0,
    primerasHojasAgregadas: 0,
    carpetaSalida: outputDirectory,
    estadoEjecucion: "en_progreso",
    pagination: {
      enabled: !singlePage,
      singlePage,
      maxPages,
      paginasVisitadas: selection ? 1 : 0,
      ultimaPaginaCompletada: selection ? 1 : 0,
      motivoFinalizacion: null,
    },
    warnings: [],
    pages: [],
    atenciones: initial.atencionesExcluidas.map(createExcludedEntry),
  };
}

export function createExcludedEntry(atencion) {
  const category = atencion.aptitudClassification.category;
  return {
    orden: atencion.ordenDetectado,
    paginaMediWeb: atencion.paginaMediWeb ?? 1,
    codigo: atencion.codigo,
    fecha: atencion.fecha,
    empresa: atencion.empresa,
    subcontrata: atencion.subcontrata,
    paciente: atencion.paciente,
    tipoExamen: atencion.tipoExamen,
    tipoDocumento: atencion.tipoDocumento,
    aptitud: atencion.aptitud,
    categoriaAptitud: category,
    idcomprobante: atencion.idcomprobante,
    idpaciente: atencion.idpaciente,
    estado: EXCLUDED_STATES[category],
    telefono: "",
    numeroDocumento: "",
    archivoCompleto: "",
    archivoPdfCompleto: "",
    paginaConsolidado: "",
    intentos: 0,
    mensajeError: "",
  };
}

export function applyPaginationTotals(manifest, totals) {
  Object.assign(manifest, totals);
  manifest.pagination.paginasVisitadas = totals.totalPaginasVisitadas;
}

export async function saveControl(manifest, paths) {
  const manifestTemporary = `${paths.manifest}.tmp`;
  const csvTemporary = `${paths.csv}.tmp`;
  await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(manifestTemporary, paths.manifest);
  await writeFile(csvTemporary, createCsv(manifest.atenciones), "utf8");
  await rename(csvTemporary, paths.csv);
}

export function summarizeManifest(manifest) {
  manifest.atenciones.sort((left, right) => left.orden - right.orden);
  const processed = manifest.atenciones.filter((item) => !item.estado.startsWith("excluido_"));
  manifest.totalProcesado = processed.length;
  manifest.correctos = manifest.atenciones.filter((item) => item.estado === "correcto").length;
  manifest.errores = processed.filter((item) => !["correcto", "cancelado"].includes(item.estado)).length;
}

export function relativeOutputPath(root, absolute) {
  return absolute ? path.relative(root, absolute) : "";
}
