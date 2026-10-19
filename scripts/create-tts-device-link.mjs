import { createTtsDeviceLink } from '../server/ttsSession.js'

const origin = process.argv[2] || 'https://audio-evaluaciones-medicas.vercel.app'
async function readPrivatePassphrase() {
  if (!process.stdin.isTTY) throw new Error('Usa una terminal interactiva para introducir la clave de administración sin mostrarla.')
  process.stderr.write('Clave TTS existente en Vercel (entrada oculta; no se guarda): ')
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
    function done(error) {
      process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); process.stdin.pause()
      process.stderr.write('\n')
      if (error) reject(error); else resolve(value)
    }
    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') return done(new Error('Cancelado.'))
        if (character === '\r' || character === '\n') return done()
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else if (character >= ' ') value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

try {
  if (!process.env.TTS_OPERATOR_PASSPHRASE) process.env.TTS_OPERATOR_PASSPHRASE = await readPrivatePassphrase()
  const link = createTtsDeviceLink(origin)
  process.stdout.write(`\nAbre este enlace privado en tu navegador habitual dentro de 10 minutos.\nNo lo compartas ni lo guardes en Git.\n\n${link}\n`)
} catch {
  process.stderr.write('No se pudo crear el enlace. Usa la clave TTS existente de al menos 32 caracteres y una URL HTTPS.\n')
  process.exitCode = 1
} finally { delete process.env.TTS_OPERATOR_PASSPHRASE }
