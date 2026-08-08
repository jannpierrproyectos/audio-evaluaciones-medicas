import path from "node:path";
import { access } from "node:fs/promises";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeFilePart(value, fallback = "") {
  let result = String(value ?? "").replace(/[<>:"/\\|?*]/g, " ").replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (RESERVED.test(result)) result = `_${result}`;
  if (!result) result = fallback;
  return result.slice(0, 90).trim().replace(/[. ]+$/g, "");
}

export async function uniqueReportPath(directory, report, order) {
  const prefix = String(order).padStart(3, "0");
  const identifier = sanitizeFilePart(report.codigo || report.idcomprobante, "ATENCION").replace(/\s/g, "_");
  const patient = sanitizeFilePart(report.paciente).replace(/\s/g, "_");
  const base = [prefix, identifier, patient].filter(Boolean).join("_").slice(0, 180).replace(/[. ]+$/g, "");
  let suffix = 1;
  while (true) {
    const filename = `${base}${suffix === 1 ? "" : `_${suffix}`}.pdf`;
    const candidate = path.join(directory, filename);
    try {
      await access(candidate);
      suffix += 1;
    } catch {
      return { absolute: candidate, relative: filename };
    }
  }
}
