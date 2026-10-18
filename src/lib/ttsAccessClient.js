const endpoint = '/api/tts/session'
export async function getTtsSession() {
  const response = await fetch(endpoint, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('No se pudo verificar el acceso TTS.')
  return response.json()
}
export async function requireTtsSession() {
  const status = await getTtsSession()
  if (!status.authenticated) throw new Error('Inicia sesión en «Acceso al audio» antes de generar MP3; no se ha solicitado ni cobrado un audio.')
}
export async function loginTts(passphrase) {
  const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase }) })
  if (!response.ok) throw new Error('No se pudo iniciar sesión. Revisa la contraseña del operador o la configuración del backend.')
  return response.json()
}
export async function logoutTts() {
  const response = await fetch(endpoint, { method: 'DELETE', credentials: 'same-origin' })
  if (!response.ok) throw new Error('No se pudo cerrar la sesión TTS.')
  return response.json()
}
