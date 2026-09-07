import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WHATSAPP_MESSAGE_TEMPLATE,
  WHATSAPP_GENERIC_MESSAGE_TEMPLATE,
  buildWhatsAppAudioFilename,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  getWhatsAppRecipientName,
  getWhatsAppAvailability,
  normalizePhoneForWhatsApp,
  sanitizeWindowsFilePart,
} from "../src/lib/whatsappMessage.js";
import { attachMediwebWorkerMetadata } from "../src/lib/importMediwebPdf.js";

for (const [input, expected] of [
  ["999999999", "51999999999"],
  ["999 999 999", "51999999999"],
  ["+51 999 999 999", "51999999999"],
  ["51999999999", "51999999999"],
  ["", ""],
  ["valor basura", ""],
  ["51123456789", ""],
]) {
  test(`normaliza teléfono WhatsApp: ${input || "vacío"}`, () => {
    assert.equal(normalizePhoneForWhatsApp(input), expected);
  });
}

test("personaliza el mensaje institucional con nombres y apellidos normalizados", () => {
  const worker = {
    identificacion: {
      nombres: "  JUAN   CARLOS ",
      apellidos: " PÉREZ   RAMÍREZ ",
      nombre_completo_original: "PÉREZ RAMÍREZ JUAN CARLOS",
      empresa: "Empresa Uno",
    },
    aptitud_y_recomendaciones: { aptitud_final: "APTO CON RESTRICCIONES" },
  };
  const message = buildWhatsAppMessage(worker);
  assert.equal(getWhatsAppRecipientName(worker), "Juan Carlos Pérez Ramírez");
  assert.match(message, /^Buenas tardes, Juan Carlos Pérez Ramírez, le escribimos de parte de la Clínica INNOMEDIC\./);
  assert.match(message, /Le hacemos el envío de los resultados de su evaluación médica\./);
  assert.match(message, /Saludos cordiales,\nINNOMEDIC\.$/);
  assert.doesNotMatch(message, /APTO|restricciones/i);
  assert.equal(buildWhatsAppMessage(worker, "{nombre} - {empresa}"), "Juan Carlos Pérez Ramírez - Empresa Uno");
  assert.match(WHATSAPP_MESSAGE_TEMPLATE, /\{nombre\}/);
});

test("usa el mensaje genérico cuando no hay un nombre válido", () => {
  const worker = { identificacion: { nombres: "N/A", apellidos: "  " } };
  assert.equal(getWhatsAppRecipientName(worker), "");
  assert.equal(buildWhatsAppMessage(worker), WHATSAPP_GENERIC_MESSAGE_TEMPLATE);
  assert.match(buildWhatsAppMessage(worker), /^Buenas tardes, le escribimos/);
});

for (const [label, identification, expected] of [
  ["espacios adicionales", { nombres: "  Ana   Luz ", apellidos: " Quispe   Soto " }, "Ana Luz Quispe Soto"],
  ["ya normalizado", { nombres: "Ana Luz", apellidos: "Quispe Soto" }, "Ana Luz Quispe Soto"],
  ["mayúsculas", { nombres: "ANA LUZ", apellidos: "QUISPE SOTO" }, "Ana Luz Quispe Soto"],
  ["nombre completo de respaldo", { nombre_completo_original: "ANA LUZ QUISPE SOTO" }, "Ana Luz Quispe Soto"],
  ["respaldo tras placeholder", { nombre_completo: "N/A", nombre_completo_original: "ANA LUZ QUISPE SOTO" }, "Ana Luz Quispe Soto"],
]) {
  test(`normaliza el nombre de WhatsApp: ${label}`, () => {
    assert.equal(getWhatsAppRecipientName({ identificacion: identification }), expected);
  });
}

test("construye Click to Chat con encodeURIComponent y teléfono ya normalizado", () => {
  const message = "Buenas tardes, Juan.\nAdjuntamos su reporte.";
  assert.equal(
    buildWhatsAppUrl({ phone: "51999999999", message }),
    `https://wa.me/51999999999?text=${encodeURIComponent(message)}`,
  );
  assert.equal(buildWhatsAppUrl({ phone: "999999999", message }), "");
});

test("sanitiza nombres Windows y crea un MP3 amigable sin datos clínicos", () => {
  assert.equal(sanitizeWindowsFilePart('  Juan  <Pérez>: "Norte"?  '), "Juan Perez Norte");
  assert.equal(sanitizeWindowsFilePart("CON"), "_CON");
  assert.equal(
    buildWhatsAppAudioFilename({ identificacion: { nombres: "Juan", apellidos: "Pérez / Soto", dni: "12345678" } }),
    "02_Audio_Juan_Perez_Soto_12345678.mp3",
  );
});

test("deriva disponibilidad de teléfono, PDF localizable y MP3 generado", () => {
  const ready = {
    datos_operativos: {
      telefono: "+51 999 999 999",
      archivo_pdf_completo: "001_Juan.pdf",
      archivo_pdf_completo_id: "2026-01-01/reportes-completos/001_Juan.pdf",
    },
    app_fields: {
      audio_url: "blob:audio-juan",
      audio_filename: "audio-juan.mp3",
      audio_mime_type: "audio/mpeg",
    },
  };
  assert.deepEqual(getWhatsAppAvailability(ready), {
    phone: "51999999999",
    pdfName: "001_Juan.pdf",
    pdfFileId: "2026-01-01/reportes-completos/001_Juan.pdf",
    hasValidPhone: true,
    hasPdf: true,
    hasAudio: true,
    canPrepare: true,
    missing: [],
  });

  const missing = getWhatsAppAvailability({ datos_operativos: {}, app_fields: {} });
  assert.equal(missing.canPrepare, false);
  assert.deepEqual(missing.missing, [
    "Teléfono inválido o ausente.",
    "PDF completo no disponible en el Connector. En MediWeb, usa la opción Ambos.",
    "Genera el audio antes de preparar el envío por WhatsApp.",
  ]);
});

test("propaga el identificador controlado de PDF desde metadata sin exponer una ruta absoluta", () => {
  const result = attachMediwebWorkerMetadata(
    { groups: [{ start_page: 1 }], workers: [{ identificacion: { dni: "12345678" } }] },
    {
      workers: [{
        numeroDocumento: "12345678",
        paginaConsolidado: 1,
        telefono: "999999999",
        archivoPdfCompleto: "001_Juan.pdf",
        archivoPdfCompletoId: "2026-01-01/reportes-completos/001_Juan.pdf",
      }],
    },
  );
  assert.deepEqual(result.workers[0].datos_operativos, {
    telefono: "999999999",
    archivo_pdf_completo: "001_Juan.pdf",
    archivo_pdf_completo_id: "2026-01-01/reportes-completos/001_Juan.pdf",
  });
  assert.doesNotMatch(JSON.stringify(result), /C:\\/);
});

test("la UI conserva el orden mensaje, PDF, audio y no afirma una entrega", async () => {
  const source = await readFile(new URL("../src/components/PdfWorkersPreview.jsx", import.meta.url), "utf8");
  const messageStep = source.indexOf("1. Mensaje");
  const pdfStep = source.indexOf("2. PDF");
  const audioStep = source.indexOf("3. Audio");
  assert.ok(messageStep > 0 && messageStep < pdfStep && pdfStep < audioStep);
  assert.match(source, /window\.open\("about:blank", "_blank"\)/);
  assert.match(source, /Finalizar preparación/);
  assert.doesNotMatch(source, /PDF enviado|Audio enviado|Confirmar entrega/);
});
