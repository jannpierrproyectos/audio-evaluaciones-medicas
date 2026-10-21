import test from "node:test";
import assert from "node:assert/strict";
import { getMediwebJobFailure } from "../src/lib/mediwebUiState.js";

test("failed jobs explain missing output and retain only a safe diagnostic code", () => {
  assert.match(getMediwebJobFailure({ errorCode: "ENOENT" }), /carpeta o archivo.*\[ENOENT\]/);
  const message = getMediwebJobFailure({ errorCode: "patient C:/private/file.pdf", message: "PRIVATE DATA" });
  assert.match(message, /\[PROCESS_FAILED\]/);
  assert.doesNotMatch(message, /PRIVATE|patient|C:\//);
});
