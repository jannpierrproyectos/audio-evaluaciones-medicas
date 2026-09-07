import { normalizePersonName } from "../clinical/normalizeClinicalData.js";

export const WHATSAPP_MESSAGE_TEMPLATE = `Buenas tardes, {nombre}, le escribimos de parte de la Clínica INNOMEDIC.

Le hacemos el envío de los resultados de su evaluación médica. Además, a la brevedad posible, recibirá un audio del resumen de dichos resultados.

De presentar alguna duda adicional, no dude en consultarlo con el médico de su empresa.

Saludos cordiales,
INNOMEDIC.`;

export const WHATSAPP_GENERIC_MESSAGE_TEMPLATE = `Buenas tardes, le escribimos de parte de la Clínica INNOMEDIC.

Le hacemos el envío de los resultados de su evaluación médica. Además, a la brevedad posible, recibirá un audio del resumen de dichos resultados.

De presentar alguna duda adicional, no dude en consultarlo con el médico de su empresa.

Saludos cordiales,
INNOMEDIC.`;

const PERU_LOCAL_MOBILE = /^9\d{8}$/;
const PERU_INTERNATIONAL_MOBILE = /^519\d{8}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function normalizePhoneForWhatsApp(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return "";
  if (PERU_LOCAL_MOBILE.test(digits)) return `51${digits}`;
  if (PERU_INTERNATIONAL_MOBILE.test(digits)) return digits;
  return "";
}

export function getWhatsAppRecipientName(worker) {
  const identification = worker?.identificacion || {};
  const structuredName = [
    normalizePersonName(identification.nombres),
    normalizePersonName(identification.apellidos),
  ].filter(Boolean).join(" ");

  const fallbackName = [
    identification.nombre_completo,
    identification.nombre_completo_original,
  ].map(normalizePersonName).find(Boolean);

  return structuredName || fallbackName || "";
}

export function buildWhatsAppMessage(worker, template = WHATSAPP_MESSAGE_TEMPLATE) {
  const identification = worker?.identificacion || {};
  const fullName = getWhatsAppRecipientName(worker);
  const variables = {
    nombre: fullName,
    empresa: String(identification.empresa || "").trim(),
  };

  if (template === WHATSAPP_MESSAGE_TEMPLATE && !fullName) {
    return WHATSAPP_GENERIC_MESSAGE_TEMPLATE;
  }
  return String(template).replace(/\{(nombre|empresa)\}/g, (_, key) => variables[key]);
}

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

export function getWhatsAppAvailability(worker) {
  const phone = normalizePhoneForWhatsApp(worker?.datos_operativos?.telefono);
  const pdfName = String(worker?.datos_operativos?.archivo_pdf_completo || "").trim();
  const pdfFileId = String(worker?.datos_operativos?.archivo_pdf_completo_id || "").trim();
  const audioUrl = String(worker?.app_fields?.audio_url || "").trim();
  const audioMimeType = String(worker?.app_fields?.audio_mime_type || "").toLowerCase();
  const audioFilename = String(worker?.app_fields?.audio_filename || "").toLowerCase();
  const hasMp3 = Boolean(audioUrl) && (audioMimeType === "audio/mpeg" || audioFilename.endsWith(".mp3"));
  const missing = [];

  if (!phone) missing.push("Teléfono inválido o ausente.");
  if (!pdfName || !pdfFileId) {
    missing.push("PDF completo no disponible en el Connector. En MediWeb, usa la opción Ambos.");
  }
  if (!hasMp3) missing.push("Genera el audio antes de preparar el envío por WhatsApp.");

  return {
    phone,
    pdfName,
    pdfFileId,
    hasValidPhone: Boolean(phone),
    hasPdf: Boolean(pdfName && pdfFileId),
    hasAudio: hasMp3,
    canPrepare: missing.length === 0,
    missing,
  };
}
