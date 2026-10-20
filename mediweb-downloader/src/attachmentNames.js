// Shared browser/Connector filename formatting; no I/O or clinical state changes.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeFilePart(value, fallback = "") {
  let result = String(value ?? "").replace(/[<>:"/\\|?*]/g, " ").replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (RESERVED.test(result)) result = `_${result}`;
  if (!result) result = fallback;
  return result.slice(0, 90).trim().replace(/[. ]+$/g, "");
}

export function deliveryAttachmentName(recipientName, extension) {
  if (![".pdf", ".mp3"].includes(extension)) throw new Error("Tipo de adjunto no permitido.");
  const patient = sanitizeFilePart(String(recipientName || "").replace(/\p{Cc}/gu, " ")).replace(/\s+/g, "_");
  if (!patient) return `adjunto${extension}`;
  return `${extension === ".pdf" ? "01_Evaluacion" : "02_Audio"}_${patient}${extension}`;
}

export function isDeliveryAttachmentName(name) {
  if (typeof name !== "string") return false;
  const match = /^(01_Evaluacion|02_Audio)_(.+)(\.pdf|\.mp3)$/.exec(name);
  return Boolean(match && deliveryAttachmentName(match[2], match[3]) === name);
}
