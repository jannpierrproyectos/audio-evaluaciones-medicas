import { randomUUID, createHash } from "node:crypto";
import { inspectSearch, applySearchProfile, verifySearchRows, flowError } from "./searchProfile.js";
import { protectExportDirectory } from "./windowsProtection.js";
import { createAttentionKey } from "./mediwebTable.js";

const terminal = new Set(["completed", "failed", "cancelled", "uncertain"]);
export class ProcessingFlow {
  constructor({ engine, jobManager, getStore, protectOutput = async paths => {
    if (engine.protectOutput) return engine.protectOutput(paths);
    try { for (const directory of [paths.root, paths.control, paths.tmp, paths.full, paths.audio].filter(Boolean)) await protectExportDirectory(directory); }
    catch { throw flowError("OUTPUT_PROTECTION_UNAVAILABLE"); }
  } }) {
    Object.assign(this, { engine, jobManager, getStore, protectOutput });
    this.tail = Promise.resolve(); this.initialized = false;
  }
  exclusive(action) {
    const promise = this.tail.then(action, action); this.tail = promise.catch(() => {}); return promise;
  }
  async initialize() {
    if (this.initialized) return;
    const store = await this.getStore();
    await store.processingState(state => {
      for (const run of state.runs) {
        if (run.status === "running" && !this.jobManager.jobs.has(run.id)) run.status = "uncertain";
        if (run.checkpoint && !this.jobManager.jobs.has(run.id)) {
          this.jobManager.jobs.set(run.id, { ...run.checkpoint, id: run.id, status: run.status, controller: new AbortController(), completion: Promise.resolve() });
        }
      }
      return null;
    });
    this.initialized = true;
  }
  async status() {
    await this.initialize();
    const store = await this.getStore();
    let state = await store.processingState();
    const uncertain = state.runs.filter(run => run.status === "running" && this.jobManager.jobs.get(run.id)?.status === "uncertain");
    if (uncertain.length) {
      // A transient checkpoint failure must not leave a finished job looking
      // permanently running once encrypted storage becomes available again.
      await store.processingState(value => {
        for (const run of value.runs) if (uncertain.some(item => item.id === run.id)) run.status = "uncertain";
        return null;
      });
      state = await store.processingState();
    }
    let authentication = "unknown";
    if (!this.jobManager.hasActiveJob && this.engine.browserOpen) {
      try { authentication = (await inspectSearch(this.engine.mainPage)).authentication; } catch { /* Do not infer authentication. */ }
    }
    return { authentication, profiles: state.profiles.map(profile => ({ id: profile.id, name: profile.name, confirmed_at: profile.confirmed_at })),
      runs: state.runs.map(run => ({ id: run.id, status: run.status, batch_id: run.batch_id, batch_ids: run.batch_ids || [], job: run.checkpoint ? this.jobManager.publicJob({ ...run.checkpoint, status: run.status }) : null })) };
  }
  async saveProfile(name, manualToken) {
    if (this.jobManager.hasActiveJob) throw flowError("PROCESS_BUSY");
    const inspection = await inspectSearch(this.engine.mainPage);
    if (!inspection.form || !inspection.ready) throw flowError("SEARCH_MANUAL_REQUIRED");
    const signature = verifySearchRows(inspection.extraction, inspection.form.controls);
    const confirmation = (await (await this.getStore()).processingState()).confirmation;
    if (!confirmation || manualToken !== confirmation.token || signature !== confirmation.signature || inspection.structure !== confirmation.structure || JSON.stringify(inspection.form.controls) !== JSON.stringify(confirmation.controls)) throw flowError("SEARCH_CONFIRMATION_CHANGED");
    const profile = { id: randomUUID(), name: String(name || "Búsqueda confirmada").trim().slice(0, 80), form: inspection.form,
      structure: inspection.structure, confirmed_at: new Date().toISOString() };
    await (await this.getStore()).processingState(state => { state.profiles.push(profile); return null; });
    return { id: profile.id };
  }

  async confirmSearch() {
    if (this.jobManager.hasActiveJob) throw flowError("PROCESS_BUSY");
    const inspection = await inspectSearch(this.engine.mainPage);
    if (inspection.authentication === "expired") throw flowError("SESSION_EXPIRED");
    const signature = verifySearchRows(inspection.extraction, inspection.form?.controls || []);
    const token = randomUUID();
    await (await this.getStore()).processingState(state => { state.confirmation = { token, signature, structure: inspection.structure,
      controls: inspection.form?.controls || [], confirmed_at: new Date().toISOString() }; return null; });
    return { token };
  }
  start({ profileId = null, manualConfirmed = false, manualToken = null } = {}) {
    return this.exclusive(async () => {
      await this.initialize();
      const store = await this.getStore();
      const state = await store.processingState();
      const active = state.runs.find(run => run.status === "running");
      if (active) return { id: active.id, reused: true };
      if (state.runs.some(run => run.status === "uncertain")) throw flowError("PROCESS_UNCERTAIN");
      if (this.jobManager.hasActiveJob) throw flowError("PROCESS_BUSY");
      await this.engine.open();
      let inspection;
      if (profileId) {
        const profile = state.profiles.find(item => item.id === profileId);
        if (!profile) throw flowError("SEARCH_PROFILE_MISSING");
        inspection = await applySearchProfile(this.engine.mainPage, profile);
      } else {
        inspection = await inspectSearch(this.engine.mainPage);
        if (inspection.authentication === "expired") throw flowError("SESSION_EXPIRED");
        if (!manualConfirmed) throw flowError("SEARCH_MANUAL_REQUIRED");
      }
      if (!inspection.ready) throw flowError("SEARCH_MANUAL_REQUIRED");
      const controls = inspection.form?.controls || [];
      const signature = verifySearchRows(inspection.extraction, controls);
      if (!profileId && (manualToken !== state.confirmation?.token || signature !== state.confirmation?.signature ||
        inspection.structure !== state.confirmation?.structure || JSON.stringify(controls) !== JSON.stringify(state.confirmation?.controls))) throw flowError("SEARCH_CONFIRMATION_CHANGED");
      const key = createHash("sha256").update(JSON.stringify({ signature, controls, mode: "both" })).digest("hex");
      const previous = state.runs.find(run => run.key === key);
      if (previous) return { id: previous.id, reused: true };
      const historical = new Set(state.runs.flatMap(run => [ ...(run.attention_keys || []),
        ...(run.checkpoint?.result?.manifest?.atenciones || []).filter(entry => entry.estado === "correcto").map(createAttentionKey) ]));
      const ensureNotPreviouslyDownloaded = extraction => {
        if (extraction.atenciones.some(row => historical.has(createAttentionKey(row)))) throw flowError("PROCESS_ALREADY_DOWNLOADED");
      };
      ensureNotPreviouslyDownloaded(inspection.extraction);
      const id = randomUUID();
      // Reserve before launching; even a lost POST response cannot create a duplicate.
      await store.processingState(value => { value.runs.push({ id, key, attention_keys: inspection.extraction.atenciones.map(createAttentionKey), status: "running", created_at: new Date().toISOString(), checkpoint: null }); return null; });
      try {
        this.jobManager.create({ mode: "both", limit: null, maxPages: null, perPageLimit: null, singlePage: false, delay: 900 }, {
          id,
          beforeRun: async () => {
            const current = await inspectSearch(this.engine.mainPage);
            if (current.authentication === "expired") throw flowError("SESSION_EXPIRED");
            if (verifySearchRows(current.extraction, controls) !== signature) throw flowError("SEARCH_RESULTS_CHANGED");
          },
          beforeOutput: this.protectOutput,
          validateExtraction: extraction => { verifySearchRows(extraction, controls); ensureNotPreviouslyDownloaded(extraction); },
          checkpoint: async checkpoint => store.processingState(value => {
            const run = value.runs.find(item => item.id === id);
            run.checkpoint = checkpoint; run.status = checkpoint.status; return null;
          }),
        });
      } catch (error) {
        await store.processingState(value => { value.runs.find(run => run.id === id).status = "uncertain"; return null; }); throw error;
      }
      return { id, reused: false };
    });
  }
  async complete(id, batchId) {
    const store = await this.getStore();
    const batch = await store.load(batchId);
    if (!batch.snapshot.processing_run_ids?.includes(id)) throw flowError("PROCESS_BATCH_MISMATCH");
    await store.processingState(state => {
      const run = state.runs.find(value => value.id === id);
      if (!run || !terminal.has(run.status)) throw flowError("PROCESS_NOT_FINISHED");
      run.batch_id = batchId; run.batch_ids = batch.snapshot.processing_related_batch_ids || [batchId]; return null;
    });
    return { ok: true };
  }
}
