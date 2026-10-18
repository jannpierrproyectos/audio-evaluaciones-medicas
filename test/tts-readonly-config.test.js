import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authorizeTtsConfigurationRequest,
  authorizeTtsRequest,
} from '../server/ttsAccess.js'

function withEnv(settings, action) {
  const original = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    action()
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const base = {
  TTS_LEGACY_MODE: '', // Explicitly isolate these token-mode tests from Preview env.
  TTS_SERVICE_URL: 'https://tts.example.invalid',
  VITE_TTS_SERVICE_URL: '',
  TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-token-0123456789',
  INSTITUTIONAL_PROXY_TOKEN: 'fictitious-operator-token-0123456789',
  VERCEL: '1',
  NODE_ENV: 'production',
}

test('read-only TTS configuration uses only backend service authentication', () => {
  withEnv(base, () => {
    assert.doesNotThrow(() => authorizeTtsConfigurationRequest())
    assert.throws(() => authorizeTtsRequest({ headers: { authorization: '' } }), { status: 401, code: 'TTS_UNAUTHORIZED' })
    assert.doesNotThrow(() => authorizeTtsRequest({ headers: { authorization: 'Bearer fictitious-operator-token-0123456789' } }))
  })
})

test('missing service token blocks read-only metadata', () => {
  withEnv({ ...base, TTS_SERVICE_ACCESS_TOKEN: '' }, () => {
    assert.throws(() => authorizeTtsConfigurationRequest(), { status: 503, code: 'TTS_ACCESS_NOT_CONFIGURED' })
  })
})

test('missing or unsafe external service URL fails closed', () => {
  withEnv({ ...base, TTS_SERVICE_URL: '' }, () => {
    assert.throws(() => authorizeTtsConfigurationRequest(), { status: 503, code: 'TTS_NOT_CONFIGURED' })
  })
  withEnv({ ...base, TTS_SERVICE_URL: 'http://remote.example.invalid' }, () => {
    assert.throws(() => authorizeTtsConfigurationRequest(), { status: 503, code: 'TTS_UNSAFE_URL' })
  })
})
