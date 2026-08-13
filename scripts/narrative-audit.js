import path from "node:path";
import { runNarrativeAudit } from "./lib/narrative-audit-core.js";

const args = process.argv.slice(2);
const suffixIndex = args.indexOf("--suffix");
const suffix = suffixIndex >= 0 ? args[suffixIndex + 1] || "" : "";
const outputDir = path.resolve("clinical-audit");
const casesPath = path.join(outputDir, "audit-cases.json");
const { result, summaryPath, reportPath } = await runNarrativeAudit({ casesPath, outputDir, suffix });

process.stdout.write([
  "Auditoría narrativa completada.",
  `Trabajadores: ${result.workersReviewed}`,
  `ERROR: ${result.statusCounts.ERROR}`,
  `REVIEW: ${result.statusCounts.REVIEW}`,
  `INFORMATIONAL: ${result.statusCounts.INFORMATIONAL}`,
  `OK: ${result.statusCounts.OK}`,
  `Resumen: ${summaryPath}`,
  `Reporte: ${reportPath}`,
  "",
].join("\n"));
