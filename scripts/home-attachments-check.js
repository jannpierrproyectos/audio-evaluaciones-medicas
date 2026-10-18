// Windows Home acceptance with fictional files, actual NTFS/DPAPI/watchdog and
// Explorer. Never touches the installed Connector, WhatsApp or a TTS provider.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { TemporaryAttachments } from "../mediweb-downloader/src/temporaryAttachments.js";
import { createManagedFileService } from "../mediweb-downloader/src/managedFiles.js";
import { createEncryptedOutput } from "../mediweb-downloader/src/encryptedOutput.js";
import { restrictFile, verifyPrivateDirectory, powershell } from "../mediweb-downloader/src/windowsProtection.js";
import { pdfBytes } from "../mediweb-downloader/test-support/deliveryFixture.js";

async function until(action, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await action()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw Error("No se verificó la limpieza dentro del plazo de prueba.");
}
async function create(directory, ttl = 15 * 60 * 1000) {
  const vault = path.join(directory, "vault"), downloads = path.join(directory, "downloads"), root = path.join(downloads, "run");
  const store = await new EvaluationStore({ directory: vault }).initialize(), getStore = async () => store;
  await mkdir(root, { recursive: true });
  const output = createEncryptedOutput({ downloadsDir: downloads, getStore }); await output.protectOutput({ root });
  const temporary = new TemporaryAttachments({ directory: path.join(directory, "temporary"), getStore, ttl }); await temporary.initialize();
  const files = createManagedFileService({ downloadsDir: downloads, temporaryAttachments: temporary, ensureProtectedFile: restrictFile, readProtectedOutput: output.read });
  return { files, temporary, output, root, store };
}
if (process.argv[2] === "--crash-child") {
  process.once("message", async ({ directory }) => {
    try {
      const f = await create(directory), audio = await f.files.saveMp3(Buffer.from("ID3FICTICIO_INTERRUPCION"));
      await f.files.revealPinned(audio.id, audio.sha256, ".mp3");
      process.send({ ready: true });
    } catch { process.send({ ready: false }); process.exit(1); }
  });
} else {
  assert.equal(process.platform, "win32");
  const edition = await powershell("[Console]::Out.Write((Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID)", "");
  assert.equal(edition, "CoreSingleLanguage", "Esta aceptación específica requiere Windows Home Single Language real.");
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const directory = await mkdtemp(path.join(base, "AudioEvaluaciones-Home-FICTICIO-"));
  const results = []; let child, temporary;
  try {
    const f = await create(directory); temporary = f.temporary;
    const bytes = await pdfBytes(1), pdfPath = path.join(f.root, "ficticio.pdf");
    await f.output.write(pdfPath, bytes);
    assert.equal((await readFile(pdfPath)).includes(Buffer.from("%PDF-")), false);
    const pdf = await f.files.inspectFile("run/ficticio.pdf", ".pdf"); assert.deepEqual(pdf.bytes, bytes);
    const audio = await f.files.saveMp3(Buffer.from("ID3FICTICIO_HOME_NO_PACIENTE"));
    assert.deepEqual(await readdir(path.join(directory, "temporary")), []);
    await f.files.revealPinned(pdf.id, pdf.sha256, ".pdf");
    await f.files.revealPinned(audio.id, audio.sha256, ".mp3");
    for (const name of await readdir(path.join(directory, "temporary"))) await verifyPrivateDirectory(path.join(directory, "temporary", name));
    results.push({ check: "Home real, AES-GCM/DPAPI, PDF cifrado, MP3 cifrado y dos lanzamientos reales de Explorer", status: "APROBADO", visual: "PENDIENTE si el controlador de escritorio no permite observar la selección" });
    // Brief inspection window; tools remain responsive while this process runs.
    await new Promise(resolve => setTimeout(resolve, process.argv.includes("--inspect-explorer") ? 45000 : 1000));
    await f.temporary.release(); assert.deepEqual(await readdir(path.join(directory, "temporary")), []);
    const restart = await create(directory); assert.equal((await restart.files.inspectFile(audio.id)).sha256, audio.sha256);
    await restart.temporary.release();
    results.push({ check: "Cierre explícito limpia las dos copias y reinicialización recupera el MP3 cifrado", status: "APROBADO" });
    const crashDirectory = path.join(directory, "crash"); await mkdir(crashDirectory);
    child = fork(fileURLToPath(import.meta.url), ["--crash-child"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("El proceso de prueba no quedó listo.")), 30000);
      child.once("message", message => { clearTimeout(timeout); message.ready ? resolve() : reject(Error("Falló el proceso de prueba.")); });
      child.once("error", reject); child.send({ directory: crashDirectory });
    });
    const closed = new Promise(resolve => child.once("exit", resolve)); child.kill(); await closed;
    await until(async () => !(await readdir(path.join(crashDirectory, "temporary"))).length);
    results.push({ check: "Muerte real del proceso: vigilante independiente retira el adjunto abandonado", status: "APROBADO" });
    const expiring = await create(path.join(directory, "expiry"), 30000);
    const shortAudio = await expiring.files.saveMp3(Buffer.from("ID3FICTICIO_CADUCIDAD"));
    await expiring.files.revealPinned(shortAudio.id, shortAudio.sha256, ".mp3");
    await until(async () => !(await readdir(path.join(directory, "expiry", "temporary"))).length, 35000);
    results.push({ check: "Caducidad real vigilada, Connector aún vivo", status: "APROBADO" });
    console.log(JSON.stringify({ edition, results, realTtsCalls: 0, realMessages: 0, remainingTemporaryFiles: 0 }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ result: "FALLIDO", stage: error.stage, code: error.code, cause: error.cause?.code || error.cause?.name }));
    process.exitCode = 1;
  } finally {
    child?.kill(); await temporary?.release();
    // Only this newly-created, separately named fictional test root is removed.
    if (path.dirname(directory) !== path.resolve(base) || !path.basename(directory).startsWith("AudioEvaluaciones-Home-FICTICIO-")) { console.error("Raíz de prueba inesperada: no se elimina."); process.exitCode = 1; }
    else await rm(directory, { recursive: true, force: true });
  }
}
