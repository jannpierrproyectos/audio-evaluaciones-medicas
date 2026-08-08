import { MEDIWEB_URL } from "./browser.js";
import { printManualNavigationInstructions } from "./cli.js";

export async function isSessionExpired(page) {
  if (page.isClosed()) return true;
  try {
    return await page.evaluate(() => {
      const normalized = (document.body?.innerText ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
      const loginControl = [...document.querySelectorAll('button, input[type="submit"]')]
        .some((element) => visible(element) && /login|ingresar|acceder/i.test(element.textContent || element.value || ""));
      const accessPanel = normalized.includes("panel de control de acceso");
      const loginForm = Boolean(document.querySelector('form input[type="password"]'));
      return password || loginControl || accessPanel || loginForm;
    });
  } catch {
    return true;
  }
}

export async function restoreSession({ mainPage, cli }) {
  try {
    await mainPage.goto(MEDIWEB_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch {
    // El usuario aun puede recuperar la navegacion desde la ventana abierta.
  }
  console.log("\nLa sesión de MediWeb expiró.\n\nInicia sesión nuevamente.\nRegresa a Atenciones → Ocupacional.\nRepite la búsqueda.\nCuando estés listo, presiona Enter.");
  printManualNavigationInstructions();
  await cli.enter("");
}
