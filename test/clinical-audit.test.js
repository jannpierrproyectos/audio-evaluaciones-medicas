import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditIdentity,
  parseAuditArguments,
  resolveAuditFiles,
  runClinicalAudit,
} from "../scripts/lib/clinical-audit-core.js";
import { normalizeWorkerClinicalData } from "../src/clinical/index.js";

function syntheticWorker({
  name = "JUAN CARLOS QUISPE MAMANI",
  names = "JUAN CARLOS",
  surnames = "QUISPE MAMANI",
  document = "12345678",
  age = 34,
  sex = "MASCULINO",
  company = "EMPRESA SINTETICA",
  otherFinding = "",
} = {}) {
  return {
    template_id: "innomedic_resultado_evaluacion_medica_v1",
    identificacion: {
      nombre_completo_original: name,
      nombres: names,
      apellidos: surnames,
      dni: document,
      numero_documento: document,
      tipo_documento: "DNI",
      edad: age,
      sexo: sex,
      empresa: company,
    },
    datos_generales_narrables: {},
    laboratorio_numerico: {},
    evaluaciones_cualitativas: { otros_hallazgos_resultado: otherFinding },
    aptitud_y_recomendaciones: { aptitud_final: "APTO", recomendaciones_generales_texto: "" },
    derived_states: { reviewed_by_user: true, start_page: 1, end_page: 1 },
    app_fields: {},
    validation: { warnings: [], has_errors: false },
  };
}

function syntheticAnalysis(workers) {
  return {
    total_pages: workers.length,
    pages_analyzed: workers.length,
    workers,
    groups: workers.map((worker, index) => ({
      start_page: index + 1,
      end_page: index + 1,
      pages: [{
        page: index + 1,
        text: `APELLIDOS Y NOMBRES: ${worker.identificacion?.nombre_completo_original || ""} DNI: ${worker.identificacion?.numero_documento || ""} EDAD: ${worker.identificacion?.edad || ""} SEXO: ${worker.identificacion?.sexo || ""} EMPRESA: ${worker.identificacion?.empresa || ""}`,
      }],
    })),
  };
}

test("interpreta ruta explícita con prioridad y modos latest/all", () => {
  assert.deepEqual(parseAuditArguments(["archivo.pdf", "--latest", "--sanitized"]), {
    explicitPath: "archivo.pdf", latest: false, all: false, sanitized: true,
  });
  assert.equal(parseAuditArguments(["--latest"]).latest, true);
  assert.equal(parseAuditArguments(["--all"]).all, true);
});

test("resuelve ruta explícita, todos los locales y el latest más reciente", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clinical-audit-paths-"));
  const local = path.join(root, "auditoria-local");
  const downloads = path.join(root, "Descargas");
  await mkdir(local, { recursive: true });
  const first = path.join(local, "primeras-hojas.pdf");
  const second = path.join(local, "primeras-hojas (2).pdf");
  await writeFile(first, "pdf");
  await writeFile(second, "pdf");
  await writeFile(path.join(local, "otro.pdf"), "pdf");

  const explicit = await resolveAuditFiles([first, "--latest"], { cwd: root, downloadsRoot: downloads });
  assert.deepEqual(explicit.files, [first]);
  const all = await resolveAuditFiles(["--all"], { cwd: root, auditLocalDir: local });
  assert.deepEqual(all.files, [first, second]);

  const oldFile = path.join(downloads, "2026-01-01", "audioevaluaciones", "primeras-hojas.pdf");
  const newFile = path.join(downloads, "2026-02-01", "audioevaluaciones", "primeras-hojas.pdf");
  await mkdir(path.dirname(oldFile), { recursive: true });
  await mkdir(path.dirname(newFile), { recursive: true });
  await writeFile(oldFile, "old");
  await writeFile(newFile, "new");
  await utimes(oldFile, new Date("2026-01-01"), new Date("2026-01-01"));
  await utimes(newFile, new Date("2026-02-01"), new Date("2026-02-01"));
  const latest = await resolveAuditFiles(["--latest"], { cwd: root, downloadsRoot: downloads });
  assert.deepEqual(latest.files, [newFile]);
});

test("audita nombres correctos y flags estructurales de identidad", () => {
  const good = syntheticWorker();
  const goodNormalized = normalizeWorkerClinicalData(good).worker;
  assert.equal(auditIdentity(good, goodNormalized, "APELLIDOS Y NOMBRES: JUAN CARLOS QUISPE MAMANI DNI: 12345678").flags.length, 0);

  const missing = syntheticWorker({ name: "", names: "", surnames: "", document: "" });
  const missingFlags = auditIdentity(missing, normalizeWorkerClinicalData(missing).worker, "").flags.map((flag) => flag.type);
  assert.ok(missingFlags.includes("identity_name_missing"));
  assert.ok(missingFlags.includes("identity_document_missing"));

  const contaminated = syntheticWorker({ name: "JUAN QUISPE DNI 12345678", names: "JUAN", surnames: "QUISPE DNI 12345678" });
  const contaminatedFlags = auditIdentity(contaminated, normalizeWorkerClinicalData(contaminated).worker, "").flags.map((flag) => flag.type);
  assert.ok(contaminatedFlags.includes("identity_name_contains_numbers"));
  assert.ok(contaminatedFlags.includes("identity_name_contains_label"));

  const ceName = syntheticWorker({
    name: "MEDINA CENIZARIO JOSHMIL MAYER",
    names: "JOSHMIL MAYER",
    surnames: "MEDINA CENIZARIO",
  });
  const ceNameFlags = auditIdentity(
    ceName,
    normalizeWorkerClinicalData(ceName).worker,
    "APELLIDOS Y NOMBRES: MEDINA CENIZARIO JOSHMIL MAYER DNI: 12345678",
  ).flags;
  assert.equal(ceNameFlags.length, 0);

  const foreign = syntheticWorker({
    name: "VALLADARES CIRA KEINER GREGORIO",
    names: "KEINER GREGORIO",
    surnames: "VALLADARES CIRA",
    document: "001704377",
  });
  foreign.identificacion.tipo_documento = "CARNET DE EXTRANJERIA";
  const foreignFlags = auditIdentity(
    foreign,
    normalizeWorkerClinicalData(foreign).worker,
    "APELLIDOS Y NOMBRES: VALLADARES CIRA KEINER GREGORIO Carnet de Extranjeria: 001704377 EDAD: 35",
  ).flags;
  assert.equal(foreignFlags.length, 0);
});

test("genera resumen global, reportes privados/sanitizados y continúa tras un fallo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clinical-audit-run-"));
  const goodPath = path.join(root, "primeras-hojas.pdf");
  const badPath = path.join(root, "primeras-hojas (2).pdf");
  await writeFile(goodPath, "synthetic");
  await writeFile(badPath, "synthetic");
  const workers = [
    syntheticWorker(),
    syntheticWorker({ name: "MARIA LOPEZ 999", names: "MARIA", surnames: "LOPEZ 999", document: "", otherFinding: "PATRON SINTETICO NO CATALOGADO" }),
  ];
  const analyzePdf = async (file) => {
    if (file.name.includes("(2)")) throw new Error("fallo sintético de parser");
    return syntheticAnalysis(workers);
  };
  const outputDir = path.join(root, "clinical-audit");
  const result = await runClinicalAudit({ filePaths: [goodPath, badPath], analyzePdf, outputDir, sanitized: true });

  assert.equal(result.summary.filesProcessed, 2);
  assert.equal(result.summary.totals.workersCreated, 3);
  assert.equal(result.summary.totals.parserFailures, 1);
  assert.ok(result.summary.problemsByType.identity_name_contains_numbers >= 1);
  assert.ok(result.summary.problemsByType.identity_document_missing >= 1);
  assert.ok(result.summary.problemsByType.unsupported_pattern >= 1);
  assert.ok(result.cases.some((item) => item.flags.some((flag) => flag.type === "parser_failure")));

  const privateReport = await readFile(result.paths.privateReportPath, "utf8");
  const sanitizedReport = await readFile(result.paths.sanitizedReportPath, "utf8");
  const summary = JSON.parse(await readFile(result.paths.summaryPath, "utf8"));
  assert.match(privateReport, /MARIA LOPEZ 999/i);
  assert.match(privateReport, /Casos con revisión/);
  assert.doesNotMatch(sanitizedReport, /MARIA LOPEZ 999/i);
  assert.match(sanitizedReport, /\[DOCUMENTO\]/);
  assert.equal(summary.totals.parserFailures, 1);
});

test("marca duplicados e inconsistencias entre archivos sin eliminarlos", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clinical-audit-duplicates-"));
  const first = path.join(root, "primeras-hojas.pdf");
  const second = path.join(root, "primeras-hojas (2).pdf");
  await writeFile(first, "one");
  await writeFile(second, "two");
  const analyzePdf = async (file) => syntheticAnalysis([
    syntheticWorker({
      name: file.name.includes("(2)") ? "JUAN CARLOS QUISPE" : "JUAN CARLOS QUISPE MAMANI",
      names: "JUAN CARLOS",
      surnames: file.name.includes("(2)") ? "QUISPE" : "QUISPE MAMANI",
      document: "12345678",
    }),
  ]);
  const result = await runClinicalAudit({ filePaths: [first, second], analyzePdf, outputDir: path.join(root, "out") });
  assert.equal(result.cases.length, 2);
  assert.ok(result.cases.every((item) => item.flags.some((flag) => flag.type === "possible_duplicate_worker")));
  assert.ok(result.cases.every((item) => item.flags.some((flag) => flag.type === "identity_extraction_inconsistent")));
});
