import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizeTtsConfigurationRequest, authorizeTtsRequest } from '../server/ttsAccess.js'
import { createTtsSession } from '../server/ttsSession.js'
import { getTtsConfiguration, synthesizeSpeech } from '../server/ttsService.js'

const service = 'https://jannpi-audioevaluaciones-tts.hf.space'
const settings = {
  TTS_LEGACY_MODE: '1',
  TTS_SERVICE_URL: service,
  VITE_TTS_SERVICE_URL: '',
  TTS_SERVICE_ACCESS_TOKEN: '',
  TTS_OPERATOR_PASSPHRASE: 'fictitious-very-long-operator-phrase-for-tests',
  INSTITUTIONAL_PROXY_TOKEN: '',
}

async function withEnv(overrides, action) {
  const all = { ...settings, ...overrides }
  const originals = Object.fromEntries(Object.keys(all).map(key => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  try {
    for (const [key, val] of Object.entries(all)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    return await action()
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, val] of Object.entries(originals)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  }
}

test('existing Space /health produces stable metadata without a paid request', async () => {
  await withEnv({}, async () => {
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push({ url, headers: init.headers })
      assert.equal(url, service + '/health')
      return new Response(JSON.stringify({ ok: true, engine: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id_configured: true }), { status: 200 })
    }
    authorizeTtsConfigurationRequest()
    const one = await getTtsConfiguration()
    const two = await getTtsConfiguration()
    assert.equal(one.provider, 'elevenlabs')
    assert.equal(one.format, 'mp3')
    assert.equal(one.model, 'eleven_flash_v2_5')
    assert.equal(one.settings.legacy_service, true)
    assert.deepEqual(one, two)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(c => !c.headers.Authorization))
  })
})

test('old /synthesize response gets configuration metadata without modifying Space', async () => {
  await withEnv({}, async () => {
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push(url)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, engine: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id_configured: true }), { status: 200 })
      }
      assert.equal(url, service + '/synthesize')
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.Authorization, undefined)
      assert.equal(JSON.parse(init.body).text, 'Prueba sin pacientes')
      return new Response(new Uint8Array([0x49,0x44,0x33,0x03]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    const result = await synthesizeSpeech({ text: 'Prueba sin pacientes', filenameHint: 'archivo' })
    assert.equal(result.mimeType, 'audio/mpeg')
    assert.ok(result.configuration)
    assert.equal(JSON.parse(decodeURIComponent(result.configuration)).settings.legacy_service, true)
    assert.deepEqual(calls, [service + '/health', service + '/synthesize'])
  })
})

test('legacy Space remains protected behind signed operator session', async () => {
  await withEnv({}, async () => {
    const unauthenticated = { headers: { authorization: '', cookie: '' } }
    assert.throws(() => authorizeTtsRequest(unauthenticated), { status: 401, code: 'TTS_OPERATOR_SESSION_REQUIRED' })
    const loginRequest = { url: 'https://preview.example.invalid', headers: { get(name) { return name === 'x-forwarded-proto' ? 'https' : '' } } }
    const cookie = createTtsSession(loginRequest, settings.TTS_OPERATOR_PASSPHRASE)
    assert.doesNotThrow(() => authorizeTtsRequest({ headers: { cookie: cookie.split(';')[0] } }))
  })
})

test('other hosts and missing operator secret cannot opt in to legacy mode', async () => {
  await withEnv({ TTS_SERVICE_URL: 'https://unknown.hf.space' }, async () => {
    assert.throws(() => authorizeTtsConfigurationRequest(), { status: 503, code: 'TTS_LEGACY_URL_UNSAFE' })
  })
  await withEnv({ TTS_OPERATOR_PASSPHRASE: '' }, async () => {
    assert.throws(() => authorizeTtsConfigurationRequest(), { status: 503, code: 'TTS_OPERATOR_ACCESS_NOT_CONFIGURED' })
  })
})
