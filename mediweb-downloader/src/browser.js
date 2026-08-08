import { chromium } from "playwright-core";

export const MEDIWEB_URL = "https://resultados.innomedic.pe";

export const PACKAGED_BROWSER_CHANNELS = Object.freeze(["msedge", "chrome"]);

export class BrowserUnavailableError extends Error {
  constructor() {
    super("No se encontró Microsoft Edge ni Google Chrome en esta computadora.");
    this.name = "BrowserUnavailableError";
    this.code = "BROWSER_UNAVAILABLE";
  }
}

export async function launchBrowser(runtimePaths, { browserType = chromium } = {}) {
  const context = runtimePaths.packaged
    ? await launchPackagedPersistentContext(browserType, runtimePaths.authDir)
    : await browserType.launchPersistentContext(runtimePaths.authDir, browserOptions());
  const pages = context.pages();
  const mainPage = pages[0] ?? await context.newPage();
  await mainPage.goto(MEDIWEB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  return { context, mainPage };
}

export async function launchPackagedPersistentContext(browserType, profilePath) {
  for (const channel of PACKAGED_BROWSER_CHANNELS) {
    try {
      return await browserType.launchPersistentContext(profilePath, { ...browserOptions(), channel });
    } catch {
      // El siguiente channel es el fallback; no se exponen rutas internas al usuario.
    }
  }
  throw new BrowserUnavailableError();
}

function browserOptions() {
  return {
    headless: false,
    viewport: null,
    acceptDownloads: true,
  };
}

export async function closeQuietly(target) {
  if (!target) return;
  try {
    await target.close();
  } catch {
    // El usuario puede haber cerrado el navegador manualmente.
  }
}
