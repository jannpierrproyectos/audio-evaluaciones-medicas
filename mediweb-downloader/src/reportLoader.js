import { isSessionExpired } from "./session.js";

const EXPECTED_TEXT = "resultado de evaluacion medica";

function normalize(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
}

export async function waitForReportReady(page, timeout = 120_000) {
  await page.waitForLoadState("domcontentloaded", { timeout });
  if (await isSessionExpired(page)) return { ready: false, sessionExpired: true };

  try {
    await page.waitForFunction((expected) => {
      const text = (document.body?.innerText ?? "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
      return text.includes(expected);
    }, EXPECTED_TEXT, { timeout });
  } catch (error) {
    if (await isSessionExpired(page)) return { ready: false, sessionExpired: true };
    if (error?.name === "TimeoutError") return { ready: false, sessionExpired: false };
    throw error;
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 30_000) });
  } catch {
    // Algunas paginas mantienen solicitudes abiertas; networkidle es solo una ayuda.
  }

  await page.evaluate(async () => {
    const pending = [...document.images].filter((image) => !image.complete);
    await Promise.all(pending.map((image) => new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 15_000);
    })));
  });

  await waitForStableHeight(page);
  const state = await page.evaluate(() => ({
    text: (document.body?.innerText ?? "").trim(),
    height: document.body?.scrollHeight ?? 0,
    visible: Boolean(document.body && document.body.getBoundingClientRect().height > 0),
  }));
  if (await isSessionExpired(page)) return { ready: false, sessionExpired: true };
  await page.waitForTimeout(800);
  return { ready: state.visible && state.height > 100 && normalize(state.text).includes(EXPECTED_TEXT), sessionExpired: false };
}

async function waitForStableHeight(page, maximumMs = 20_000) {
  const started = Date.now();
  let previous = -1;
  let stableCount = 0;
  while (Date.now() - started < maximumMs && stableCount < 3) {
    const height = await page.evaluate(() => document.body?.scrollHeight ?? 0);
    stableCount = height === previous && height > 0 ? stableCount + 1 : 0;
    previous = height;
    await page.waitForTimeout(750);
  }
}
