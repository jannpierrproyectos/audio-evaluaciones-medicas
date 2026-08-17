import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractOperationalDataFromPdf, extractPhoneFromPages } from "../src/phoneExtractor.js";

test("prioriza la pagina 11 cuando contiene el telefono del trabajador", () => {
  const pages = [
    { page: 3, text: "Ficha Medico Ocupacional", lines: [{ text: "Correo electronico: uno@example.test Telefono 911 111 111" }] },
    { page: 11, text: "Ficha Medico Ocupacional", lines: [{ text: "Correo electronico: dos@example.test Telefono 922 222 222" }] },
  ];
  assert.equal(extractPhoneFromPages(pages), "922222222");
});

test("busca en otra pagina si la prioritaria no contiene un telefono confiable", () => {
  const pages = [
    { page: 7, text: "Ficha Medica Ocupacional", lines: [{ text: "Correo electronico: trabajador@example.test Telefono: 933333333" }] },
    { page: 11, text: "DNI: 12345678", lines: [{ text: "DNI: 12345678" }] },
  ];
  assert.equal(extractPhoneFromPages(pages), "933333333");
});

test("normaliza espacios, guiones y prefijo peruano", () => {
  const pages = [{ page: 11, text: "Ficha Medico Ocupacional", lines: [{ text: "Telefono: +51 944-555-666" }] }];
  assert.equal(extractPhoneFromPages(pages), "944555666");
});

test("devuelve vacio cuando el telefono esta ausente", () => {
  assert.equal(extractPhoneFromPages([{ page: 11, text: "Ficha Medico Ocupacional DNI: 12345678" }]), "");
});

test("no captura el DNI aunque aparezca cerca del rotulo telefono", () => {
  const pages = [{ page: 11, text: "Ficha Medico Ocupacional DNI: 12345678 Telefono: 12345678" }];
  assert.equal(extractPhoneFromPages(pages), "");
});

test("prefiere el telefono personal sobre el institucional del encabezado", () => {
  const pages = [{
    page: 11,
    height: 800,
    text: "Ficha Medico Ocupacional",
    lines: [
      { text: "Clinica Central Telefono 955000000", y: 760, height: 800 },
      { text: "Correo electronico: persona@example.test Telefono 966777888", y: 410, height: 800 },
    ],
  }];
  assert.equal(extractPhoneFromPages(pages), "966777888");
});

test("extrae telefono y documento desde un PDF sintetico completo", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 11; index += 1) {
    const page = pdf.addPage([595, 842]);
    if (index === 1) page.drawText("DNI: 87654321", { x: 80, y: 700, font, size: 12 });
    if (index === 11) {
      page.drawText("FICHA MEDICO OCUPACIONAL", { x: 80, y: 700, font, size: 12 });
      page.drawText("Correo electronico: prueba@example.test Telefono 977 888 999", { x: 80, y: 500, font, size: 12 });
    }
  }
  const result = await extractOperationalDataFromPdf(await pdf.save());
  assert.deepEqual(result, { telefono: "977888999", numeroDocumento: "87654321" });
});
