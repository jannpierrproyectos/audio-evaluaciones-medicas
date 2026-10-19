import assert from 'node:assert/strict'
import { test } from 'node:test'
import { grantLocalTtsAccess } from '../server/localTtsAccess.js'
import { authorizeTtsRequest } from '../server/ttsAccess.js'
import { normalizeTtsConfiguration } from '../server/ttsService.js'

test('local backend grants password-free audio; remote, forged and public requests remain denied', () => {
  const env = { ...process.env }
  try {
    delete process.env.VERCEL
    Object.assign(process.env, { NODE_ENV: 'development', TTS_SERVICE_URL: 'https://voice.example.invalid', TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-token-long-enough', TTS_LEGACY_MODE: '', TTS_OPERATOR_PASSPHRASE: '', INSTITUTIONAL_PROXY_TOKEN: '' })
    const request = () => ({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1', localPort: 5173 }, headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' } })
    const local = request()
    assert.equal(grantLocalTtsAccess(local), true)
    assert.doesNotThrow(() => authorizeTtsRequest(local))
    for (const bad of [
      { ...request(), socket: { ...request().socket, remoteAddress: '192.0.2.1' } },
      { ...request(), headers: { ...request().headers, origin: 'https://other.invalid' } },
      { ...request(), headers: { ...request().headers, host: 'rebind.invalid:5173' } },
      { ...request(), headers: { ...request().headers, 'x-forwarded-for': '127.0.0.1' } },
      { ...request(), headers: { ...request().headers, 'sec-fetch-site': 'cross-site' } },
    ]) {
      assert.equal(grantLocalTtsAccess(bad), false)
      assert.throws(() => authorizeTtsRequest(bad), { status: 401 })
    }
    assert.throws(() => authorizeTtsRequest(request()), { status: 401 })
    process.env.TTS_LEGACY_MODE = '1'
    process.env.TTS_SERVICE_URL = 'https://jannpi-audioevaluaciones-tts.hf.space'
    const legacy = request()
    assert.equal(grantLocalTtsAccess(legacy), true)
    assert.doesNotThrow(() => authorizeTtsRequest(legacy))
    assert.throws(() => authorizeTtsRequest(request()), { status: 401 })
    process.env.NODE_ENV = 'production'
    assert.equal(grantLocalTtsAccess(request()), false)
    assert.throws(() => authorizeTtsRequest(request()), { status: 401 })
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
})

test('existing provider configuration aliases are adapted without exposing the voice identifier', () => {
  const value = normalizeTtsConfiguration({ engine: 'elevenlabs', model_id: 'test-model', voice_id: 'test-voice', output_format: 'mp3_44100_128' })
  assert.equal(value.provider, 'elevenlabs')
  assert.equal(value.model, 'test-model')
  assert.equal(value.format, 'mp3')
  assert.match(value.voice_ref, /^[a-f0-9]{64}$/)
})
