import path from "node:path";
import { chromium } from "playwright";

export const MEDIWEB_URL = "https://resultados.innomedic.pe";

export async function launchBrowser(moduleRoot) {
  const profilePath = path.join(moduleRoot, ".auth", "mediweb-profile");
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: null,
    acceptDownloads: true,
  });
  const pages = context.pages();
  const mainPage = pages[0] ?? await context.newPage();
  await mainPage.goto(MEDIWEB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  return { context, mainPage };
}

export async function closeQuietly(target) {
  if (!target) return;
  try {
    await target.close();
  } catch {
    // El usuario puede haber cerrado el navegador manualmente.
  }
}
