import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(projectRoot, "..", "public", "favicon.svg");
const assets = path.join(projectRoot, "assets");
const pngPath = path.join(assets, "AudioEvaluacionesConnector.png");
const icoPath = path.join(assets, "AudioEvaluacionesConnector.ico");
await mkdir(assets, { recursive: true });
const svg = (await readFile(source, "utf8")).replace("<svg ", '<svg style="width:224px;height:224px" ');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;width:256px;height:256px;background:transparent;display:grid;place-items:center}</style>${svg}`);
  await page.locator("svg").waitFor({ state: "visible" });
  await page.screenshot({ path: pngPath, omitBackground: true });
} finally {
  await browser.close();
}

const png = await readFile(pngPath);
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0;
ico[7] = 0;
ico[8] = 0;
ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);
await writeFile(icoPath, ico);
console.log(`Icono reutilizado desde favicon.svg: ${icoPath}`);
