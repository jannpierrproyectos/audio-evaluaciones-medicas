import { PDFDocument } from "pdf-lib";

const MINIMUM_PDF_BYTES = 512;

export async function createReportPdf(page, firstPageOnly = false) {
  await page.emulateMedia({ media: "print" });
  return page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    ...(firstPageOnly ? { pageRanges: "1" } : {}),
  });
}

export async function validatePdf(buffer, expectedPages = null) {
  if (!buffer?.length || buffer.length < MINIMUM_PDF_BYTES) throw new Error("El PDF generado esta vacio o es demasiado pequeno.");
  const document = await PDFDocument.load(buffer);
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error("El PDF no contiene paginas.");
  if (expectedPages !== null && pageCount !== expectedPages) throw new Error(`Se esperaban ${expectedPages} paginas y se obtuvieron ${pageCount}.`);
  return { document, pageCount };
}

export async function appendFirstPage(consolidated, sourceDocument) {
  const [page] = await consolidated.copyPages(sourceDocument, [0]);
  consolidated.addPage(page);
  return consolidated.getPageCount();
}
