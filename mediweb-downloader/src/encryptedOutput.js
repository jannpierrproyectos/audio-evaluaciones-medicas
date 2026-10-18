import path from "node:path";
import { readFile, realpath, lstat } from "node:fs/promises";
import { writeAtomicOutput } from "./manifest.js";
import { restrictDirectory, verifyPrivateDirectory } from "./windowsProtection.js";

// Same AES-GCM/DPAPI key as evaluations. Encrypt BEFORE the first disk write;
// no plaintext intermediate files, no second key store or export catalogue.
export function createEncryptedOutput({ downloadsDir, getStore, protect = restrictDirectory, verify = verifyPrivateDirectory }) {
  const root = path.resolve(downloadsDir);
  async function context(file, checkAcl = true) {
    const relative = path.relative(root, path.resolve(file));
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Archivo fuera de las descargas administradas.");
    const parent = path.dirname(path.resolve(file));
    if (path.relative(await realpath(parent), parent)) throw new Error("Ruta de descarga redirigida.");
    if (checkAcl) await verify(parent);
    return `downloads:${relative.split(path.sep).join("/")}`;
  }
  async function protectOutput(paths) {
    await getStore(); // DPAPI must work before downloading any document.
    for (const directory of [paths.root, paths.control, paths.tmp, paths.full, paths.audio].filter(Boolean)) {
      if ((await lstat(directory)).isSymbolicLink() || path.relative(await realpath(directory), path.resolve(directory))) throw new Error("Ruta de salida redirigida.");
      await protect(directory); await verify(directory);
    }
  }
  async function write(file, bytes) {
    // Each run has already verified all output ACLs. The atomic writer receives
    // ciphertext only; do not launch another PowerShell process per checkpoint.
    const aad = await context(file, false), store = await getStore();
    await writeAtomicOutput(file, Buffer.concat([Buffer.from("AED1"), store.seal(Buffer.from(bytes), aad)]));
  }
  async function read(file) {
    const aad = await context(file);
    if ((await lstat(file)).isSymbolicLink()) throw new Error("Archivo redirigido.");
    const bytes = await readFile(file);
    if (bytes.subarray(0, 4).toString() !== "AED1") return bytes; // Existing/manual PDF: never silently rewrite/delete it.
    return (await getStore()).unseal(bytes.subarray(4), aad);
  }
  return { protectOutput, write, read };
}
