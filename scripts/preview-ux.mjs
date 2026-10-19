// Keep the previous preview command, now backed by the real isolated Connector.
export { startControlledPreview as startUxPreview } from "./controlled-processing-preview.mjs";
import { startControlledPreview } from "./controlled-processing-preview.mjs";
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/preview-ux.mjs")) {
  const preview = await startControlledPreview(4178);
  console.log(`Vista previa aislada, ocho evaluaciones: ${preview.url}`);
  process.once("SIGINT", async () => { await preview.stop(); process.exit(0); });
  process.once("SIGTERM", async () => { await preview.stop(); process.exit(0); });
}
