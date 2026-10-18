import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { protectKey, restrictDirectory } from "./windowsProtection.js";
import { looksLikeMp3, MAX_AUDIO_BYTES } from "./managedFiles.js";

const idPattern = /^[a-f0-9-]{36}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = (code = "STORE_INVALID", status = 409) => Object.assign(new Error("No se pudo completar el almacenamiento seguro. Recarga el lote antes de continuar."), { code, status });
const validId = id => { if (!idPattern.test(id || "")) throw fail("STORE_INVALID_ID", 400); return id; };

// One encrypted catalogue transaction contains batch snapshots and operation journal.
// Binaries are immutable and are committed before their reference in the catalogue.
export class EvaluationStore {
  constructor({ directory, protection = { protectKey, restrictDirectory }, now = () => new Date() }) {
    this.directory = path.resolve(directory);
    this.protection = protection;
    this.now = now;
    this.tail = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.protection.restrictDirectory(this.directory);
    const keyPath = path.join(this.directory, "key.dpapi");
    try {
      this.key = await this.protection.protectKey(await readFile(keyPath), true);
    } catch (error) {
      if (error.code !== "ENOENT") throw fail("STORE_KEY_UNAVAILABLE", 503);
      // A missing key with existing ciphertext must never create a replacement key.
      if ((await readdir(this.directory)).some(name => name.endsWith(".enc"))) throw fail("STORE_KEY_UNAVAILABLE", 503);
      this.key = randomBytes(32);
      const protectedKey = await this.protection.protectKey(this.key);
      const handle = await open(keyPath, "wx", 0o600);
      try { await handle.writeFile(protectedKey); await handle.sync(); }
      finally { await handle.close(); }
    }
    if (this.key.length !== 32) throw fail("STORE_KEY_UNAVAILABLE", 503);
    return this;
  }

  seal(bytes, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`AudioEvaluaciones:1:${context}`));
    const content = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([Buffer.from("AE01"), iv, cipher.getAuthTag(), content]);
  }

  unseal(bytes, context) {
    if (bytes.subarray(0, 4).toString() !== "AE01") throw fail("STORE_CORRUPT");
    const cipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(4, 16));
    cipher.setAAD(Buffer.from(`AudioEvaluaciones:1:${context}`));
    cipher.setAuthTag(bytes.subarray(16, 32));
    try { return Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]); }
    catch { throw fail("STORE_CORRUPT"); }
  }

  async atomic(file, bytes) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  }

  async catalogue() {
    const file = path.join(this.directory, "catalogue.enc");
    const decode = bytes => {
      const data = JSON.parse(this.unseal(bytes, "catalogue").toString());
      if (data.schema !== 1 || !Array.isArray(data.batches) || !data.operations) throw fail("STORE_SCHEMA_UNSUPPORTED");
      return data;
    };
    try { return { data: decode(await readFile(file)), recovered: false }; }
    catch (error) {
      if (error.code === "STORE_SCHEMA_UNSUPPORTED") throw error;
      try { return { data: decode(await readFile(`${file}.bak`)), recovered: true }; }
      catch (backupError) {
        if (error.code === "ENOENT" && backupError.code === "ENOENT") return { data: { schema: 1, batches: [], operations: {} }, recovered: false };
        throw fail("STORE_CORRUPT", 503);
      }
    }
  }

  async exclusive(action) {
    const run = async () => {
      const lockPath = path.join(this.directory, "write.lock");
      let lock;
      try { lock = await open(lockPath, "wx", 0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Crash recovery only when the recorded process is definitely no longer alive.
        const pid = Number(await readFile(lockPath, "utf8"));
        try { process.kill(pid, 0); throw fail("STORE_BUSY"); }
        catch (cause) { if (cause.code !== "ESRCH") throw fail("STORE_BUSY"); }
        await unlink(lockPath);
        lock = await open(lockPath, "wx", 0o600);
      }
      try {
        await lock.writeFile(String(process.pid)); await lock.sync();
        const { data, recovered } = await this.catalogue();
        const result = await action(data, recovered);
        if (result.write) {
          const file = path.join(this.directory, "catalogue.enc");
          // Backup is always a validated snapshot. Never replace it with corrupt ciphertext.
          await this.atomic(`${file}.bak`, this.seal(Buffer.from(JSON.stringify(data)), "catalogue"));
          await this.atomic(file, this.seal(Buffer.from(JSON.stringify(data)), "catalogue"));
        }
        const knownAudio = new Set(Object.values(data.operations).map(op => `${op.id}.enc`));
        for (const name of await readdir(this.directory)) {
          const temporary = /^(?:catalogue\.enc(?:\.bak)?|[a-f0-9-]{36}\.enc)\.[a-f0-9-]{36}\.tmp$/i.test(name);
          const orphan = /^[a-f0-9-]{36}\.enc$/i.test(name) && !knownAudio.has(name);
          if (temporary || orphan) await unlink(path.join(this.directory, name)).catch(() => {});
        }
        return result.value;
      } finally { await lock.close(); await unlink(lockPath); }
    };
    const promise = this.tail.then(run, run);
    this.tail = promise.catch(() => {});
    return promise;
  }

  list() {
    return this.exclusive(async (data, recovered) => ({ value: { recovered, batches: data.batches.map(batch => ({
      id: batch.id, revision: batch.revision, updated_at: batch.updated_at,
      file_name: batch.snapshot.file_name, workers: batch.snapshot.workers.length,
    })) } }));
  }

  // Server-owned orchestration state; never accepts paths or checkpoints from React.
  processingState(change = null) {
    return this.exclusive(async data => {
      data.processing ||= { profiles: [], runs: [] };
      const value = change ? await change(data.processing) : structuredClone(data.processing);
      return { value, write: Boolean(change) };
    });
  }

  contacts() {
    // Same encrypted catalogue and access checks as Phase 01. No clinical text,
    // findings, approval text or audio is returned by this contact-only view.
    return this.exclusive(async data => ({ value: { contacts: data.batches.flatMap(batch => batch.snapshot.workers.map(worker => ({
      evaluation_id: worker.evaluation_id, batch_id: batch.id, worker_id: worker.worker_id, source_mode: worker.source_mode,
      identificacion: worker.identificacion, datos_operativos: worker.datos_operativos,
      app_fields: {
        whatsapp_verification: worker.app_fields?.whatsapp_verification,
        whatsapp_confirmed_phone: worker.app_fields?.whatsapp_confirmed_phone,
        recipient_authorization: worker.app_fields?.recipient_authorization,
        phone_analysis: worker.app_fields?.phone_analysis,
      },
    }))) } }));
  }

  import(snapshot, importKey) {
    if (!hashPattern.test(importKey || "")) throw fail("STORE_INVALID_IMPORT", 400);
    this.validateSnapshot(snapshot);
    return this.exclusive(async data => {
      const existing = data.batches.find(batch => batch.import_key === importKey);
      if (existing) return { value: structuredClone(existing) };
      const batch = { id: randomUUID(), import_key: importKey, revision: 1, updated_at: this.now().toISOString(), snapshot: this.clean(snapshot) };
      batch.snapshot.batch_id = batch.id;
      const duplicateBatches = new Set();
      let recipientChanged = false;
      const seen = new Map();
      batch.snapshot.workers = batch.snapshot.workers.flatMap((worker, index) => {
        const identity = worker.identificacion || {};
        const document = String(identity.numero_documento || identity.dni || "").replace(/\W/g, "").toUpperCase();
        const workerId = document ? createHmac("sha256", this.key).update(`${identity.tipo_documento || "documento"}:${document}`).digest("hex") : randomUUID();
        // Only an explicit encounter reference permits deduplication across PDFs.
        // A shared DNI or date alone never merges two evaluations.
        const encounter = identity.n_ficha && identity.fecha_evaluacion && document
          ? `${worker.source_mode}:${document}:${identity.n_ficha}:${identity.fecha_evaluacion}` : `${importKey}:${index}`;
        const encounterKey = createHmac("sha256", this.key).update(encounter).digest("hex");
        const content = digest(Buffer.from(JSON.stringify([worker.identificacion, worker.datos_generales_narrables, worker.laboratorio_numerico, worker.evaluaciones_cualitativas, worker.aptitud_y_recomendaciones])));
        if (seen.has(encounterKey)) {
          if (seen.get(encounterKey) !== content) throw fail("STORE_EVALUATION_CONFLICT");
          return [];
        }
        seen.set(encounterKey, content);
        for (const previous of data.batches) {
          const match = previous.snapshot.workers.find(item => item.source_evaluation_key === encounterKey);
          if (!match) continue;
          if (match.source_content_hash !== content) throw fail("STORE_EVALUATION_CONFLICT");
          if (String(match.datos_operativos?.telefono || "") !== String(worker.datos_operativos?.telefono || "") ||
            (!match.datos_operativos?.archivo_pdf_completo_id && worker.datos_operativos?.archivo_pdf_completo_id)) {
            // Same clinical encounter, new recipient evidence: preserve clinical
            // content/approval but never silently resurrect the old delivery consent.
            match.datos_operativos = structuredClone(worker.datos_operativos || {});
            match.app_fields = { ...match.app_fields, recipient_authorization: null, whatsapp_verification: null, whatsapp_confirmed_phone: "", audio_stale: true };
            previous.revision++; previous.updated_at = this.now().toISOString(); recipientChanged = true;
          }
          duplicateBatches.add(previous.id);
          return [];
        }
        return [{ ...worker, worker_id: workerId, source_evaluation_key: encounterKey, source_content_hash: content, evaluation_id: randomUUID(), batch_id: batch.id }];
      });
      if (batch.snapshot.workers.length === 0 && duplicateBatches.size) return { write: recipientChanged, value: { ...structuredClone(data.batches.find(item => duplicateBatches.has(item.id))), recovered_batch_ids: [...duplicateBatches] } };
      batch.snapshot.duplicate_batch_ids = [...duplicateBatches];
      batch.snapshot.workers_detected = batch.snapshot.workers.length;
      data.batches.push(batch);
      return { write: true, value: structuredClone(batch) };
    });
  }

  load(id) {
    validId(id);
    return this.exclusive(async (data, recovered) => {
      const batch = data.batches.find(item => item.id === id);
      if (!batch) throw fail("STORE_NOT_FOUND", 404);
      return { value: { ...structuredClone(batch), recovered } };
    });
  }

  save(id, snapshot, revision) {
    validId(id); this.validateSnapshot(snapshot);
    return this.exclusive(async data => {
      const batch = data.batches.find(item => item.id === id);
      if (!batch) throw fail("STORE_NOT_FOUND", 404);
      if (batch.revision !== revision) throw fail("STORE_REVISION_CONFLICT");
      if (snapshot.batch_id !== id || snapshot.workers.length !== batch.snapshot.workers.length || snapshot.workers.some((worker, index) => worker.evaluation_id !== batch.snapshot.workers[index].evaluation_id || worker.batch_id !== id)) throw fail("STORE_IDENTITY_CONFLICT");
      batch.snapshot = this.clean(snapshot);
      batch.revision++; batch.updated_at = this.now().toISOString();
      return { write: true, value: { id, revision: batch.revision } };
    });
  }

  reserve(batchId, evaluationId, fingerprint) {
    validId(batchId); validId(evaluationId);
    if (!hashPattern.test(fingerprint || "")) throw fail("STORE_INVALID_AUDIO", 400);
    return this.exclusive(async data => {
      const batch = data.batches.find(item => item.id === batchId);
      if (!batch?.snapshot.workers.some(worker => worker.evaluation_id === evaluationId)) throw fail("STORE_NOT_FOUND", 404);
      const key = `${evaluationId}:${fingerprint}`;
      const previous = data.operations[key];
      if (previous && previous.status !== "no_enviada") return { value: { ...previous, reused: true } };
      if (Object.values(data.operations).some(op => op.evaluation_id === evaluationId && op.status === "solicitado")) throw fail("STORE_AUDIO_UNCERTAIN");
      const operation = { id: randomUUID(), batch_id: batchId, evaluation_id: evaluationId, fingerprint, status: "solicitado", created_at: this.now().toISOString() };
      data.operations[key] = operation;
      return { write: true, value: { ...operation, reused: false } };
    });
  }

  operation(evaluationId, fingerprint) {
    validId(evaluationId);
    if (!hashPattern.test(fingerprint || "")) throw fail("STORE_INVALID_AUDIO", 400);
    return this.exclusive(async data => {
      const operation = data.operations[`${evaluationId}:${fingerprint}`];
      if (operation?.status === "solicitado") {
        // Recover a binary committed just before a crash of the catalogue transaction.
        try {
          const record = await this.readAudioFile(operation);
          Object.assign(operation, { status: "listo", sha256: record.sha256, metadata: record.metadata, completed_at: this.now().toISOString() });
          return { write: true, value: structuredClone(operation) };
        } catch (error) { if (error.code !== "ENOENT") throw fail("STORE_CORRUPT"); }
      }
      return { value: structuredClone(operation || { status: "no_solicitado" }) };
    });
  }

  cancelUnsent(operationId) {
    validId(operationId);
    return this.exclusive(async data => {
      const operation = Object.values(data.operations).find(op => op.id === operationId);
      if (!operation || operation.status !== "solicitado") throw fail("STORE_AUDIO_CONFLICT");
      operation.status = "no_enviada";
      return { write: true, value: { cancelled: true } };
    });
  }

  complete(operationId, bytes, metadata) {
    validId(operationId);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_AUDIO_BYTES || !looksLikeMp3(bytes)) throw fail("STORE_INVALID_MP3", 415);
    return this.exclusive(async data => {
      const operation = Object.values(data.operations).find(op => op.id === operationId);
      if (!operation) throw fail("STORE_NOT_FOUND", 404);
      if (operation.status === "listo") {
        if (operation.sha256 !== digest(bytes)) throw fail("STORE_AUDIO_CONFLICT");
        return { value: operation };
      }
      if (metadata.fingerprint !== operation.fingerprint || metadata.evaluation_id !== operation.evaluation_id) throw fail("STORE_IDENTITY_CONFLICT");
      const file = path.join(this.directory, `${operation.id}.enc`);
      const record = { schema: 1, metadata, sha256: digest(bytes), audio: bytes.toString("base64") };
      await this.atomic(file, this.seal(Buffer.from(JSON.stringify(record)), operation.id));
      Object.assign(operation, { status: "listo", sha256: digest(bytes), metadata, completed_at: this.now().toISOString() });
      return { write: true, value: structuredClone(operation) };
    });
  }

  audio(batchId, evaluationId, operationId) {
    validId(batchId); validId(evaluationId); validId(operationId);
    return this.exclusive(async data => {
      const operation = Object.values(data.operations).find(op => op.id === operationId && op.batch_id === batchId && op.evaluation_id === evaluationId && op.status === "listo");
      if (!operation) throw fail("STORE_NOT_FOUND", 404);
      const { bytes } = await this.readAudioFile(operation);
      if (digest(bytes) !== operation.sha256) throw fail("STORE_CORRUPT");
      return { value: { bytes, operation: structuredClone(operation) } };
    });
  }

  async readAudioFile(operation) {
    const payload = this.unseal(await readFile(path.join(this.directory, `${validId(operation.id)}.enc`)), operation.id);
    const record = JSON.parse(payload.toString());
    const bytes = Buffer.from(record.audio || "", "base64");
    if (record.schema !== 1 || record.metadata?.evaluation_id !== operation.evaluation_id || record.metadata?.fingerprint !== operation.fingerprint || digest(bytes) !== record.sha256 || !looksLikeMp3(bytes)) throw fail("STORE_CORRUPT");
    return { ...record, bytes };
  }

  remove(id, revision) {
    validId(id);
    return this.exclusive(async data => {
      const batch = data.batches.find(item => item.id === id);
      if (!batch || batch.revision !== revision) throw fail("STORE_REVISION_CONFLICT");
      const deliveries = (data.deliveries || []).filter(record => record.batch_id === id);
      if (deliveries.some(record => record.pending || ["completada", "incierta"].includes(record.state) || Object.keys(record.confirmations || {}).length || record.events?.some(event => ["conversation", "message", "pdf", "mp3", "confirm"].includes(event.action)))) throw fail("STORE_DELIVERY_HISTORY_PRESENT");
      data.batches = data.batches.filter(item => item.id !== id);
      if (data.deliveries) data.deliveries = data.deliveries.filter(record => record.batch_id !== id);
      const files = Object.values(data.operations).filter(op => op.batch_id === id).map(op => op.id);
      data.operations = Object.fromEntries(Object.entries(data.operations).filter(([, op]) => op.batch_id !== id));
      // Commit references first. Ciphertext garbage is removed separately after successful commit.
      return { write: true, value: { removed: true, orphanIds: files } };
    }).then(async result => {
      for (const file of result.orphanIds) await unlink(path.join(this.directory, `${validId(file)}.enc`)).catch(() => {});
      return { removed: true };
    });
  }

  validateSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.workers) || snapshot.workers.length > 3000 || Buffer.byteLength(JSON.stringify(snapshot)) > 16 * 1024 * 1024) throw fail("STORE_INVALID_SNAPSHOT", 400);
  }

  clean(snapshot) {
    // Minimize parser/debug payloads and strip transient URLs and unmanaged exported audio.
    const clean = JSON.parse(JSON.stringify(snapshot, (key, value) => {
      if (["raw_text", "rawText", "page_text", "pages", "trace", "audio_url", "whatsapp_audio_file_id", "whatsapp_audio_filename", "whatsapp_audio_sha256"].includes(key)) return undefined;
      if (typeof value === "string" && /^(blob:|data:)/.test(value)) return undefined;
      return value;
    }));
    return clean;
  }

  async storageSize() {
    const entries = await readdir(this.directory);
    const sizes = await Promise.all(entries.map(name => stat(path.join(this.directory, name))));
    return sizes.reduce((sum, info) => sum + info.size, 0);
  }
}
