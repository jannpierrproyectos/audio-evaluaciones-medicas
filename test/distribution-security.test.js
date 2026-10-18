import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/tts/synthesize.js";
import { GET } from "../api/tts/configuration.js";
import { authorizeTtsRequest } from "../server/ttsAccess.js";
import { GET as sheets } from "../api/sheets/trabajadores.js";

async function fixture(callback) {
  const names = ['TTS_SERVICE_URL', 'VITE_TTS_SERVICE_URL', 'INSTITUTIONAL_PROXY_TOKEN', 'TTS_SERVICE_ACCESS_TOKEN', 'TTS_MAX_CHARACTERS', 'NODE_ENV'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const fetchOriginal = globalThis.fetch, log = console.error; let calls = 0, options;
  Object.assign(process.env, { TTS_SERVICE_URL: 'https://ficticio.invalid', INSTITUTIONAL_PROXY_TOKEN: 'proxy-ficticio-'.repeat(4), TTS_SERVICE_ACCESS_TOKEN: 'service-ficticio-'.repeat(4), TTS_MAX_CHARACTERS: '5000' });
  globalThis.fetch = async (_url, value) => {
    calls++; options = value;
    // Configuration is intentionally public and read-only; never synthesizes audio.
    if (String(_url).endsWith('/configuration')) return Response.json({ provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice_ref: 'fixture', settings: {}, language: 'es', format: 'mp3', contract: 1 });
    return new Response('ID3FICTICIO', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  console.error = () => {};
  const request = (text, authorized = true) => new Request('http://localhost/api/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${process.env.INSTITUTIONAL_PROXY_TOKEN}` } : { Origin: 'https://sitio-autorizado.invalid' }) }, body: JSON.stringify({ text }) });
  try { await callback({ request, get calls() { return calls; }, get options() { return options; } }); }
  finally {
    globalThis.fetch = fetchOriginal; console.error = log;
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
}

test('Distribución: un Origin permitido no autoriza TTS; faltan claves => cierre seguro', async () => fixture(async f => {
  assert.equal((await POST(f.request('Texto ficticio', false))).status, 401);
  assert.equal((await GET(f.request('configuración', false))).status, 200);
  assert.equal((await sheets(f.request('trabajadores', false))).status, 401);
  delete process.env.INSTITUTIONAL_PROXY_TOKEN;
  // Con una pasarela configurada pero sin sesión ni token de operador, se deniega con 401.
  assert.equal((await POST(f.request('Texto ficticio'))).status, 401);
  assert.equal(f.calls, 1); // La única solicitud remota fue leer /configuration, sin síntesis.
}));
test('Distribución: acceso válido solo reenvía credencial de servicio al backend HTTPS', async () => fixture(async f => {
  const response = await POST(f.request('Texto ficticio'));
  assert.equal(response.status, 200); assert.equal(await response.text(), 'ID3FICTICIO'); assert.equal(f.calls, 1);
  assert.equal(f.options.headers.Authorization, `Bearer ${process.env.TTS_SERVICE_ACCESS_TOKEN}`);
  assert.equal(f.options.redirect, 'error'); assert.ok(f.options.signal);
  assert.equal(response.headers.get('authorization'), null);
}));
test('Distribución: límites rechazan cuerpo y texto sin truncar ni consumir proveedor', async () => fixture(async f => {
  assert.equal((await POST(f.request('x'.repeat(5001)))).status, 413);
  assert.equal((await POST(f.request('x'.repeat(70000)))).status, 413);
  const plain = f.request('Texto ficticio'); plain.headers.set('Content-Type', 'text/plain');
  assert.equal((await POST(plain)).status, 415);
  process.env.TTS_MAX_CHARACTERS = 'sin-limite';
  assert.equal((await POST(f.request('Texto ficticio'))).status, 503);
  assert.equal(f.calls, 0);
}));
test('Distribución: transporte inseguro y mock de producción no solicitan TTS', async () => fixture(async f => {
  process.env.TTS_SERVICE_URL = 'http://externo.invalid';
  assert.equal((await POST(f.request('Texto ficticio'))).status, 503); assert.equal(f.calls, 0);
  delete process.env.TTS_SERVICE_URL; delete process.env.VITE_TTS_SERVICE_URL;
  process.env.NODE_ENV = 'production';
  assert.throws(() => authorizeTtsRequest(f.request('texto')), /TTS bloqueado/);
}));
