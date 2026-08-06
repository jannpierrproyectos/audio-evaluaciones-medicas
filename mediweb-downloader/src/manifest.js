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

export function createManifest({ mode, limit, selection, outputDirectory }) {
  return {
    fechaInicio: new Date().toISOString(),
    fechaFin: null,
    modo: mode,
    limite: limit,
    totalDetectado: selection.totalDetectado,
    totalElegible: selection.totalElegible,
    totalExcluido: selection.totalExcluido,
    totalSeleccionado: selection.totalSeleccionado,
    totalProcesado: 0,
    excluidosObservado: selection.excluidosObservado,
    excluidosPendiente: selection.excluidosPendiente,
    excluidosNoApto: selection.excluidosNoApto,
    excluidosOtros: selection.excluidosOtros,
    correctos: 0,
    errores: 0,
    reportesCompletosGenerados: 0,
    primerasHojasAgregadas: 0,
    carpetaSalida: outputDirectory,
    estadoEjecucion: "en_progreso",
    atenciones: selection.atencionesExcluidas.map(createExcludedEntry),
  };
}

function createExcludedEntry(atencion) {
  const category = atencion.aptitudClassification.category;
  return {
    orden: atencion.ordenDetectado,
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
    archivoCompleto: "",
    paginaConsolidado: "",
    intentos: 0,
    mensajeError: "",
  };
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
