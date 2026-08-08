import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { extractVisibleReports } from "../src/mediwebTable.js";
import {
  createPageSignature,
  goToNextResultsPage,
  waitForPageSignatureChange,
} from "../src/pagination.js";

const HEADER = "<tr><th>Código</th><th>Fecha</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr>";

function row(id) {
  return `<tr><td>C${id}</td><td>2026-08-07</td><td>Empresa</td><td>Paciente</td><td>DNI</td><td>APTO</td><td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=${id}&idpaciente=P${id}">Reporte</a></td></tr>`;
}

async function signature(page) {
  return createPageSignature((await extractVisibleReports(page)).atenciones);
}

test("paginación AJAX usa cambio de tabla sin navegación ni cambio de URL", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody id="rows">${row(1)}</tbody></table>
      <nav class="pagination"><span aria-current="page">1</span><button id="next">Siguiente &gt;</button></nav>
      <script>
        document.querySelector('#next').addEventListener('click', () => {
          document.querySelector('#rows').innerHTML = ${JSON.stringify(row(2))};
          document.querySelector('[aria-current]').textContent = '2';
        });
      </script>`);
    const originalUrl = page.url();
    const result = await goToNextResultsPage(page, await signature(page), {
      changeTimeout: 1_000, pollInterval: 25, expectedPageNumber: 2,
    });
    assert.equal(result.status, "advanced");
    assert.equal(result.attempt, 1);
    assert.equal(result.currentPageNumber, 2);
    assert.deepEqual(result.extraction.atenciones.map((item) => item.idcomprobante), ["2"]);
    assert.equal(page.url(), originalUrl);
  } finally {
    await browser.close();
  }
});

test("el polling detecta un cambio externo mientras goToNextResultsPage espera", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody id="rows">${row(10)}</tbody></table>
      <nav class="pagination"><button id="next">Siguiente</button></nav>`);
    await page.evaluate((replacement) => {
      setTimeout(() => { document.querySelector("#rows").innerHTML = replacement; }, 150);
    }, row(11));
    const result = await goToNextResultsPage(page, await signature(page), {
      changeTimeout: 1_000, pollInterval: 25,
    });
    assert.equal(result.status, "advanced");
    assert.equal(result.attempt, 1);
    assert.deepEqual(result.extraction.atenciones.map((item) => item.idcomprobante), ["11"]);
  } finally {
    await browser.close();
  }
});

test("waitForPageSignatureChange observa el DOM aunque ningún click origine el cambio", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<table><thead>${HEADER}</thead><tbody id="rows">${row(20)}</tbody></table>`);
    const previous = await signature(page);
    await page.evaluate((replacement) => {
      setTimeout(() => { document.querySelector("#rows").innerHTML = replacement; }, 100);
    }, row(21));
    const changed = await waitForPageSignatureChange(page, previous, { timeout: 1_000, pollInterval: 25 });
    assert.equal(changed.changed, true);
    assert.deepEqual(changed.extraction.atenciones.map((item) => item.idcomprobante), ["21"]);
  } finally {
    await browser.close();
  }
});

test("si la tabla ya cambió manualmente antes de avanzar no envía otro click", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody>${row(50)}</tbody></table>
      <nav class="pagination"><button id="next">Siguiente</button></nav>
      <script>window.clickCount = 0; document.querySelector('#next').onclick = () => { window.clickCount += 1; };</script>`);
    const previous = createPageSignature([{ idcomprobante: "49" }]);
    const result = await goToNextResultsPage(page, previous, { changeTimeout: 150, pollInterval: 25 });
    assert.equal(result.status, "advanced");
    assert.equal(result.attempt, 0);
    assert.equal(await page.evaluate(() => window.clickCount), 0);
  } finally {
    await browser.close();
  }
});

test("usa una sola vez el fallback DOM cuando el click normal no cambia la tabla", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody id="rows">${row(30)}</tbody></table>
      <nav class="pagination"><button id="next">Siguiente</button></nav>
      <script>
        window.clicks = [];
        document.querySelector('#next').addEventListener('click', (event) => {
          window.clicks.push(event.isTrusted ? 'normal' : 'dom');
          if (!event.isTrusted) document.querySelector('#rows').innerHTML = ${JSON.stringify(row(31))};
        });
      </script>`);
    const result = await goToNextResultsPage(page, await signature(page), {
      changeTimeout: 150, pollInterval: 25,
    });
    assert.equal(result.status, "advanced");
    assert.equal(result.attempt, 2);
    assert.deepEqual(await page.evaluate(() => window.clicks), ["normal", "dom"]);
  } finally {
    await browser.close();
  }
});

test("dos intentos sin cambio terminan con error y sin espera pendiente", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody>${row(40)}</tbody></table>
      <nav class="pagination"><button id="next">Siguiente</button></nav>
      <script>window.clickCount = 0; document.querySelector('#next').onclick = () => { window.clickCount += 1; };</script>`);
    const started = Date.now();
    const result = await goToNextResultsPage(page, await signature(page), {
      changeTimeout: 150, pollInterval: 25,
    });
    assert.equal(result.status, "error");
    assert.equal(result.attempt, 2);
    assert.equal(await page.evaluate(() => window.clickCount), 2);
    assert.ok(Date.now() - started < 2_000);
  } finally {
    await browser.close();
  }
});
