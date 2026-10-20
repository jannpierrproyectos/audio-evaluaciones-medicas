import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { sanitizeFilePart, deliveryAttachmentName } from "./fileNames.js";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".mp3"]);

export class ManagedFileError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ManagedFileError";
    this.status = status;
    this.code = code;
  }
}

export function createManagedFileService({
  downloadsDir,
  revealFile = revealInWindowsExplorer,
  beforeSaveAudioDirectory = null,
  protectAudioFile = null,
  ensureProtectedFile = null,
  temporaryAttachments = null,
  readProtectedOutput = null,
  readFallbacks = [],
} = {}) {
  if (!downloadsDir) throw new Error("downloadsDir es obligatorio para administrar archivos locales.");
  const root = path.resolve(downloadsDir);
  // Read only exact relative references in explicitly known download locations.
  // Never scan by patient name, move originals or choose between colliding IDs.
  const seenRoots = new Set([root.toLowerCase()]);
  const readers = readFallbacks.filter(location => {
    const key = path.resolve(location.downloadsDir).toLowerCase();
    if (seenRoots.has(key)) return false;
    seenRoots.add(key); return true;
  }).map(location => createManagedFileService({ downloadsDir: location.downloadsDir, readProtectedOutput: location.readProtectedOutput,
    ensureProtectedFile, temporaryAttachments: null, revealFile }));

  async function identifyAbsoluteFile(absolutePath, expectedExtension) {
    const resolved = path.resolve(String(absolutePath || ""));
    const extension = validateExtension(resolved, expectedExtension);
    const [realRoot, realFile] = await Promise.all([
      realpath(root).catch(() => root),
      realpath(resolved).catch((error) => {
        if (error.code === "ENOENT") {
          throw new ManagedFileError(404, "FILE_NOT_FOUND", "El archivo solicitado no existe.");
        }
        throw error;
      }),
    ]);
    assertWithinRoot(realRoot, realFile);
    const info = await stat(realFile);
    if (!info.isFile()) throw new ManagedFileError(400, "NOT_A_FILE", "La referencia no corresponde a un archivo.");
    return {
      id: toPortableRelative(realRoot, realFile),
      name: path.basename(realFile),
      extension,
    };
  }

  async function resolveLocalFileId(fileId, expectedExtension) {
    if (temporaryAttachments?.isReference(fileId)) {
      if (expectedExtension && expectedExtension !== ".mp3") throw new ManagedFileError(415, "FILE_TYPE_NOT_ALLOWED", "Tipo de adjunto incompatible.");
      const file = await temporaryAttachments.readAudio(fileId);
      return { id: file.id, name: file.name, extension: file.extension, sha256: file.sha256 };
    }
    const raw = String(fileId ?? "").trim();
    if (!raw || raw.includes("\0") || isAbsoluteOrUnc(raw)) {
      throw new ManagedFileError(400, "INVALID_FILE_ID", "El identificador de archivo no es válido.");
    }
    const candidate = path.resolve(root, raw.replace(/[\\/]+/g, path.sep));
    assertWithinRoot(root, candidate);
    return identifyAbsoluteFile(candidate, expectedExtension);
  }

  async function sourceFor(fileId, expectedExtension) {
    if (!readers.length || temporaryAttachments?.isReference(fileId)) return { file: await resolveLocalFileId(fileId, expectedExtension), reader: null };
    const sources = [{ resolveFileId: resolveLocalFileId }, ...readers];
    const matches = []; let missing;
    for (const reader of sources) {
      try { matches.push({ file: await reader.resolveFileId(fileId, expectedExtension), reader: reader === sources[0] ? null : reader }); }
      catch (error) { if (error.code !== "FILE_NOT_FOUND") throw error; missing ||= error; }
    }
    if (matches.length > 1) throw new ManagedFileError(409, "FILE_LOCATION_AMBIGUOUS", "Hay mas de un archivo con esta referencia en las ubicaciones del Connector. Revisa el original antes de preparar el envio.");
    if (!matches.length) throw missing;
    return matches[0];
  }
  async function resolveFileId(fileId, expectedExtension) { return (await sourceFor(fileId, expectedExtension)).file; }

  async function reveal(fileId) {
    if (temporaryAttachments) {
      const file = await inspectFile(fileId);
      const lease = await temporaryAttachments.reveal(file, revealFile);
      return { id: file.id, name: "Adjunto temporal", extension: file.extension, ...lease };
    }
    const source = await sourceFor(fileId);
    if (source.reader) return source.reader.reveal(fileId);
    const file = source.file;
    if (ensureProtectedFile) {
      try { const absolute = path.resolve(root, file.id.replace(/\//g, path.sep)); await access(absolute, constants.R_OK); await ensureProtectedFile(absolute); }
      catch { throw new ManagedFileError(503, "FILE_PROTECTION_UNAVAILABLE", "No se puede mostrar el archivo sin comprobar su protección EFS y permisos."); }
    }
    try {
      await revealFile(path.resolve(root, file.id.replace(/\//g, path.sep)));
    } catch {
      throw new ManagedFileError(503, "FILE_REVEAL_FAILED", "No se pudo mostrar el archivo en el Explorador de Windows.");
    }
    return file;
  }

  async function saveMp3(buffer, requestedFileName) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ManagedFileError(400, "INVALID_AUDIO", "El audio MP3 está vacío o no es válido.");
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new ManagedFileError(413, "AUDIO_TOO_LARGE", "El audio excede el tamaño máximo permitido.");
    }
    if (!looksLikeMp3(buffer)) {
      throw new ManagedFileError(415, "INVALID_AUDIO", "El contenido recibido no corresponde a un MP3.");
    }

    if (temporaryAttachments) return temporaryAttachments.storeAudio(buffer);

    const audioDir = path.join(root, "audio-whatsapp");
    await mkdir(audioDir, { recursive: true });
    const [realRoot, realAudioDir] = await Promise.all([realpath(root), realpath(audioDir)]);
    assertWithinRoot(realRoot, realAudioDir);
    if (beforeSaveAudioDirectory) {
      try { await beforeSaveAudioDirectory(realAudioDir); }
      catch { throw new ManagedFileError(503, "AUDIO_EXPORT_PROTECTION_UNAVAILABLE", "Windows no permite proteger la copia de exportacion. El MP3 permanece en el almacenamiento cifrado."); }
    }
    const baseName = sanitizeAudioFilename(requestedFileName);
    const digest = createHash("sha256").update(buffer).digest("hex");
    const extension = path.extname(baseName);
    const stem = path.basename(baseName, extension);
    const candidates = [baseName, `${stem}_${digest.slice(0, 10)}.mp3`];

    for (const candidateName of candidates) {
      const candidate = path.join(realAudioDir, candidateName);
      try {
        await writeFile(candidate, buffer, { flag: "wx" });
        if (protectAudioFile) await protectAudioFile(candidate);
        return { ...(await identifyAbsoluteFile(candidate, ".mp3")), reused: false, sha256: digest };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (protectAudioFile) await protectAudioFile(candidate);
        const existing = await readFile(candidate);
        if (createHash("sha256").update(existing).digest("hex") === digest) {
          return { ...(await identifyAbsoluteFile(candidate, ".mp3")), reused: true, sha256: digest };
        }
      }
    }

    throw new ManagedFileError(409, "AUDIO_NAME_CONFLICT", "No se pudo asignar un nombre seguro al audio.");
  }

  async function inspectFile(fileId, expectedExtension) {
    if (temporaryAttachments?.isReference(fileId)) {
      if (expectedExtension && expectedExtension !== ".mp3") throw new ManagedFileError(415, "FILE_TYPE_NOT_ALLOWED", "Tipo de adjunto incompatible.");
      return temporaryAttachments.readAudio(fileId);
    }
    const source = await sourceFor(fileId, expectedExtension);
    if (source.reader) return source.reader.inspectFile(fileId, expectedExtension);
    const file = source.file;
    const absolute = path.resolve(root, file.id.replace(/\//g, path.sep));
    if (!ensureProtectedFile) throw new ManagedFileError(503, "FILE_PROTECTION_UNAVAILABLE", "No se puede comprobar la protección del archivo.");
    try { await access(absolute, constants.R_OK); await ensureProtectedFile(absolute); }
    catch { throw new ManagedFileError(503, "FILE_PROTECTION_UNAVAILABLE", "No se pudo proteger o leer el archivo. Revisa los permisos privados de Windows."); }
    const handle = await open(absolute, "r");
    try {
      const before = await handle.stat();
      if (before.size > 64 * 1024 * 1024) throw new ManagedFileError(413, "FILE_TOO_LARGE", "El archivo excede el tamaño permitido.");
      const bytes = readProtectedOutput ? await readProtectedOutput(absolute) : await handle.readFile(), after = await handle.stat();
      const latest = await resolveFileId(fileId, expectedExtension), current = await stat(absolute);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || latest.id !== file.id || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.size !== before.size) throw new ManagedFileError(409, "FILE_CHANGED", "El archivo cambió durante la lectura.");
      if (file.extension === ".pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") throw new ManagedFileError(415, "INVALID_PDF", "El archivo no es un PDF válido.");
      return { ...file, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
    } finally { await handle.close(); }
  }
  async function revealPinned(fileId, expectedHash, extension, recipientName) {
    const file = await inspectFile(fileId, extension);
    if (file.sha256 !== expectedHash) throw new ManagedFileError(409, "FILE_CHANGED", "El contenido del archivo ya no coincide con la entrega preparada.");
    if (temporaryAttachments) return temporaryAttachments.reveal({ ...file, attachmentName: deliveryAttachmentName(recipientName, extension) }, revealFile);
    return reveal(file.id);
  }
  const releaseTemporary = ids => temporaryAttachments?.release(ids);
  return { identifyAbsoluteFile, resolveFileId, reveal, saveMp3, inspectFile, revealPinned, releaseTemporary };
}

export function sanitizeAudioFilename(value) {
  const withoutExtension = String(value || "")
    .split("")
    .map((character) => character.charCodeAt(0) < 32 ? " " : character)
    .join("")
    .replace(/\.mp3$/i, "");
  const safe = sanitizeFilePart(withoutExtension, "02_Audio_Trabajador")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  return `${safe}.mp3`;
}

export function looksLikeMp3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

export function revealInWindowsExplorer(absolutePath, {
  platform = process.platform,
  spawnProcess = spawn,
} = {}) {
  if (platform !== "win32") {
    return Promise.reject(new Error("Explorer solo está disponible en Windows."));
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess("explorer.exe", [`/select,${absolutePath}`], {
      detached: true,
      shell: false,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function validateExtension(filePath, expectedExtension) {
  const extension = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || (expectedExtension && extension !== expectedExtension)) {
    throw new ManagedFileError(415, "FILE_TYPE_NOT_ALLOWED", "Solo se permiten archivos PDF y MP3 administrados por AudioEvaluaciones.");
  }
  return extension;
}

function isAbsoluteOrUnc(value) {
  return path.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || value.startsWith("\\\\")
    || value.startsWith("//");
}

function assertWithinRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ManagedFileError(400, "FILE_OUTSIDE_MANAGED_DIRECTORY", "El archivo está fuera de la carpeta administrada por AudioEvaluaciones.");
  }
}

function toPortableRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}
