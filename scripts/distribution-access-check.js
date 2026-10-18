// Real Edge + Vite backend. Gateway identity and voice provider are fictional/local.
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium } from '../mediweb-downloader/node_modules/playwright-core/index.mjs';
import { viteTtsApiPlugin } from '../server/viteTtsApiPlugin.js';

let vite, browser, upstream, calls = 0;
const names = ['TTS_SERVICE_URL', 'INSTITUTIONAL_PROXY_TOKEN', 'TTS_SERVICE_ACCESS_TOKEN'];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
Object.assign(process.env, { INSTITUTIONAL_PROXY_TOKEN: 'pasarela-ficticia-'.repeat(4), TTS_SERVICE_ACCESS_TOKEN: 'servicio-ficticio-'.repeat(4) });
try {
  upstream = httpServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${process.env.TTS_SERVICE_ACCESS_TOKEN}`) { response.writeHead(401); response.end(); return; }
    if (request.url === '/configuration') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ provider: 'simulado', format: 'mp3', contract: 1 })); return; }
    calls++; request.resume(); response.setHeader('Content-Type', 'audio/mpeg'); response.end('ID3FICTICIO');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  process.env.TTS_SERVICE_URL = `http://127.0.0.1:${upstream.address().port}`;
  vite = await createServer({ configFile: false, plugins: [{ name: 'fictional-gateway', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      // Test-only server-side injection. A real gateway must authenticate an operator.
      if (request.headers.cookie === 'fictional_session=ok') request.headers.authorization = `Bearer ${process.env.INSTITUTIONAL_PROXY_TOKEN}`;
      if (request.url === '/access-fixture') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html><body><button id="chat">Comprobar ventana ficticia</button><script type="module">
          import { openWhatsAppCheck } from '/src/lib/whatsappReview.js';
          let i=0; document.getElementById('chat').onclick=async()=>{document.body.dataset.result='pending';try{await openWhatsAppCheck({datos_operativos:{telefono:'99911111'+(i+1)}});i++;document.body.dataset.result='ok'}catch(e){document.body.dataset.result=e.message}};document.body.dataset.ready='true';
          </script></body></html>`); return;
      }
      next();
    });
  } }, viteTtsApiPlugin()], server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await vite.listen(); const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext();
  const openedUrls = [];
  await context.route('https://wa.me/**', route => { openedUrls.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: 'WhatsApp ficticio' }); });
  const page = await context.newPage(); await page.goto(`${url}/access-fixture`);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const send = () => page.evaluate(async () => { const r = await fetch('/api/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'FICTICIO' }) }); return r.status; });
  assert.equal(await send(), 401); assert.equal(calls, 0);
  await context.addCookies([{ url, name: 'fictional_session', value: 'ok', httpOnly: true }]);
  assert.equal(await send(), 200); assert.equal(calls, 1);
  console.log('APROBADO: Edge HTTP sin autorización no despacha; gateway ficticio autoriza un único TTS local simulado.');
  await page.getByRole('button', { name: 'Comprobar ventana ficticia' }).click();
  let deadline = Date.now() + 15000;
  while (!openedUrls.some(value => value.includes('51999111111')) && Date.now() < deadline) await page.waitForTimeout(100);
  assert.ok(openedUrls.some(value => value.includes('51999111111')), JSON.stringify({ openedUrls, pages: context.pages().map(item => item.url()) }));
  await page.getByRole('button', { name: 'Comprobar ventana ficticia' }).click();
  deadline = Date.now() + 15000;
  let operatorClosure = false;
  while ((!openedUrls.some(value => value.includes('51999111112')) || context.pages().length !== 2) && Date.now() < deadline) await page.waitForTimeout(100);
  if ((await page.locator('body').getAttribute('data-result')).includes('cierra la conversación anterior')) {
    // Operator closes the fictional tab after an explicit browser refusal.
    for (const previous of context.pages().filter(item => item !== page)) { assert.ok(previous.url().startsWith('https://wa.me/') || previous.url() === 'about:blank'); await previous.close(); }
    operatorClosure = true;
    await page.getByRole('button', { name: 'Comprobar ventana ficticia' }).click();
    deadline = Date.now() + 15000;
    while ((!openedUrls.some(value => value.includes('51999111112')) || context.pages().length !== 2) && Date.now() < deadline) await page.waitForTimeout(100);
  }
  assert.ok(openedUrls.some(value => value.includes('51999111112')), JSON.stringify({ openedUrls, pages: context.pages().map(item => item.url()) }));
  assert.equal(context.pages().length, 2);
  console.log(JSON.stringify({ popupPages: context.pages().map(item => item.url()), result: await page.locator('body').getAttribute('data-result'), operatorClosure, simulatedTtsCalls: calls }));
} finally {
  await browser?.close(); await vite?.close(); if (upstream) await new Promise(resolve => upstream.close(resolve));
  for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
}
