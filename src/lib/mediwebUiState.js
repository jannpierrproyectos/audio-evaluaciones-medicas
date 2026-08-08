export const EMPTY_MEDIWEB_ADVANCED_OPTIONS = Object.freeze({
  limit: "",
  maxPages: "",
  perPageLimit: "",
  singlePage: false,
});

export function deriveMediwebPhase({
  connectorStatus,
  browserOpen,
  detectionSummary,
  jobProgress,
  importCompleted = false,
}) {
  if (connectorStatus === "checking") return "checking";
  if (connectorStatus !== "connected") return "connector_unavailable";
  if (importCompleted) return "imported";
  if (jobProgress?.status === "running") return "processing";
  if (jobProgress?.status === "completed") return "completed";
  if (jobProgress?.status === "failed") return "failed";
  if (jobProgress?.status === "cancelled") return "cancelled";
  if (detectionSummary) return "detected";
  return browserOpen ? "mediweb_open" : "ready";
}

export function getMediwebStartLabel(mode) {
  if (mode === "full") return "Generar reportes completos";
  if (mode === "both") return "Preparar y generar reportes";
  return "Preparar evaluaciones";
}

export function getMediwebCompletionSummary(job) {
  const firstPages = Number(job?.firstPagesAdded || 0);
  const fullReports = Number(job?.fullReportsGenerated || 0);
  if (job?.mode === "full") {
    return {
      title: "Reportes completos generados",
      message: `${fullReports} ${fullReports === 1 ? "archivo guardado" : "archivos guardados"} localmente.`,
      canImport: false,
    };
  }
  if (job?.mode === "both") {
    return {
      title: "Proceso completado",
      message: `${firstPages} ${firstPages === 1 ? "evaluación lista" : "evaluaciones listas"} para AudioEvaluaciones. ${fullReports} ${fullReports === 1 ? "reporte completo guardado" : "reportes completos guardados"} localmente.`,
      canImport: true,
    };
  }
  return {
    title: "Evaluaciones listas",
    message: `Se ${firstPages === 1 ? "preparó" : "prepararon"} ${firstPages} ${firstPages === 1 ? "evaluación" : "evaluaciones"} para AudioEvaluaciones.`,
    canImport: true,
  };
}

export function createNewImportSnapshot(browserOpen) {
  return {
    detectionSummary: null,
    jobId: null,
    jobProgress: null,
    mode: "first",
    advancedOptions: { ...EMPTY_MEDIWEB_ADVANCED_OPTIONS },
    importCompleted: false,
    importedWorkerCount: 0,
    feedback: browserOpen
      ? "MediWeb sigue abierto. Realiza o actualiza la búsqueda para comenzar otra importación."
      : "Abre MediWeb para comenzar una nueva importación.",
  };
}

export function createSingleFlight() {
  let active = false;
  return {
    get active() {
      return active;
    },
    async run(operation) {
      if (active) return null;
      active = true;
      try {
        return await operation();
      } finally {
        active = false;
      }
    },
  };
}

export function focusPdfResults({
  documentRef = document,
  schedule = requestAnimationFrame,
} = {}) {
  schedule(() => {
    const results = documentRef.getElementById("pdf-workers-results");
    results?.scrollIntoView({ behavior: "smooth", block: "start" });
    results?.focus({ preventScroll: true });
  });
}
