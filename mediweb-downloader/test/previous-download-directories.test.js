import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { previousDownloadDirectories } from "../src/paths.js";

test("installed reader derives only exact prior download roots from server checkpoints", () => {
  const root = path.resolve("fixture-downloads");
  const run = directory => ({ checkpoint: { result: { paths: { root: directory } } } });
  assert.deepEqual(previousDownloadDirectories({ runs: [
    run(path.join(root, "2026-10-19_10-20-30_abcd1234")),
    run(path.join(root, "2026-10-19_10-21-30_abcd5678")),
    run("../relative/2026-10-19_10-20-30_abcd1234"),
    run(path.join(root, "unrelated")),
    run(path.join(path.parse(root).root, "2026-10-19_10-20-30_abcd1234")),
  ] }), [root]);
  assert.deepEqual(previousDownloadDirectories(null), []);
});
