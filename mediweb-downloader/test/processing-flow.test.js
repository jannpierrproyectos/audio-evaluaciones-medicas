import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { EvaluationStore } from "../src/evaluationStore.js";
import { ProcessingFlow } from "../src/processingFlow.js";
import { JobManager } from "../src/http/jobManager.js";
import { inspectSearch, applySearchProfile, verifySearchRows } from "../src/searchProfile.js";

const url = "https://resultados.innomedic.pe/atenciones/ocupacional";
const html = `<form method="get" action="/atenciones/ocupacional"><label for="empresa">Empresa</label><select id="empresa" name="empresa"><option value="f">Ficticia</option></select><button>Buscar</button></form>
<table><tr><th>Código</th><th>Fecha</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr><tr><td>F1</td><td>17/10/2026</td><td>Ficticia</td><td>PERSONA FICTICIA</td><td>DNI</td><td>APTO</td><td><a href="/imprimirtodos.php?idcomprobante=1&idpaciente=1">Reporte</a></td></tr></table>`;
const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
async function fixture(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-processing-test-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); let body = html;
    await page.route("https://resultados.innomedic.pe/**", route => route.fulfill({ contentType: "text/html", body }));
    await page.goto(url);
    let store = await new EvaluationStore({ directory, protection }).initialize(), runs = 0;
    const engine = { mainPage: page, browserOpen: true, open: async () => {}, resetCancellation() {}, cancel() {},
      run: async (options, hooks) => {
        runs++; assert.equal(options.mode, "both");
        const paths = { consolidated: path.join(directory, "ficticio.pdf"), root: directory };
        await hooks.beforeOutput?.(paths); await writeFile(paths.consolidated, "%PDF-ficticio");
        const manifest = { atenciones: [{ estado: "correcto", numeroDocumento: "00000001", paginaConsolidado: 1, archivoPdfCompleto: "ficticio.pdf" }], totalDetectado: 2, totalProcesado: 1, primerasHojasAgregadas: 1, reportesCompletosGenerados: 1, errores: 1 };
        engine.paths = paths; engine.manifest = manifest;
        hooks.onProgress({ manifest, currentPage: 1 });
        return { status: "failed", paths, manifest };
      } };
    let manager = new JobManager({ engine });
    const getStore = async () => store;
    const makeFlow = () => new ProcessingFlow({ engine, jobManager: manager, getStore, protectOutput: async () => {} });
    const flow = makeFlow();
    await callback({ directory, page, engine, manager, flow, get runs() { return runs; }, get store() { return store; },
      setBody: value => { body = value; }, html,
      restart: async () => { store = await new EvaluationStore({ directory, protection }).initialize(); manager = new JobManager({ engine }); return { flow: makeFlow(), manager }; },
    });
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
}

test("Fase04: sesión expirada, interfaz desconocida y filtros no coincidentes no descargan", async () => fixture(async f => {
  assert.equal((await inspectSearch(f.page)).authentication, "results_visible");
  await f.page.setContent('<form><input type="password"><button>Ingresar</button></form>');
  await assert.rejects(f.flow.start({ manualConfirmed: true }), error => error.code === "SESSION_EXPIRED"); assert.equal(f.runs, 0);
  await f.page.setContent(f.html.replace('for="empresa"', 'for="desconocido"'));
  await assert.rejects(f.flow.confirmSearch(), error => error.code === "SEARCH_MANUAL_REQUIRED");
  assert.equal(f.runs, 0);
  await assert.rejects(f.flow.saveProfile("No reconocida"), error => error.code === "SEARCH_MANUAL_REQUIRED");
  await f.page.setContent(f.html.replace("<td>Ficticia</td>", "<td>Otra</td>"));
  await assert.rejects(f.flow.start({ manualConfirmed: true }), error => error.code === "SEARCH_RESULTS_MISMATCH"); assert.equal(f.runs, 0);
}));

test("Fase04: búsqueda confirmada guardada/reaplicada; cambios de interfaz y origen se bloquean", async () => fixture(async f => {
  const profileId = await f.flow.saveProfile("Ficticia confirmada", (await f.flow.confirmSearch()).token);
  const profile = (await f.store.processingState()).profiles.find(value => value.id === profileId.id);
  const applied = await applySearchProfile(f.page, profile); assert.equal(applied.ready, true);
  await f.page.setContent(f.html.replace('id="empresa"', 'id="otra"').replace('for="empresa"', 'for="otra"'));
  await assert.rejects(applySearchProfile(f.page, profile), error => error.code === "SEARCH_INTERFACE_CHANGED");
  await f.page.route("https://externo.invalid/**", route => route.fulfill({ body: f.html })); await f.page.goto("https://externo.invalid");
  await assert.rejects(inspectSearch(f.page), error => error.code === "SEARCH_ORIGIN_CHANGED");
}));

test("Fase04: clics repetidos, parcial y reinicio recuperan resultados cifrados sin redescargar", async () => fixture(async f => {
  const options = { manualConfirmed: true, manualToken: (await f.flow.confirmSearch()).token };
  const starts = await Promise.all([f.flow.start(options), f.flow.start(options)]);
  assert.equal(starts[0].id, starts[1].id); await f.manager.get(starts[0].id).completion; assert.equal(f.runs, 1);
  const restarted = await f.restart(); const status = await restarted.flow.status();
  assert.equal(status.runs[0].status, "failed"); assert.equal(status.runs[0].job.firstPagesAdded, 1);
  assert.equal(restarted.manager.workerMetadata(starts[0].id).workers.length, 1);
  assert.equal(await restarted.manager.firstPagesPath(starts[0].id), path.join(f.directory, "ficticio.pdf"));
  assert.equal((await restarted.flow.start(options)).reused, true); assert.equal(f.runs, 1);
  for (const file of (await readdir(f.directory)).filter(name => name.endsWith(".enc") || name.endsWith(".bak"))) {
    assert.equal((await readFile(path.join(f.directory, file))).includes(Buffer.from("PERSONA FICTICIA")), false);
  }
}));

test("Fase04: reserva interrumpida queda incierta y no permite otra descarga", async () => fixture(async f => {
  await f.store.processingState(state => { state.runs.push({ id: crypto.randomUUID(), status: "running", checkpoint: null }); });
  const restarted = await f.restart(); assert.equal((await restarted.flow.status()).runs[0].status, "uncertain");
  await assert.rejects(restarted.flow.start({ manualConfirmed: true }), error => error.code === "PROCESS_UNCERTAIN"); assert.equal(f.runs, 0);
}));

test("Fase04: fallo de protección de archivos bloquea la descarga", async () => fixture(async f => {
  const flow = new ProcessingFlow({ engine: f.engine, jobManager: f.manager, getStore: async () => f.store, protectOutput: async () => { throw Object.assign(new Error("EFS unavailable"), { code: "OUTPUT_PROTECTION_UNAVAILABLE" }); } });
  const start = await flow.start({ manualConfirmed: true, manualToken: (await flow.confirmSearch()).token }); await f.manager.get(start.id).completion;
  const state = await flow.status(); assert.equal(state.runs[0].status, "failed"); assert.equal(state.runs[0].job.errorCode, "OUTPUT_PROTECTION_UNAVAILABLE");
  assert.equal(state.runs[0].job.firstPagesAdded, 0);
}));

test("Fase04: fechas y empresa de cada página deben coincidir con filtros, incluso tras paginar", () => {
  const extraction = { atenciones: [{ fecha: "17/10/2026", empresa: "Ficticia" }] };
  assert.doesNotThrow(() => verifySearchRows(extraction, [{ kind: "desde", value: "2026-10-17" }]));
  assert.throws(() => verifySearchRows(extraction, [{ kind: "hasta", value: "2026-10-16" }]), error => error.code === "SEARCH_RESULTS_MISMATCH");
  assert.throws(() => verifySearchRows({ atenciones: [] }), error => error.code === "SEARCH_NO_RESULTS");
});

test("Fase04: una confirmación manual no autoriza una tabla cambiada ni un perfil distinto", async () => fixture(async f => {
  const token = (await f.flow.confirmSearch()).token;
  await f.page.setContent(f.html.replace("idcomprobante=1", "idcomprobante=2"));
  await assert.rejects(f.flow.start({ manualConfirmed: true, manualToken: token }), error => error.code === "SEARCH_CONFIRMATION_CHANGED");
  await assert.rejects(f.flow.saveProfile("Cambió", token), error => error.code === "SEARCH_CONFIRMATION_CHANGED"); assert.equal(f.runs, 0);
}));

test("Fase04: cancelación conserva resultados parciales cifrados y no los vuelve a descargar", async () => fixture(async f => {
  let entered, release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = f.engine.run;
  f.engine.run = async (...args) => { const result = await original(...args); entered(); await gate; return result; };
  f.engine.cancel = () => release();
  const start = await f.flow.start({ manualConfirmed: true, manualToken: (await f.flow.confirmSearch()).token });
  await enteredPromise;
  assert.equal((await f.manager.cancel(start.id)).status, "cancelled");
  const state = await f.flow.status(); assert.equal(state.runs[0].job.firstPagesAdded, 1);
  assert.equal(f.manager.workerMetadata(start.id).workers.length, 1); assert.equal(f.runs, 1);
}));

test("Fase04: cambio de paciente con el mismo identificador y búsqueda solapada no autorizan redescarga", async () => fixture(async f => {
  const token = (await f.flow.confirmSearch()).token;
  await f.page.setContent(f.html.replace("PERSONA FICTICIA", "OTRA PERSONA"));
  await assert.rejects(f.flow.start({ manualConfirmed: true, manualToken: token }), error => error.code === "SEARCH_CONFIRMATION_CHANGED");
  await f.page.setContent(f.html);
  const created = await f.flow.start({ manualConfirmed: true, manualToken: (await f.flow.confirmSearch()).token });
  await f.manager.get(created.id).completion;
  await f.page.setContent(f.html.replace("PERSONA FICTICIA", "OTRA PERSONA"));
  await assert.rejects(f.flow.start({ manualConfirmed: true, manualToken: (await f.flow.confirmSearch()).token }), error => error.code === "PROCESS_ALREADY_DOWNLOADED");
  assert.equal(f.runs, 1);
}));

test("Fase04: fallo de checkpoint se convierte en incierto al volver el almacenamiento, sin reintento", async () => fixture(async f => {
  const original = f.store.processingState.bind(f.store), run = f.engine.run;
  let failCheckpoint = false;
  f.store.processingState = async change => { if (change && failCheckpoint) { failCheckpoint = false; throw new Error("Disco temporalmente indisponible"); } return original(change); };
  f.engine.run = async (...args) => { failCheckpoint = true; return run(...args); };
  const created = await f.flow.start({ manualConfirmed: true, manualToken: (await f.flow.confirmSearch()).token });
  await f.manager.get(created.id).completion;
  assert.equal(f.manager.hasActiveJob, false);
  assert.equal((await f.flow.status()).runs[0].status, "uncertain");
  await assert.rejects(f.flow.start({ manualConfirmed: true }), error => error.code === "PROCESS_UNCERTAIN");
  assert.equal(f.runs, 1);
}));
