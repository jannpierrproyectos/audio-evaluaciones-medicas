import test from "node:test";
import assert from "node:assert/strict";
import { TrayStateController } from "../src/trayState.js";

test("tray inicializa y refleja ready, browser, jobs completados/fallidos y salida", () => {
  const tray = new TrayStateController();
  const changes = [];
  tray.on("changed", (state) => changes.push(state.state));
  assert.deepEqual(tray.snapshot(), { state: "starting", activeJob: false });
  tray.handle("connector:ready");
  tray.handle("browser:opened");
  tray.handle("job:started");
  assert.equal(tray.canExit(), false);
  tray.handle("job:completed");
  assert.equal(tray.canExit(), true);
  tray.handle("job:started");
  tray.handle("job:failed");
  tray.handle("connector:stopped");
  assert.deepEqual(changes, ["ready", "browser_open", "processing", "completed", "processing", "error", "stopped"]);
});
