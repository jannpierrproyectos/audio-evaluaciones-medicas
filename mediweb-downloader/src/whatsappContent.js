import { normalizePersonName } from "./personNames.js";
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

