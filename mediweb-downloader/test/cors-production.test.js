import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp, parseAllowedOrigins } from "../src/http/app.js";

const PRODUCTION_ORIGIN = "https://audio-evaluaciones-medicas-189kimjvx.vercel.app";

async function withServer(callback) {
  const engine = {
    browserOpen: false,
    openCalls: 0,
    async open() {
      this.openCalls += 1;
      return { browserOpen: true };
    },
  };
  const jobManager = { hasActiveJob: false };
  const allowedOrigins = parseAllowedOrigins([
    " http://localhost:5173/ ",
    "http://127.0.0.1:5173",
    `${PRODUCTION_ORIGIN}/`,
  ].join(","));
  const server = createServer(createApp({ engine, jobManager, version: "cors-test", allowedOrigins }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback({ baseUrl, engine });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("normaliza y autoriza únicamente origins exactos configurados", async () => {
  await withServer(async ({ baseUrl }) => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", PRODUCTION_ORIGIN]) {
      const response = await fetch(`${baseUrl}/health`, { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    for (const origin of [
      "https://example.com",
      `${PRODUCTION_ORIGIN}.example.com`,
      "https://cualquier-proyecto.vercel.app",
    ]) {
      const response = await fetch(`${baseUrl}/health`, { headers: { Origin: origin } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal((await response.json()).code, "ORIGIN_NOT_ALLOWED");
    }
  });
});

test("permite herramientas loopback sin Origin y no usa credenciales web", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("OPTIONS y Private Network Access solo responden a origins permitidos sin efectos", async () => {
  await withServer(async ({ baseUrl, engine }) => {
    const paths = [
      "/health",
      "/mediweb/open",
      "/mediweb/detect",
      "/jobs",
      "/jobs/job-id",
      "/jobs/job-id/cancel",
      "/jobs/job-id/first-pages",
      "/jobs/job-id/manifest",
    ];
    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: PRODUCTION_ORIGIN,
          "Access-Control-Request-Method": path.endsWith("open") || path.endsWith("detect") || path === "/jobs" || path.endsWith("cancel") ? "POST" : "GET",
          "Access-Control-Request-Headers": path === "/jobs" ? "Content-Type" : "",
        },
      });
      assert.equal(response.status, 204, path);
      assert.equal(response.headers.get("access-control-allow-origin"), PRODUCTION_ORIGIN);
    }
    assert.equal(engine.openCalls, 0);

    const privateNetwork = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: PRODUCTION_ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(privateNetwork.status, 204);
    assert.equal(privateNetwork.headers.get("access-control-allow-private-network"), "true");

    const rejected = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-private-network"), null);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  });
});
