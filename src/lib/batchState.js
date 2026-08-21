export function collectBatchAudioObjectUrls(analysis) {
  return (analysis?.workers || [])
    .map((worker) => worker?.app_fields?.audio_url)
    .filter((url) => typeof url === "string" && url.startsWith("blob:"));
}

export function revokeBatchAudioObjectUrls(analysis, revokeObjectUrl) {
  const revoke = revokeObjectUrl || globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  if (!revoke) return [];

  const urls = [...new Set(collectBatchAudioObjectUrls(analysis))];
  urls.forEach((url) => revoke(url));
  return urls;
}

export function resetBatchSnapshot(snapshot, revokeObjectUrl) {
  revokeBatchAudioObjectUrls(snapshot?.analysis, revokeObjectUrl);
  return {
    ...snapshot,
    analysis: null,
    selectedWorkerIndex: null,
    preview: "",
  };
}

export function createBatchMetadata(analysis, sourceMode) {
  const workers = analysis?.workers || [];
  return {
    sourceMode: sourceMode || analysis?.source_mode || "pdf",
    fileName: analysis?.file_name || "",
    pageCount: analysis?.total_pages ?? null,
    workerCount: analysis?.workers_detected ?? workers.length,
  };
}
