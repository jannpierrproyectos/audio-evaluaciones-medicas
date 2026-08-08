import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const MODE_LABELS = {
  first: "Solo primeras hojas para AudioEvaluaciones",
  full: "Solo reportes completos individuales",
  both: "Ambos",
};

export function createCli() {
  const readline = createInterface({ input, output });
  return {
    async enter(message = "") {
      return readline.question(message);
    },
    async chooseMode() {
      while (true) {
        const answer = (await readline.question(
          "\nModo de procesamiento:\n\n[1] Solo primeras hojas para AudioEvaluaciones\n[2] Solo reportes completos individuales\n[3] Ambos\n[C] Cancelar\n\nSelecciona una opción: ",
        )).trim().toLowerCase();
        if ({ 1: true, 2: true, 3: true }[answer]) return ({ 1: "first", 2: "full", 3: "both" })[answer];
        if (answer === "c") return null;
        console.log("Opción no válida.");
      }
    },
    async confirm(message) {
      while (true) {
        const answer = (await readline.question(`${message} [S/N] `)).trim().toLowerCase();
        if (answer === "s" || answer === "si" || answer === "sí") return true;
        if (answer === "n" || answer === "no") return false;
        console.log("Responde S o N.");
      }
    },
    close() {
      readline.close();
    },
  };
}

export function modeLabel(mode) {
  return MODE_LABELS[mode] ?? mode;
}

export function printProcessingSummary({ selection, limit, perPageLimit, mode, outputDirectory, singlePage, maxPages }) {
  console.log(`\nResumen inicial:\n- Página actual: 1\n- Atenciones detectadas en esta página: ${selection.totalDetectado}\n- Elegibles en esta página: ${selection.totalElegible}\n- Excluidas en esta página: ${selection.totalExcluido}\n  - Observado: ${selection.excluidosObservado}\n  - Pendiente: ${selection.excluidosPendiente}\n  - No apto: ${selection.excluidosNoApto}\n  - Otros estados: ${selection.excluidosOtros}\n- Modo: ${modeLabel(mode)}\n- Paginación automática: ${singlePage ? "No (--single-page)" : "Sí"}\n- Máximo de páginas: ${maxPages ?? "sin límite"}\n- Límite global: ${limit ?? "sin límite"}\n- Límite de elegibles por página: ${perPageLimit ?? "sin límite"}\n- Carpeta de salida: ${outputDirectory}`);
}

export function printAptitudDiagnostic(selection) {
  console.log(`\nDiagnóstico de aptitud:\n- Filas con aptitud extraída: ${selection.filasConAptitud}\n- Filas con aptitud vacía: ${selection.filasConAptitudVacia}\n- Categorías encontradas:\n  APTO: ${selection.totalElegible}\n  OBSERVADO: ${selection.excluidosObservado}\n  PENDIENTE: ${selection.excluidosPendiente}\n  NO APTO: ${selection.excluidosNoApto}\n  OTROS: ${selection.excluidosOtros}`);
}

export function printAptitudExtractionError(totalDetectado, encabezadosEncontrados) {
  const headers = encabezadosEncontrados.length > 0
    ? encabezadosEncontrados.map((header) => `- ${header}`).join("\n")
    : "- No se identificaron filas de encabezado";
  console.error(`\nNo fue posible identificar correctamente los valores de la columna Aptitud.\n\nSe detectaron ${totalDetectado} atenciones, pero todas quedaron como estado desconocido.\n\nEncabezados encontrados:\n${headers}\n\nNo se abrirá ni descargará ningún reporte.\nRevise la extracción de la tabla.`);
}

export function printManualNavigationInstructions() {
  console.log("\nMediWeb está abierto.\n\n1. Inicia sesión manualmente.\n2. Ingresa a Atenciones → Ocupacional.\n3. Selecciona los filtros.\n4. Pulsa Buscar.\n5. Comprueba que se muestre la tabla con la columna Imp S.F.\n6. Regresa a esta terminal y presiona Enter.\n\nLa paginación automática comienza después de confirmar el resumen inicial. No automatiza credenciales ni la búsqueda.");
}
