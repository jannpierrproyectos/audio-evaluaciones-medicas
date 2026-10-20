import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, lstat, unlink, rmdir, realpath } from "node:fs/promises";
import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { restrictDirectory, verifyPrivateDirectory } from "./windowsProtection.js";
import { isDeliveryAttachmentName } from "./fileNames.js";

export const ATTACHMENT_TTL_MS = 15 * 60 * 1000;
const uuid = /^[a-f0-9-]{36}$/i;
const reference = /^attachments\/([a-f0-9]{64})\.mp3$/;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = () => Object.assign(new Error("No se pudo proteger o limpiar los adjuntos temporales. Cierra los archivos abiertos y vuelve a iniciar el Connector."), { code: "ATTACHMENT_PROTECTION_UNAVAILABLE", status: 503 });

// Never recursively follow/delete an arbitrary tree. Only our exact session
// layout is removable; unknown entries or reparse points fail closed.
export async function removeAttachmentSession(directory) {
  const info = await lstat(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (!info) return;
  if (!uuid.test(path.basename(directory)) || !info.isDirectory() || info.isSymbolicLink() || path.relative(await realpath(directory), path.resolve(directory))) throw fail();
  const entries = await readdir(directory);
  const lease = JSON.parse(await readFile(path.join(directory, "lease.json"), "utf8").catch(error => { if (error.code === "ENOENT") return "{}"; throw error; }));
  const namedAttachment = isDeliveryAttachmentName(lease.file_name) ? lease.file_name : null;
  for (const name of entries) {
    if (!["lease.json", "adjunto.pdf", "adjunto.mp3"].includes(name) && name !== namedAttachment) throw fail();
    const entry = await lstat(path.join(directory, name));
    if (!entry.isFile() || entry.isSymbolicLink()) throw fail();
  }
  for (const name of entries) await unlink(path.join(directory, name));
  await rmdir(directory);
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

export async function startAttachmentWatchdog(directory) {
  const child = fork(fileURLToPath(import.meta.url), ["--attachment-watchdog"], { detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(fail(), { code: "ATTACHMENT_WATCHDOG_TIMEOUT" })); }, 30000);
    child.once("error", () => { clearTimeout(timer); reject(fail()); });
    child.once("exit", () => { clearTimeout(timer); reject(fail()); });
    child.once("message", message => { clearTimeout(timer); if (message !== "ready") { child.kill(); reject(fail()); } else { child.disconnect(); child.unref(); resolve(); } });
    child.send({ directory });
  });
}

export class TemporaryAttachments {
  constructor({ directory, getStore, protect = restrictDirectory, verify = verifyPrivateDirectory, watchdog = startAttachmentWatchdog, now = Date.now, ttl = ATTACHMENT_TTL_MS }) {
    this.directory = path.resolve(directory); this.getStore = getStore;
    Object.assign(this, { protect, verify, watchdog, now });
    if (!(ttl > 0 && ttl <= ATTACHMENT_TTL_MS)) throw fail();
    this.ttl = ttl; this.sessions = new Map(); this.tail = Promise.resolve();
  }
  initialize() {
    this.initialized ||= this.exclusive(async () => {
      await mkdir(this.directory, { recursive: true });
      if (path.relative(await realpath(this.directory), this.directory)) throw fail();
      await this.protect(this.directory); await this.verify(this.directory);
      for (const name of await readdir(this.directory)) {
        if (!uuid.test(name)) throw fail();
        const directory = path.join(this.directory, name);
        await this.verify(directory);
        const lease = JSON.parse(await readFile(path.join(directory, "lease.json"), "utf8").catch(error => { if (error.code === "ENOENT") return '{"pid":0,"expires":0}'; throw error; }));
        if (alive(lease.pid) && lease.expires > this.now()) throw fail();
        await removeAttachmentSession(directory);
      }
      return this;
    });
    return this.initialized;
  }
  exclusive(action) { const promise = this.tail.then(action, action); this.tail = promise.catch(() => {}); return promise; }
  isReference(id) { return reference.test(String(id)); }
  async storeAudio(bytes) {
    await this.initialize();
    const store = await this.getStore(), digest = hash(bytes), id = `attachments/${digest}.mp3`;
    const directory = path.join(store.directory, "attachments-v1");
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink() || path.relative(await realpath(directory), directory)) throw fail();
    await this.protect(directory); await this.verify(directory);
    const file = path.join(directory, `${digest}.enc`);
    const existing = await lstat(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (existing?.isSymbolicLink()) throw fail();
    let reused = false;
    try { reused = hash(store.unseal(await readFile(file), id)) === digest; }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "STORE_CORRUPT") throw error; }
    if (!reused) await store.atomic(file, store.seal(bytes, id));
    if (hash(store.unseal(await readFile(file), id)) !== digest) throw fail();
    return { id, name: "adjunto.mp3", extension: ".mp3", sha256: digest, reused };
  }
  async readAudio(id) {
    const match = reference.exec(String(id)); if (!match) throw fail();
    const store = await this.getStore(), directory = path.join(store.directory, "attachments-v1");
    await this.verify(directory);
    const file = path.join(directory, `${match[1]}.enc`);
    if ((await lstat(file)).isSymbolicLink()) throw fail();
    const bytes = store.unseal(await readFile(file), id);
    if (hash(bytes) !== match[1]) throw fail();
    return { id, name: "adjunto.mp3", extension: ".mp3", bytes, sha256: match[1] };
  }
  async reveal(file, revealFile) {
    await this.initialize();
    return this.exclusive(async () => {
      await this.verify(this.directory);
      // A cleanup failure blocks new plaintext exports, including an expired
      // file locked by another application.
      for (const session of this.sessions.values()) if (session.expires <= this.now()) await removeAttachmentSession(session.directory);
      for (const [key, session] of this.sessions) if (session.source === file.id) {
        await removeAttachmentSession(session.directory); this.sessions.delete(key);
      }
      const directory = path.join(this.directory, randomUUID());
      await mkdir(directory); await this.protect(directory); await this.verify(directory);
      const expires = this.now() + this.ttl;
      const session = { directory, expires, source: file.id };
      this.sessions.set(directory, session);
      let stage = "watchdog";
      try {
        const filename = isDeliveryAttachmentName(file.attachmentName) && path.extname(file.attachmentName) === file.extension ? file.attachmentName : file.extension === ".pdf" ? "adjunto.pdf" : "adjunto.mp3";
        await writeFile(path.join(directory, "lease.json"), JSON.stringify({ pid: process.pid, expires, file_name: filename }), { flag: "wx" });
        await this.watchdog(directory); // ACK required BEFORE readable content.
        stage = "write";
        const output = path.join(directory, filename);
        await writeFile(output, file.bytes, { flag: "wx" });
        stage = "verify";
        await this.verify(directory);
        if (hash(await readFile(output)) !== file.sha256) throw fail();
        stage = "explorer";
        await revealFile(output);
        return { expires_at: new Date(expires).toISOString() };
      } catch (cause) { await removeAttachmentSession(directory).catch(() => {}); throw Object.assign(fail(), { cause, stage }); }
    });
  }
  async release(ids = null) {
    return this.exclusive(async () => {
      for (const [key, session] of this.sessions) if (!ids || ids.includes(session.source)) {
        await removeAttachmentSession(session.directory); this.sessions.delete(key);
      }
    });
  }
}

if (process.argv[2] === "--attachment-watchdog" && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.once("message", async ({ directory }) => {
    try {
      await verifyPrivateDirectory(directory);
      const lease = JSON.parse(await readFile(path.join(directory, "lease.json"), "utf8"));
      if (!uuid.test(path.basename(directory)) || !Number.isSafeInteger(lease.pid) || lease.expires > Date.now() + ATTACHMENT_TTL_MS || lease.expires <= Date.now()) throw fail();
      process.send("ready");
      const started = performance.now(), lifetime = Math.min(ATTACHMENT_TTL_MS, lease.expires - Date.now());
      const timer = setInterval(async () => {
        if (!await lstat(directory).catch(error => { if (error.code === "ENOENT") return null; return true; })) { clearInterval(timer); process.exit(0); }
        if (alive(lease.pid) && Date.now() < lease.expires && performance.now() - started < lifetime) return;
        try { await removeAttachmentSession(directory); clearInterval(timer); process.exit(0); }
        catch { /* Retry locked files; no patient data or paths in logs. */ }
      }, 1000);
    } catch { process.exit(1); }
  });
}
