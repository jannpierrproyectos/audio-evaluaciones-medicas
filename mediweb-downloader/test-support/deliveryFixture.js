import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { EvaluationStore } from "../src/evaluationStore.js";
import { DeliveryService } from "../src/deliveryService.js";
import { createManagedFileService } from "../src/managedFiles.js";
import { prepareAnalysisForReview } from "../../src/lib/workerReviewUx.js";
import { approveClinicalText, reconcileWorkerReview } from "../../src/lib/clinicalApproval.js";
import { recordWhatsAppDecision } from "../../src/lib/whatsappReview.js";
import { audioFingerprint, sha256 } from "../../src/lib/evaluationPersistence.js";
import { prepareTextForTts } from "../../src/clinical/ttsNormalizer.js";

export const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
export const text = "Buenos días. Texto ficticio aprobado para comprobar entregas.";
export async function pdfBytes(id = 1, date = "17/10/2026", extraId = null) {
  const pdf = await PDFDocument.create(), page = pdf.addPage(), font = await pdf.embedFont(StandardFonts.Helvetica);
  [`DNI: 0000000${id}`, `FECHA DE EVALUACION: ${date}`, "RESULTADO DE EVALUACION MEDICA", "APTITUD: APTO"].forEach((line, index) => page.drawText(line, { x: 40, y: 760 - 25 * index, font, size: 12 }));
  if (extraId) pdf.addPage().drawText(`DNI: 0000000${extraId}`, { x: 40, y: 760, font, size: 12 });
  return Buffer.from(await pdf.save());
}
export async function deliveryFixture(callback, { realProtection = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-delivery-test-")), downloads = path.join(directory, "downloads");
  await mkdir(downloads);
  const protection = realProtection ? undefined : { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
  let store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection }).initialize();
  const revealed = []; let denied = false;
  const files = createManagedFileService({ downloadsDir: downloads, ensureProtectedFile: async () => { if (denied) throw new Error("EFS no disponible"); },
    beforeSaveAudioDirectory: async () => { if (denied) throw new Error("EFS no disponible"); }, protectAudioFile: async () => {}, revealFile: async file => { revealed.push(file); } });
  const getStore = async () => store;
  let service = new DeliveryService({ getStore, managedFiles: files });
  const input = prepareAnalysisForReview({ greeting: "Buenos días", workers: [1, 2].map(id => ({
    identificacion: { nombres: `Persona${id}`, apellidos: "Ficticia", dni: `0000000${id}`, fecha_evaluacion: "17/10/2026" },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" },
    datos_operativos: { telefono: `99911111${id}`, archivo_pdf_completo: `informe-${id}.pdf`, archivo_pdf_completo_id: `informe-${id}.pdf` },
  })) }, "mediweb");
  const batch = await store.import(input, await sha256("delivery-fixture"));
  for (let index = 0; index < 2; index++) {
    await writeFile(path.join(downloads, `informe-${index + 1}.pdf`), await pdfBytes(index + 1));
    let worker = approveClinicalText(batch.snapshot.workers[index], text);
    worker = recordWhatsAppDecision(worker, "confirmado_por_operador", { identity: true, consent: true, pdf: true, saveAuthorization: true, expires_at: "2099-01-01T00:00:00Z" });
    const fingerprint = await audioFingerprint(worker, text, configuration);
    const metadata = { evaluation_id: worker.evaluation_id, fingerprint, text, tts_text: prepareTextForTts(text), configuration };
    const op = await store.reserve(batch.id, worker.evaluation_id, fingerprint);
    await store.complete(op.id, Buffer.from(`ID3synthetic-delivery-${index}`), metadata);
    batch.snapshot.workers[index] = { ...worker, app_fields: { ...worker.app_fields, audio_record: metadata, audio_status: "listo", audio_stale: false } };
  }
  await store.save(batch.id, batch.snapshot, batch.revision);
  const update = async (index, change) => {
    const loaded = await store.load(batch.id), current = loaded.snapshot.workers[index];
    loaded.snapshot.workers[index] = reconcileWorkerReview(current, change(current));
    await store.save(batch.id, loaded.snapshot, loaded.revision);
  };
  const prepare = async (index = 0) => {
    const evaluationId = batch.snapshot.workers[index].evaluation_id, detail = await service.detail(evaluationId);
    return service.prepare({ evaluationId, expectedBinding: detail.binding, configuration });
  };
  const effect = async (record, kind) => {
    const begun = await service.begin({ id: record.id, kind, configuration });
    return service.settle({ id: record.id, intent: begun.intent, success: true, configuration });
  };
  try { await callback({ directory, downloads, revealed, files, get store() { return store; }, get service() { return service; }, batch, getStore,
    update, prepare, effect, deny: () => { denied = true; },
    restart: async () => { store = await new EvaluationStore({ directory: path.join(directory, "vault"), protection }).initialize(); service = new DeliveryService({ getStore, managedFiles: files }); },
  }); } finally { await rm(directory, { recursive: true, force: true }); }
}
