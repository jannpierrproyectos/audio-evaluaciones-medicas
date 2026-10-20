// Real Connector pipeline and Windows protection, isolated disposable data.
// Only upstream MediWeb pages and paid TTS are substituted with fictitious data.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { DownloaderRunner } from "../mediweb-downloader/src/runner.js";
import { JobManager } from "../mediweb-downloader/src/http/jobManager.js";
import { ProcessingFlow } from "../mediweb-downloader/src/processingFlow.js";
import { createApp } from "../mediweb-downloader/src/http/app.js";
import { createManagedFileService } from "../mediweb-downloader/src/managedFiles.js";
import { createEncryptedOutput } from "../mediweb-downloader/src/encryptedOutput.js";
import { TemporaryAttachments } from "../mediweb-downloader/src/temporaryAttachments.js";
import { restrictFile } from "../mediweb-downloader/src/windowsProtection.js";

export const configuration = { provider: "simulado", model: "prueba", voice_ref: "ficticia", settings: {}, language: "es", format: "mp3", contract: 1 };
const upstream = "https://resultados.innomedic.pe";
const headers = "<tr><th>Código</th><th>Fecha</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr>";
const row = id => `<tr><td>F${id}</td><td>17/10/2026</td><td>Ficticia</td><td>PERSONA FICTICIA ${id}</td><td>DNI</td><td>APTO</td><td><a href="${upstream}/imprimirtodos.php?idcomprobante=${id}&idpaciente=${id}">Reporte</a></td></tr>`;
const search = `<form method="get" action="/atenciones/ocupacional"><label for="empresa">Empresa</label><select id="empresa" name="empresa"><option value="f">Ficticia</option></select><button>Buscar</button></form><table>${headers}${Array.from({ length: 8 }, (_, index) => row(index + 1)).join("")}</table>`;
const report = id => `<html><head><style>body{font-family:Arial;font-size:12px}p{margin:16px 0}</style></head><body>${[
  "RESULTADO DE EVALUACION MEDICA", "DATOS DEL TRABAJADOR", `Apellidos y Nombres: FICTICIA PERSONA${id}`,
  `DNI: 0000000${id} Edad: 30 Sexo: F`, "Empresa: FICTICIA Area: PRUEBA", "FECHA DE EVALUACION: 17/10/2026",
  `TELEFONO: 99911111${id}`, "RESUMEN DE RESULTADOS", "PRUEBAS DE LABORATORIO", "APTITUD", "X APTO -", "RECOMENDACIONES", "CONTROL",
].map(line => `<p>${line}</p>`).join("")}</body></html>`;

export async function startControlledPreview(port = 4180, { manualResultsOnly = false, resultsInNewTab = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-ux-correction-"));
  let browser, vite, temporary, connector;
  const stats = { reportRequests: 0, ttsRequests: 0, actualExternalRequests: 0, reveals: 0, loadRequests: 0, chatOpens: 0 };
  let failLoad = false, fileMode = "primary";
  const stop = async () => {
    await vite?.close();
    if (connector) await new Promise(resolve => connector.close(resolve));
    await browser?.close(); await temporary?.release();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("ae-ux-correction-")) throw new Error("Unexpected fixture cleanup target");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const mediweb = await browser.newContext();
    await mediweb.route("**/*", async route => {
      if (!route.request().url().startsWith(upstream)) { stats.actualExternalRequests++; return route.abort(); }
      if (route.request().url().includes("imprimirtodos.php")) {
        stats.reportRequests++;
        return route.fulfill({ contentType: "text/html", body: report(new URL(route.request().url()).searchParams.get("idcomprobante")) });
      }
      return route.fulfill({ contentType: "text/html", body: manualResultsOnly ? search.replace(/<form[\s\S]*?<\/form>/, "") : search });
    });
    const mainPage = await mediweb.newPage(); await mainPage.goto(`${upstream}/atenciones/ocupacional`);
    if (resultsInNewTab) {
      await mainPage.setContent("<h1>Menú ficticio de MediWeb</h1>");
      const resultsPage = await mediweb.newPage();
      await resultsPage.goto(`${upstream}/atenciones/ocupacional`);
    }
    const store = await new EvaluationStore({ directory: path.join(directory, "vault") }).initialize();
    // Failure injection changes only an in-memory test switch, never ciphertext.
    const controlledStore = new Proxy(store, { get(target, key) {
      if (key === "load") return async id => { stats.loadRequests++; if (failLoad) throw Object.assign(new Error("Controlled storage busy"), { code: "STORE_BUSY", status: 409 }); return target.load(id); };
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } });
    const getStore = async () => controlledStore;
    const downloadsDir = path.join(directory, "downloads");
    const engine = new DownloaderRunner({ runtimePaths: { packaged: false, downloadsDir }, logger: { log() {}, warn() {} } });
    engine.context = mediweb; engine.mainPage = mainPage;
    const output = createEncryptedOutput({ downloadsDir, getStore });
    engine.writeOutput = output.write; engine.readOutput = output.read; engine.protectOutput = output.protectOutput;
    temporary = new TemporaryAttachments({ directory: path.join(directory, "attachments"), getStore });
    await temporary.initialize();
    const manager = new JobManager({ engine });
    const processing = new ProcessingFlow({ engine, jobManager: manager, getStore });
    const url = `http://127.0.0.1:${port}`;
    const files = createManagedFileService({ downloadsDir, ensureProtectedFile: restrictFile,
      temporaryAttachments: temporary, readProtectedOutput: output.read, revealFile: async () => { stats.reveals++; } });
    const missingFiles = createManagedFileService({ downloadsDir: path.join(directory, "empty-downloads"), ensureProtectedFile: restrictFile, temporaryAttachments: temporary });
    const fallbackFiles = createManagedFileService({ downloadsDir: path.join(directory, "empty-downloads"), ensureProtectedFile: restrictFile,
      readFallbacks: [{ downloadsDir, readProtectedOutput: output.read }], temporaryAttachments: temporary, revealFile: async () => { stats.reveals++; } });
    const controlledFiles = new Proxy(files, { get(target, key) {
      return (...args) => (fileMode === "missing" ? missingFiles : fileMode === "fallback" ? fallbackFiles : target)[key](...args);
    } });
    const app = createApp({ engine, jobManager: manager, processingService: processing, getEvaluationStore: getStore,
      managedFiles: controlledFiles, version: "0.6.0-rc.2", allowedOrigins: new Set([url]) });
    connector = createHttpServer(app);
    await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
    const connectorUrl = `http://127.0.0.1:${connector.address().port}`;
    vite = await createServer({ configFile: false, envFile: false,
      define: { "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(connectorUrl) },
      plugins: [react(), { name: "controlled-connector-preview",
        transform(source, id) {
          if (id.replaceAll("\\", "/").endsWith("/src/lib/whatsappReview.js")) return source.replace('`https://wa.me/${phone}`', '`/__fixture/chat?phone=${phone}`');
        },
        transformIndexHtml(html) {
          return html.replace('<div id="root">', `<aside style="padding:8px;background:#fff0c2;text-align:center;font:13px Segoe UI">PRUEBA AISLADA · 8 personas ficticias · Connector real, sin MediWeb ni voz externos <button onclick="fetch('/__fixture/failure',{method:'POST',body:'on'}).then(()=>location.reload())">Simular fallo de apertura</button> <button onclick="fetch('/__fixture/failure',{method:'POST',body:'off'}).then(()=>location.reload())">Restablecer apertura</button></aside><div id="root">`);
        },
        configureServer(server) {
          server.middlewares.use("/__fixture/failure", async (req, res) => {
            let body = ""; for await (const chunk of req) body += chunk;
            failLoad = body === "on"; res.end("ok");
          });
          server.middlewares.use("/__fixture/chat", (_req, res) => { stats.chatOpens++; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end("<h1>Conversación ficticia. No se abrió WhatsApp.</h1>"); });
          server.middlewares.use("/api/tts", async (req, res) => {
            res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
            if (req.url === "/session") return res.end(JSON.stringify({ authenticated: true, configured: true }));
            if (req.url === "/configuration") return res.end(JSON.stringify(configuration));
            if (req.url === "/synthesize" && req.method === "POST") {
              for await (const chunk of req) { void chunk; }
              stats.ttsRequests++; await new Promise(resolve => setTimeout(resolve, 1800));
              res.setHeader("Content-Type", "audio/mpeg"); res.setHeader("X-TTS-Configuration", encodeURIComponent(JSON.stringify(configuration)));
              return res.end(Buffer.from("ID3CONTROLLED-SYNTHETIC-AUDIO"));
            }
            res.statusCode = 404; res.end("{}");
          });
        },
      }], server: { host: "127.0.0.1", port, strictPort: true, watch: { ignored: ["**/mediweb-downloader/.auth/**", "**/mediweb-downloader/downloads/**", "**/mediweb-downloader/build-windows/**", "**/artifacts/**", "**/docs/**"] } } });
    await vite.listen();
    return { url, connectorUrl, directory, store, processing, manager, files, browser, stats, setFileMode: value => { fileMode = value; }, setLoadFailure: value => { failLoad = value; }, stop };
  } catch (error) { await stop(); throw error; }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/controlled-processing-preview.mjs")) {
  const preview = await startControlledPreview();
  console.log(`Prueba aislada de ocho evaluaciones: ${preview.url}`);
  process.once("SIGINT", async () => { await preview.stop(); process.exit(0); });
  process.once("SIGTERM", async () => { await preview.stop(); process.exit(0); });
}
