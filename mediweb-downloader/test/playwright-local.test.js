import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { extractVisibleReports } from "../src/mediwebTable.js";
import { isSessionExpired } from "../src/session.js";
import { waitForReportReady } from "../src/reportLoader.js";
import { createReportPdf, validatePdf } from "../src/pdfGenerator.js";
import { createManifest, selectAttentions, summarizeManifest } from "../src/manifest.js";

const HEADER = `<tr><th>Código.</th><th>Fecha</th><th>Criterios de aptitud</th><th>Empresa</th><th>Paciente</th><th>T. Doc</th><th>Aptitud</th><th>Imp S.F</th></tr>`;

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
  } finally {
    await browser.close();
  }
});
