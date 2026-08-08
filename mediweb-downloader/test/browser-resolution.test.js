import test from "node:test";
import assert from "node:assert/strict";
import { BrowserUnavailableError, launchPackagedPersistentContext } from "../src/browser.js";

test("browser packaged prefiere Microsoft Edge", async () => {
  const calls = [];
  const context = {};
  const browserType = { async launchPersistentContext(profile, options) { calls.push({ profile, options }); return context; } };
  assert.equal(await launchPackagedPersistentContext(browserType, "C:\\auth"), context);
  assert.deepEqual(calls.map((call) => call.options.channel), ["msedge"]);
  assert.equal(calls[0].options.headless, false);
});

test("browser packaged usa Chrome si Edge no puede iniciar", async () => {
  const calls = [];
  const browserType = {
    async launchPersistentContext(profile, options) {
      calls.push({ profile, options });
      if (options.channel === "msedge") throw new Error("Edge no instalado");
      return { channel: options.channel };
    },
  };
  assert.deepEqual(await launchPackagedPersistentContext(browserType, "C:\\auth"), { channel: "chrome" });
  assert.deepEqual(calls.map((call) => call.options.channel), ["msedge", "chrome"]);
});

test("browser packaged entrega error amigable si Edge y Chrome faltan", async () => {
  const browserType = { async launchPersistentContext() { throw new Error("ruta interna sensible"); } };
  await assert.rejects(
    launchPackagedPersistentContext(browserType, "C:\\auth"),
    (error) => error instanceof BrowserUnavailableError
      && error.message === "No se encontró Microsoft Edge ni Google Chrome en esta computadora."
      && !error.message.includes("ruta interna"),
  );
});
