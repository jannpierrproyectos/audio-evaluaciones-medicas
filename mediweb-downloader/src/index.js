import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { createCli, printAptitudDiagnostic, printAptitudExtractionError, printManualNavigationInstructions, printProcessingSummary } from "./cli.js";
import { createOutputPaths } from "./paths.js";
import { DownloaderRunner, safeErrorMessage } from "./runner.js";
import { isSessionExpired, restoreSession } from "./session.js";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = createCli();
const runner = new DownloaderRunner({ moduleRoot });
let shuttingDown = false;
let requestedExitCode = 0;

async function detectReportsWithRetry() {
  while (!runner.cancelled) {
    if (await isSessionExpired(runner.mainPage)) {
      await restoreSession({ mainPage: runner.mainPage, cli });
    }
    const inspection = await runner.inspectResults();
    if (inspection.ready && inspection.extraction.atenciones.length > 0) return inspection;
    const answer = (await cli.enter("\nNo se encontraron reportes Imp S.F.\n\nComprueba que:\n- hayas iniciado sesión;\n- estés en Atenciones → Ocupacional;\n- hayas seleccionado los filtros;\n- hayas pulsado Buscar;\n- existan atenciones en los resultados.\n\nCuando la tabla esté lista, presiona Enter para volver a intentar.\nEscribe C para cancelar.\n")).trim().toLowerCase();
    if (answer === "c") return null;
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await runner.open();
  printManualNavigationInstructions();
  await cli.enter("");

  const inspection = await detectReportsWithRetry();
  if (!inspection) return;
  const { extraction, selection } = inspection;
  console.log(`\nAtenciones con Imp S.F encontradas en la página actual: ${selection.totalDetectado}`);
  printAptitudDiagnostic(selection);
  if (inspection.aptitudFailure) {
    printAptitudExtractionError(selection.totalDetectado, extraction.encabezadosEncontrados);
    return;
  }

  const mode = options.mode ?? await cli.chooseMode();
  if (!mode) return;
  const paths = await createOutputPaths(moduleRoot, options.output, mode);
  printProcessingSummary({
    selection,
    limit: options.limit,
    perPageLimit: options.perPageLimit,
    mode,
    outputDirectory: paths.root,
    singlePage: options.singlePage,
    maxPages: options.maxPages,
  });
  if (!await cli.confirm("\n¿Iniciar procesamiento?")) return;

  const result = await runner.run({ ...options, mode }, {
    firstExtraction: extraction,
    paths,
    onSessionExpired: async () => restoreSession({ mainPage: runner.mainPage, cli }),
  });
  console.log(`\nProceso ${result.status === "cancelled" ? "cancelado" : "finalizado"}. Resultados conservados en:\n${result.paths.root}`);
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason === "SIGINT" || reason === "SIGTERM") runner.cancel();
  cli.close();
  await runner.close();
  process.exitCode = exitCode;
}

process.once("SIGINT", () => {
  requestedExitCode = 130;
  runner.cancel();
  cli.close();
});
process.once("SIGTERM", () => {
  requestedExitCode = 143;
  runner.cancel();
  cli.close();
});

try {
  await main();
  await shutdown("complete", requestedExitCode);
} catch (error) {
  if (!requestedExitCode) console.error(`\nError: ${safeErrorMessage(error)}`);
  await shutdown("error", requestedExitCode || 1);
}
