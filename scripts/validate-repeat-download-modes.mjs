import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { startControlledPreview } from "./controlled-processing-preview.mjs";

// Actual Connector, Chromium report printing and Windows ACLs in disposable data.
// Upstream MediWeb and TTS are entirely fictitious; never uses the installed port.
const preview = await startControlledPreview(4196, { manualResultsOnly: true, resultsInNewTab: true });
const headers = { Origin: preview.url, "Content-Type": "application/json" };
const results = [];
const heartbeat = setInterval(() => console.log(`Validated mode downloads: ${results.length}/6`), 20000);
try {
  for (const mode of ["first", "full", "both"]) {
    for (let repeat = 1; repeat <= 2; repeat++) {
      const created = await fetch(`${preview.connectorUrl}/jobs`, { method: "POST", headers, body: JSON.stringify({ mode, limit: 1, singlePage: true }) });
      assert.equal(created.status, 202);
      const { jobId } = await created.json();
      const job = preview.manager.get(jobId);
      await job.completion;
      assert.equal(job.status, "completed", `${mode}/${repeat}: ${job.errorCode}`);
      assert.equal(job.processed, 1);
      assert.equal(job.fullReportsGenerated, mode === "first" ? 0 : 1);
      assert.equal(job.firstPagesAdded, mode === "full" ? 0 : 1);
      if (mode !== "full") assert.equal((await readFile(job.result.paths.consolidated)).subarray(0, 5).toString(), "%PDF-");
      results.push({ mode, repeat, status: job.status, processed: job.processed, full: job.fullReportsGenerated, first: job.firstPagesAdded });
      console.log(JSON.stringify(results.at(-1)));
    }
  }
  assert.equal(preview.stats.reportRequests, 6);
  assert.equal(preview.stats.ttsRequests, 0);
  assert.equal(preview.stats.actualExternalRequests, 0);
  assert.equal(new Set([...preview.manager.jobs.values()].map(job => job.result.paths.root)).size, 6);
  await mkdir("artifacts/repeat-download-modes", { recursive: true });
  await writeFile("artifacts/repeat-download-modes/results.json", JSON.stringify({ passed: true, results, ...preview.stats }, null, 2));
  console.log("PASS: all three modes can be intentionally repeated; no paid or external requests.");
} finally { clearInterval(heartbeat); await preview.stop(); }
