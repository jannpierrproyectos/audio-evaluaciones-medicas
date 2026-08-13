const isNodeRuntime = typeof window === "undefined";

if (isNodeRuntime && typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init = [1, 0, 0, 1, 0, 0]) {
      const values = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      [this.a, this.b, this.c, this.d, this.e, this.f] = values;
    }
  };
}

const pdfjsLib = isNodeRuntime
  ? await import("pdfjs-dist/legacy/build/pdf.mjs")
  : await import("pdfjs-dist");

if (!isNodeRuntime) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
}

export async function extractPdfTextItems(file) {
  if (!file) {
    throw new Error("No se recibió ningún archivo PDF.");
  }

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    ...(isNodeRuntime ? { disableWorker: true } : {}),
  }).promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const items = textContent.items
      .map((item) => {
        const transform = item.transform || [];
        const x = transform[4] ?? 0;
        const y = transform[5] ?? 0;

        return {
          text: item.str || "",
          x,
          y,
          page: pageNumber,
          width: item.width ?? 0,
          height: item.height ?? 0,
        };
      })
      .filter((item) => item.text.trim() !== "");

    pages.push({
      page: pageNumber,
      items,
      text: items.map((item) => item.text).join(" "),
    });
  }

  return {
    source_type: "pdf_text",
    pageCount: pdf.numPages,
    pages,
    fullText: pages.map((page) => page.text).join("\n"),
  };
}
