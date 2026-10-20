export * from "../../mediweb-downloader/src/recipientReview.js";
import { normalizePhoneForWhatsApp } from "./whatsappMessage.js";

export function createWhatsAppCheckWindow(openWindow = (...args) => window.open(...args), { delivery = false } = {}) {
  let chat = null;
  let opening = false;
  let reserved = false;
  function freshWindow() {
    // Reuse our live WindowProxy, not a named target that may still be closing.
    const created = openWindow("about:blank", "_blank");
    if (!created) throw new Error("POPUP_BLOCKED");
    created.opener = null;
    return created;
  }
  const openChat = async (worker, message) => {
    const phone = normalizePhoneForWhatsApp(worker.datos_operativos?.telefono);
    if (!phone) throw new Error("Teléfono inválido o ausente.");
    if (delivery && (typeof message !== "string" || !message.trim())) throw new Error("Falta el mensaje preparado para esta entrega.");
    if (opening) throw new Error("Espera a que termine de abrirse la conversación anterior.");
    opening = true;
    // Verification links carry only the phone, never a message, DNI or medical data.
    const url = `https://wa.me/${phone}`;
    const destination = delivery ? `${url}?text=${encodeURIComponent(message)}` : url;
    try {
      if (!chat || chat.closed) chat = freshWindow();
      try { chat.location.replace(destination); reserved = false; }
      catch {
        // Disowning opener can remove cross-origin navigation permission in Edge.
        // Close our old checking window and safely replace it in the same gesture.
        chat.close();
        const deadline = Date.now() + 1500;
        while (!chat.closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        if (!chat.closed) throw new Error("CHAT_NOT_CLOSED");
        chat = freshWindow();
        chat.location.replace(destination); reserved = false;
      }
      return true;
    } catch { if (chat?.closed) chat = null; throw new Error("Permite ventanas emergentes y cierra la conversación anterior si Windows impide reemplazarla. Vuelve a abrir WhatsApp. No se registró una confirmación."); }
    finally { opening = false; }
  };
  openChat.reserve = ({ fresh = false } = {}) => {
    if (opening) throw new Error("Espera a que termine de abrirse WhatsApp.");
    // Delivery can take seconds to validate protected files. Reserve a fresh
    // window during the click, rather than navigating an old cross-origin tab
    // and trying to open its replacement after browser activation has expired.
    if (!chat || chat.closed || (fresh && !reserved)) chat = freshWindow();
    reserved = true;
    return true;
  };
  openChat.discardReservation = () => {
    if (reserved && chat && !chat.closed) { chat.close(); chat = null; }
    reserved = false;
  };
  return openChat;
}

export const openWhatsAppCheck = createWhatsAppCheckWindow();
export const createWhatsAppDeliveryWindow = openWindow => createWhatsAppCheckWindow(openWindow, { delivery: true });
export const openWhatsAppDelivery = createWhatsAppDeliveryWindow();
