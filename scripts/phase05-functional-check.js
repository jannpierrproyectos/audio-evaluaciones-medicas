// Real Edge, React, Connector HTTP, PDF parser and encrypted AES/DPAPI store.
// Fictional data only; EFS and Explorer are injected in the disposable fixture.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
import { createApp } from "../mediweb-downloader/src/http/app.js";
import { deliveryFixture, configuration } from "../mediweb-downloader/test-support/deliveryFixture.js";

await deliveryFixture(async f => {
  let browser, connector, vite, page, ttsCalls = 0, interruptSettle = false;
  const reports = [], openedUrls = [];
  try {
    connector = createHttpServer(); await new Promise(resolve => connector.listen(0, "127.0.0.1", resolve));
    vite = await createServer({ configFile: false, plugins: [react()], define: { "import.meta.env.VITE_MEDIWEB_SERVICE_URL": JSON.stringify(`http://127.0.0.1:${connector.address().port}`) }, server: { host: "127.0.0.1", port: 0, strictPort: true } });
    await vite.listen(); const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
    connector.on("request", createApp({ engine: { browserOpen: false }, jobManager: { hasActiveJob: false }, managedFiles: f.files, getEvaluationStore: f.getStore, version: "0.5.0", allowedOrigins: new Set([appUrl]) }));
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    await context.route("**/api/tts/configuration", route => route.fulfill({ json: configuration }));
    await context.route("**/api/tts/synthesize", route => { ttsCalls++; return route.abort(); });
    await context.route("https://wa.me/**", route => { openedUrls.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: "Chat ficticio: no se envía información" }); });
    await context.route("**/deliveries", route => {
      if (interruptSettle && route.request().postDataJSON()?.action === "settle") { interruptSettle = false; return route.abort(); }
      return route.continue();
    });
    page = await context.newPage();
    const panel = () => page.getByRole("region", { name: "Entrega seleccionada" });
    const click = async name => { await panel().getByRole("button", { name, exact: true }).click(); await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.endsWith("…")); };
    const inbox = async () => {
      await page.getByRole("button", { name: "Abrir bandeja de entregas", exact: true }).click();
      await panel().getByText("Preparación: listo", { exact: false }).waitFor({ timeout: 30000 });
    };
    await page.goto(appUrl); await inbox();
    await f.store.exclusive(async data => {
      const interrupted = data.deliveries[0]; interrupted.state = "preparando";
      delete interrupted.pdf; delete interrupted.mp3; delete interrupted.message;
      return { write: true };
    });
    await f.restart(); await page.reload();
    await page.getByRole("button", { name: "Abrir bandeja de entregas", exact: true }).click();
    await panel().getByText("Preparación: preparando", { exact: false }).waitFor();
    await click("Reanudar preparación");
    await panel().getByText("Preparación: listo", { exact: false }).waitFor();
    reports.push("Preparación interrumpida tras exportación: reanudación explícita conserva el identificador y reutiliza el archivo protegido.");
    assert.equal(await panel().getByRole("button", { name: "Copiar mensaje", exact: true }).isDisabled(), true);
    assert.equal(await panel().getByRole("button", { name: "Confirmar y siguiente", exact: true }).isDisabled(), true);
    await click("Abrir WhatsApp");
    const deadline = Date.now() + 10000;
    while (!openedUrls.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(openedUrls.length, 1); assert.match(openedUrls[0], /^https:\/\/wa\.me\/51999111111\/?$/);
    await click("Copiar mensaje");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Persona1/i); assert.doesNotMatch(copied, /00000001|Texto ficticio aprobado/);
    await click("Mostrar PDF"); await click("Mostrar MP3");
    assert.equal(f.revealed.length, 2);
    assert.deepEqual((await f.service.list()).rows[0].delivery.confirmations, {});
    await click("Confirmo que envié mensaje"); await click("Confirmo que envié PDF");
    assert.equal((await f.service.list()).rows[0].delivery.state, "listo");
    reports.push("Preparación automática sin TTS; chat con URL solo telefónica, copia explícita y dos revelados simulados no confirman envíos.");
    await f.restart(); await page.reload(); await inbox();
    assert.match(await panel().innerText(), /mensaje: enviado confirmado por operador/);
    assert.match(await panel().innerText(), /PDF: enviado confirmado por operador/);
    assert.equal(await panel().getByRole("button", { name: "Mostrar MP3", exact: true }).isDisabled(), true);
    await click("Abrir WhatsApp"); await click("Mostrar MP3"); await click("Confirmo que envié MP3");
    await click("Confirmar y siguiente");
    await panel().getByRole("heading", { name: /Persona2/i }).waitFor();
    await panel().getByText("Preparación: listo", { exact: false }).waitFor({ timeout: 30000 });
    assert.equal((await f.service.list()).rows[0].delivery.state, "completada");
    reports.push("Reinicio de almacén y recarga conservan confirmaciones parciales; solo el cierre explícito completa y avanza al siguiente trabajador.");
    // Operator closes finished fictional conversations before switching recipients.
    // Never force an inaccessible tab to be reused or bypass the closure guard.
    for (const previous of context.pages().filter(item => item !== page)) {
      assert.ok(previous.url() === 'about:blank' || previous.url().startsWith('https://wa.me/'));
      await previous.close();
    }
    await click("Abrir WhatsApp"); interruptSettle = true; await click("Copiar mensaje");
    await panel().getByText("Preparación: incierta", { exact: false }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Abrir bandeja de entregas", exact: true }).click();
    await panel().getByText("Preparación: incierta", { exact: false }).waitFor();
    assert.equal(await panel().getByRole("button", { name: "Abrir WhatsApp", exact: true }).isDisabled(), true);
    for (const label of ["mensaje", "PDF", "MP3"]) await panel().getByLabel(`Resultado de ${label}`, { exact: true }).selectOption("no_enviado");
    await panel().getByLabel("Motivo de conciliación").fill("Comprobación ficticia: no se realizaron envíos");
    await panel().getByRole("checkbox", { name: "Declaro que comprobé", exact: false }).check();
    await click("Guardar conciliación");
    await panel().getByText("Preparación: cancelada", { exact: false }).waitFor();
    await click("Reanudar preparación"); await panel().getByText("Preparación: listo", { exact: false }).waitFor();
    assert.deepEqual((await f.service.list()).rows[1].delivery.confirmations, {});
    assert.equal(ttsCalls, 0);
    reports.push("Respuesta interrumpida conserva intención incierta tras recarga; conciliación manual sin envíos permite reanudar sin inventar confirmaciones.");
    console.log(JSON.stringify({ browser: "Edge real (headless)", reports, ttsCalls, realWhatsAppSends: 0, efsAndExplorer: "simulados, solo datos ficticios", encryptedStore: "AES-GCM y DPAPI reales" }, null, 2));
  } catch (error) {
    console.error("Fase05 funcional:", error.message);
    if (page) console.error((await page.locator("body").innerText()).slice(-10000));
    throw error;
  } finally {
    await browser?.close(); await vite?.close();
    if (connector) await new Promise(resolve => connector.close(resolve));
  }
}, { realProtection: true });
