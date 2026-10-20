import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, lstat, realpath, open, link, unlink } from "node:fs/promises";
import { deliveryAttachmentName } from "./attachmentNames.js";
import { getWhatsAppRecipientName } from "./whatsappContent.js";
import { looksLikeMp3 } from "./managedFiles.js";
import { restrictDirectory } from "./windowsProtection.js";
import { createEncryptedOutput } from "./encryptedOutput.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const runName = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-f0-9]{8}$/i;

// Normal, persistent operator documents. Internal catalogue/legacy ciphertext is
// retained for compatibility; these files neither expire nor need the Connector.
export class DocumentLibrary {
  constructor({ downloadsDir, protect = restrictDirectory, readOutput = null }) {
    this.directory = path.resolve(downloadsDir, "Documentos");
    this.protect = protect;
    this.readOutput = readOutput;
  }

  async publish(bytes, patient, extension) {
    if (!Buffer.isBuffer(bytes) || (extension === ".pdf" ? bytes.subarray(0, 5).toString() !== "%PDF-" : extension !== ".mp3" || !looksLikeMp3(bytes))) throw new Error("DOCUMENT_INVALID");
    const directory = path.join(this.directory, extension === ".pdf" ? "PDF" : "MP3");
    await mkdir(directory, { recursive: true });
    for (const parent of [this.directory, directory]) {
      if ((await lstat(parent)).isSymbolicLink() || path.resolve(await realpath(parent)).toLowerCase() !== path.resolve(parent).toLowerCase()) throw new Error("DOCUMENT_PATH_REDIRECTED");
    }
    this.protection ||= this.protect(this.directory).catch(error => { this.protection = null; throw error; });
    await this.protection;
    const name = deliveryAttachmentName(patient, extension);
    const fingerprint = hash(bytes);
    const candidates = [name, `${path.basename(name, extension)}_${fingerprint.slice(0, 12)}${extension}`];
    for (const filename of candidates) {
      const file = path.join(directory, filename);
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("DOCUMENT_PATH_REDIRECTED");
        if (hash(await readFile(file)) === fingerprint) return { file, reused: true };
        continue;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes); await handle.sync(); await handle.close();
        try { await link(temporary, file); return { file, reused: false }; }
        catch (error) {
          if (error.code !== "EEXIST") throw error;
          const info = await lstat(file);
          if (info.isSymbolicLink() || !info.isFile()) throw new Error("DOCUMENT_PATH_REDIRECTED");
          if (hash(await readFile(file)) === fingerprint) return { file, reused: true };
        }
      } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
    }
    throw new Error("DOCUMENT_NAME_CONFLICT");
  }

  async publishAudio(store, operation) {
    if (operation.status !== "listo") return;
    const { data } = await store.catalogue();
    const worker = data.batches.find(b => b.id === operation.batch_id)?.snapshot.workers.find(w => w.evaluation_id === operation.evaluation_id);
    if (!worker) return;
    const { bytes } = await store.readAudioFile(operation);
    return this.publish(bytes, getWhatsAppRecipientName(worker), ".mp3");
  }

  async findImport(fingerprint, { store, roots }) {
    const matches = [];
    for (const root of new Set(roots)) {
      const read = this.readOutput ? file => this.readOutput(root, file) : createEncryptedOutput({ downloadsDir: root, getStore: async () => store }).read;
      for (const run of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && runName.test(entry.name))) {
        try {
          const directory = path.join(root, run.name);
          if (hash(await read(path.join(directory, "audioevaluaciones", "primeras-hojas.pdf"))) !== fingerprint) continue;
          const manifest = JSON.parse((await read(path.join(directory, "control", "manifest.json"))).toString());
          const workers = (manifest.atenciones || []).filter(entry => entry.estado === "correcto").map(entry => {
            const absolute = entry.archivoCompleto ? path.resolve(directory, entry.archivoCompleto) : "";
            const relative = absolute && path.relative(directory, absolute);
            const valid = relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.extname(absolute).toLowerCase() === ".pdf";
            return { numeroDocumento: entry.numeroDocumento || "", paginaConsolidado: entry.paginaConsolidado || "", telefono: entry.telefono || "",
              archivoPdfCompleto: entry.archivoPdfCompleto || "", archivoPdfCompletoId: valid ? path.relative(root, absolute).split(path.sep).join("/") : "" };
          });
          matches.push({ matched: true, mode: manifest.mode || "both", workers });
        } catch { /* A missing/unreadable download never creates a guessed link. */ }
      }
    }
    return matches.length === 1 ? matches[0] : { matched: false, ambiguous: matches.length > 1, workers: [] };
  }

  async restore({ store, roots, logger = console }) {
    let pdf = 0, audio = 0, errors = 0;
    for (const root of new Set(roots)) {
      const read = this.readOutput ? file => this.readOutput(root, file) : createEncryptedOutput({ downloadsDir: root, getStore: async () => store }).read;
      const runs = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const run of runs.filter(entry => entry.isDirectory() && runName.test(entry.name))) {
        const directory = path.join(root, run.name);
        try {
          const manifest = JSON.parse((await read(path.join(directory, "control", "manifest.json"))).toString());
          try {
            await this.publish(await read(path.join(directory, "audioevaluaciones", "primeras-hojas.pdf")), `Lote_${run.name}`, ".pdf");
          } catch { /* Older full-only downloads have no consolidated first pages. */ }
          for (const entry of manifest.atenciones || []) {
            if (entry.estado !== "correcto" || !entry.archivoCompleto) continue;
            try {
              const file = path.resolve(directory, entry.archivoCompleto);
              const relative = path.relative(directory, file);
              if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.extname(file).toLowerCase() !== ".pdf") throw new Error("DOCUMENT_INVALID_PATH");
              await this.publish(await read(file), entry.paciente, ".pdf"); pdf++;
            } catch { errors++; }
          }
        } catch { errors++; }
      }
    }
    const { data } = await store.catalogue();
    for (const operation of Object.values(data.operations)) {
      if (operation.status !== "listo") continue;
      try { if (await this.publishAudio(store, operation)) audio++; } catch { errors++; }
    }
    logger.log(`Documentos locales disponibles: PDF=${pdf}, MP3=${audio}, incidencias=${errors}.`);
    return { pdf, audio, errors };
  }
}
