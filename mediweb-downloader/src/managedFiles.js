import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { sanitizeFilePart } from "./fileNames.js";

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
} = {}) {
  if (!downloadsDir) throw new Error("downloadsDir es obligatorio para administrar archivos locales.");
  const root = path.resolve(downloadsDir);

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

  async function resolveFileId(fileId, expectedExtension) {
    const raw = String(fileId ?? "").trim();
    if (!raw || raw.includes("\0") || isAbsoluteOrUnc(raw)) {
      throw new ManagedFileError(400, "INVALID_FILE_ID", "El identificador de archivo no es válido.");
    }
    const candidate = path.resolve(root, raw.replace(/[\\/]+/g, path.sep));
    assertWithinRoot(root, candidate);
    return identifyAbsoluteFile(candidate, expectedExtension);
  }

  async function reveal(fileId) {
    const file = await resolveFileId(fileId);
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

    const audioDir = path.join(root, "audio-whatsapp");
    await mkdir(audioDir, { recursive: true });
    const [realRoot, realAudioDir] = await Promise.all([realpath(root), realpath(audioDir)]);
    assertWithinRoot(realRoot, realAudioDir);
    const baseName = sanitizeAudioFilename(requestedFileName);
    const digest = createHash("sha256").update(buffer).digest("hex");
    const extension = path.extname(baseName);
    const stem = path.basename(baseName, extension);
    const candidates = [baseName, `${stem}_${digest.slice(0, 10)}.mp3`];

    for (const candidateName of candidates) {
      const candidate = path.join(realAudioDir, candidateName);
      try {
        await writeFile(candidate, buffer, { flag: "wx" });
        return { ...(await identifyAbsoluteFile(candidate, ".mp3")), reused: false, sha256: digest };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(candidate);
        if (createHash("sha256").update(existing).digest("hex") === digest) {
          return { ...(await identifyAbsoluteFile(candidate, ".mp3")), reused: true, sha256: digest };
        }
      }
    }

    throw new ManagedFileError(409, "AUDIO_NAME_CONFLICT", "No se pudo asignar un nombre seguro al audio.");
  }

  return { identifyAbsoluteFile, resolveFileId, reveal, saveMp3 };
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
