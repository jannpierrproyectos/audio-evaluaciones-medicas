export const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const WINDOWS_RUN_VALUE = "AudioEvaluacionesConnector";

export function startupCommand(executablePath) {
  return `"${executablePath}" --startup`;
}

export function setStartupPreference(registry, executablePath, enabled) {
  if (enabled) registry.set(WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE, startupCommand(executablePath));
  else registry.delete(WINDOWS_RUN_KEY, WINDOWS_RUN_VALUE);
  return enabled;
}
