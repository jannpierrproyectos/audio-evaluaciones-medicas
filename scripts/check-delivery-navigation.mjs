// Additional acceptance against the already running isolated eight-worker preview.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "../mediweb-downloader/node_modules/playwright-core/index.mjs";
const origin = "http://127.0.0.1:4180";
const serviceSource = await (await fetch(`${origin}/src/services/mediwebService.js`)).text();
const origins = [...new Set([...serviceSource.matchAll(/http:\/\/127\.0\.0\.1:\d+/g)].map(match => match[0]))].filter(url => url !== origin && !url.endsWith(":8765"));
assert.equal(origins.length, 1, "Only the controlled Connector may be accessed");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  let tts = 0, external = 0;
  const errors = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if ([origin, origins[0]].includes(url.origin) || ["blob:", "data:"].includes(url.protocol)) {
      if (url.pathname === "/api/tts/synthesize") tts++;
      return route.continue();
    }
    external++; return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("heading", { name: "Lote procesado y disponible" }).waitFor();
  await page.getByRole("button", { name: "4. Entregas", exact: true }).click();
  const selected = page.getByRole("region", { name: "Entrega seleccionada" });
  await selected.getByRole("heading", { name: /Persona1/i }).waitFor();
  await selected.getByRole("button", { name: "Siguiente", exact: true }).click();
  await selected.getByRole("heading", { name: /Persona2/i }).waitFor();
  await selected.getByRole("button", { name: "Anterior", exact: true }).click();
  await selected.getByRole("heading", { name: /Persona1/i }).waitFor();
  await selected.getByRole("button", { name: "Preparar envío por WhatsApp", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("Confirmo que envié mensaje, PDF y MP3") && !button.disabled), null, { timeout: 180000 });
  await page.screenshot({ path: "artifacts/ux-correction/after/09-entrega-preparada.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/ux-correction/after/10-entrega-movil.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(tts, 0); assert.equal(external, 0); assert.deepEqual(errors, []);
  const reportPath = "artifacts/ux-correction/results.json";
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.deliveryNavigationAndReuse = { passed: true, ttsRequests: tts, externalRequests: external, pageErrors: errors };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.deliveryNavigationAndReuse));
} finally { await browser.close(); }
