export function hasExistingAudio(appFields) {
  return Boolean(appFields?.audio_url);
}

export function getAudioGenerationIntent(
  appFields,
  { regenerationConfirmed = false } = {},
) {
  if (hasExistingAudio(appFields) && !regenerationConfirmed) {
    return "confirm";
  }

  return "generate";
}

export function createAudioRequestGuard() {
  const activeWorkerKeys = new Set();

  return {
    isActive(workerKey) {
      return activeWorkerKeys.has(workerKey);
    },
    start(workerKey) {
      if (activeWorkerKeys.has(workerKey)) return false;

      activeWorkerKeys.add(workerKey);
      return true;
    },
    finish(workerKey) {
      activeWorkerKeys.delete(workerKey);
    },
  };
}
