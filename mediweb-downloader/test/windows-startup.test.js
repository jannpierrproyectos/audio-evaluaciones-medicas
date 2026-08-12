import test from "node:test";
import assert from "node:assert/strict";
import { setStartupPreference, startupCommand, WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE } from "../src/windowsStartup.js";

test("startup HKCU habilita, reemplaza sin duplicar y deshabilita", () => {
  const values = new Map();
  const key = (registryKey, name) => `${registryKey}:${name}`;
  const registry = {
    set(registryKey, name, value) { values.set(key(registryKey, name), value); },
    delete(registryKey, name) { values.delete(key(registryKey, name)); },
  };
  const executable = "C:\\Program Files\\AudioEvaluaciones Connector\\AudioEvaluacionesConnector.exe";
  setStartupPreference(registry, executable, true);
  setStartupPreference(registry, executable, true);
  assert.equal(values.size, 1);
  assert.equal(values.get(key(WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE)), startupCommand(executable));
  setStartupPreference(registry, executable, false);
  assert.equal(values.size, 0);
});
