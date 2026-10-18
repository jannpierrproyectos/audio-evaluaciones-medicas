export { WHATSAPP_MESSAGE_TEMPLATE, WHATSAPP_GENERIC_MESSAGE_TEMPLATE, getWhatsAppRecipientName, buildWhatsAppMessage } from "../../mediweb-downloader/src/whatsappContent.js";
export { normalizePhoneForWhatsApp, getWhatsAppAvailability, isWhatsAppConfirmed } from "../../mediweb-downloader/src/authorizationPolicy.js";

const PERU_INTERNATIONAL_MOBILE = /^519\d{8}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function buildWhatsAppUrl({ phone, message }) {
  if (!PERU_INTERNATIONAL_MOBILE.test(String(phone || ""))) return "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(String(message || ""))}`;
}

export function sanitizeWindowsFilePart(value, fallback = "trabajador") {
  let safe = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("")
    .map((character) => character.charCodeAt(0) < 32 ? " " : character)
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (WINDOWS_RESERVED_NAME.test(safe)) safe = `_${safe}`;
  return (safe || fallback).slice(0, 90).trim().replace(/[. ]+$/g, "");
}

export function buildWhatsAppAudioFilename(worker) {
  const identification = worker?.identificacion || {};
  const name =
    [identification.nombres, identification.apellidos].filter(Boolean).join(" ") ||
    identification.nombre_completo_original ||
    "Trabajador";
  const safeName = sanitizeWindowsFilePart(name)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeDni = sanitizeWindowsFilePart(identification.dni || "sin_DNI")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `02_Audio_${safeName || "Trabajador"}_${safeDni || "sin_DNI"}.mp3`;
}
