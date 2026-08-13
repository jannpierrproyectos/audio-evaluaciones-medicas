import path from "node:path";
import { resolveAuditFiles, runClinicalAudit } from "./lib/clinical-audit-core.js";

async function main() {
  const resolution = await resolveAuditFiles(process.argv.slice(2));
  if (resolution.mode === "latest") {
    process.stdout.write(`Usando últimas primeras hojas:\n${resolution.files[0]}\n\n`);
  } else if (resolution.mode === "all") {
    process.stdout.write(`Archivos de auditoría seleccionados: ${resolution.files.length}\n${resolution.files.join("\n")}\n\n`);
  }

  const { analyzePdfBatch } = await import("../src/lib/data/pdf/analyzePdfBatch.js");
  const result = await runClinicalAudit({
    filePaths: resolution.files,
    analyzePdf: analyzePdfBatch,
    sanitized: resolution.sanitized,
  });
  const summary = result.summary;
  const identityProblems = Object.entries(summary.identity).filter(([key]) => key !== "ok").reduce((sum, [, count]) => sum + count, 0);
  const clinicalProblems = Object.values(summary.clinical).reduce((sum, count) => sum + count, 0);
  process.stdout.write([
    "Auditoría clínica completada.",
    "",
    `Archivos procesados: ${summary.filesProcessed}`,
    `Páginas: ${summary.totals.pages}`,
    `Trabajadores extraídos: ${summary.totals.workersExtracted}`,
    `Fallos de parser: ${summary.totals.parserFailures}`,
    `Sin observaciones: ${summary.totals.workersWithoutFlags}`,
    `Revisión recomendada: ${summary.totals.workersWithReviewFlags}`,
    "",
    `Problemas de identidad: ${identityProblems}`,
    `Problemas clínicos: ${clinicalProblems}`,
    "",
    `Reporte: ${path.resolve(result.paths.privateReportPath)}`,
    "",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
