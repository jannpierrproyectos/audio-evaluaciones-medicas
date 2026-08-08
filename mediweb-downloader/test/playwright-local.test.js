import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { extractVisibleReports } from "../src/mediwebTable.js";
import { isSessionExpired } from "../src/session.js";
import { waitForReportReady } from "../src/reportLoader.js";
import { createReportPdf, validatePdf } from "../src/pdfGenerator.js";
import { createManifest, selectAttentions, summarizeManifest } from "../src/manifest.js";
import { createPageSignature, findNextPageControl, goToNextResultsPage, isNextPageEnabled } from "../src/pagination.js";

const HEADER = `<tr><th>Código.</th><th>Fecha</th><th>Criterios de aptitud</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr>`;

test("cuenta cada fila Imp S.F una vez aunque tenga dos enlaces de reporte", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rows = Array.from({ length: 100 }, (_, index) => `
      <tr><td>PQ${index + 1}</td><td>2026-08-07</td><td>CRITERIO</td><td>Empresa</td><td>Paciente</td><td>DNI</td><td>APTO</td>
        <td>
          <a href="https://local.invalid/imprimirtodos.php?idcomprobante=${index + 1}&idpaciente=${index + 1000}">Reporte</a>
          <a href="https://local.invalid/imprimirtodos.php?idcomprobante=${index + 1}&idpaciente=${index + 1000}">Icono</a>
        </td></tr>`).join("");
    await page.setContent(`<table>${HEADER}${rows}</table>`);
    const extraction = await extractVisibleReports(page);
    assert.equal(extraction.totalFilasDetectadas, 100);
    assert.equal(extraction.atenciones.length, 100);
    assert.equal(extraction.duplicadosEnPagina, 0);
  } finally {
    await browser.close();
  }
});

test("flujo local: encabezados repetidos, aptitud exacta, sesion y PDF", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        ${HEADER}
        <tr><td colspan="8">Atenciones programadas: 6</td></tr>
        ${HEADER}
        <tr><td>PQ1</td><td>2026-08-06</td><td>CRITERIO UNO</td><td>Empresa Uno</td><td>Paciente Uno</td><td>DNI</td><td>OBSERVADO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=10&idpaciente=20">Reporte</a></td></tr>
        <tr><td>PQ2</td><td>2026-08-06</td><td>CRITERIO DOS</td><td>Empresa Dos</td><td>Paciente Dos</td><td>DNI</td><td>APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=11&idpaciente=21">Reporte</a></td></tr>
        <tr><td>PQ2</td><td>2026-08-06</td><td>CRITERIO DOS</td><td>Empresa Dos</td><td>Paciente Dos</td><td>DNI</td><td>APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=11&idpaciente=21">Duplicado</a></td></tr>
        <tr><td>PQ3</td><td>2026-08-06</td><td>CRITERIO TRES</td><td>Empresa Tres</td><td>Paciente Tres</td><td>DNI</td><td>PENDIENTE</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=12&idpaciente=22">Reporte</a></td></tr>
        <tr><td>PQ4</td><td>2026-08-06</td><td>CRITERIO CUATRO</td><td>Empresa Cuatro</td><td>Paciente Cuatro</td><td>DNI</td><td>APTO CON RESTRICCIÓN</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=13&idpaciente=23">Reporte</a></td></tr>
        <tr><td>PQ5</td><td>2026-08-06</td><td>CRITERIO CINCO</td><td>Empresa Cinco</td><td>Paciente Cinco</td><td>DNI</td><td>NO APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=14&idpaciente=24">Reporte</a></td></tr>
        <tr><td>PQ6</td><td>2026-08-06</td><td>CRITERIO SEIS</td><td>Empresa Seis</td><td>Paciente Seis</td><td>DNI</td><td>APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=15&idpaciente=25">Reporte</a></td></tr>
      </table>`);

    const extraction = await extractVisibleReports(page);
    const reports = extraction.atenciones;
    assert.equal(reports.length, 6);
    assert.deepEqual(reports.map((item) => item.codigo), ["PQ1", "PQ2", "PQ3", "PQ4", "PQ5", "PQ6"]);
    assert.deepEqual(reports.map((item) => item.aptitud), [
      "OBSERVADO", "APTO", "PENDIENTE", "APTO CON RESTRICCIÓN", "NO APTO", "APTO",
    ]);
    assert.ok(extraction.encabezadosEncontrados.some((header) => header.includes("CRITERIOS DE APTITUD") && header.includes(" | APTITUD | ")));

    const seleccion = selectAttentions(reports, 2);
    assert.equal(seleccion.totalDetectado, 6);
    assert.equal(seleccion.totalElegible, 3);
    assert.equal(seleccion.totalExcluido, 3);
    assert.equal(seleccion.totalSeleccionado, 2);
    assert.deepEqual(seleccion.atencionesElegibles.map((item) => item.codigo), ["PQ2", "PQ4", "PQ6"]);
    assert.deepEqual(seleccion.atencionesSeleccionadas.map((item) => item.idcomprobante), ["11", "13"]);

    const manifest = createManifest({ mode: "both", limit: 2, selection: seleccion, outputDirectory: "C:\\salida-ficticia" });
    summarizeManifest(manifest);
    assert.equal(manifest.totalProcesado, 0);
    assert.equal(manifest.errores, 0);
    assert.deepEqual(manifest.atenciones.map((item) => item.estado), [
      "excluido_observado", "excluido_pendiente", "excluido_no_apto",
    ]);
    assert.doesNotMatch(JSON.stringify(manifest), /imprimirtodos\.php/);
    assert.equal(await isSessionExpired(page), false);

    await page.setContent('<form><input type="password"><button>Login</button></form>');
    assert.equal(await isSessionExpired(page), true);

    await page.setContent('<main style="min-height:400px"><h1>RESULTADO DE EVALUACIÓN MÉDICA</h1><p>Contenido local ficticio.</p></main>');
    assert.deepEqual(await waitForReportReady(page, 10_000), { ready: true, sessionExpired: false });
    const pdf = await createReportPdf(page, true);
    assert.equal((await validatePdf(pdf, 1)).pageCount, 1);

    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody id="rows">
        <tr><td>PQ10</td><td>2026-08-06</td><td>CRITERIO</td><td>Empresa</td><td>Paciente</td><td>DNI</td><td>APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=100&idpaciente=200">Reporte</a></td></tr>
      </tbody></table>
      <button>Siguiente paso</button>
      <nav aria-label="Paginación"><button id="next">Siguiente</button></nav>
      <script>
        document.querySelector('#next').addEventListener('click', () => {
          document.querySelector('#rows').innerHTML = '<tr><td>PQ11</td><td>2026-08-06</td><td>CRITERIO</td><td>Empresa</td><td>Paciente</td><td>DNI</td><td>APTO</td><td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=101&idpaciente=201">Reporte</a></td></tr>';
          document.querySelector('#next').setAttribute('aria-disabled', 'true');
        });
      </script>`);
    const nextControl = await findNextPageControl(page);
    assert.equal(await nextControl.getAttribute("id"), "next");
    assert.equal(await isNextPageEnabled(nextControl), true);
    const current = await extractVisibleReports(page);
    const advanced = await goToNextResultsPage(page, createPageSignature(current.atenciones), { timeout: 3_000 });
    assert.equal(advanced.status, "advanced");
    assert.deepEqual(advanced.extraction.atenciones.map((item) => item.idcomprobante), ["101"]);
    assert.equal(await isNextPageEnabled(await findNextPageControl(page)), false);
    assert.equal((await goToNextResultsPage(page, advanced.signature, { timeout: 500 })).status, "last_page");

    await page.setContent(`
      <table><thead>${HEADER}</thead><tbody id="rows">
        <tr><td>PQ12</td><td>2026-08-06</td><td>CRITERIO</td><td>Empresa</td><td>Paciente</td><td>DNI</td><td>APTO</td>
          <td><a href="https://local.invalid/imprimirtodos.php?idcomprobante=102&idpaciente=202">Reporte</a></td></tr>
      </tbody></table>
      <nav class="pagination"><button id="empty-next">Siguiente</button></nav>
      <script>
        document.querySelector('#empty-next').addEventListener('click', () => {
          document.querySelector('#rows').innerHTML = '';
          document.querySelector('nav').remove();
        });
      </script>`);
    const beforeEmpty = await extractVisibleReports(page);
    const emptyAdvance = await goToNextResultsPage(page, createPageSignature(beforeEmpty.atenciones), { timeout: 500 });
    assert.equal(emptyAdvance.status, "advanced");
    assert.equal(emptyAdvance.extraction.atenciones.length, 0);
    assert.equal(await findNextPageControl(page), null);
  } finally {
    await browser.close();
  }
});
