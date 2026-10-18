import { useEffect, useState } from 'react'
import { getTtsSession, loginTts, logoutTts } from '../lib/ttsAccessClient.js'

export default function TtsSessionPanel() {
  const [status, setStatus] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getTtsSession().then(setStatus).catch(() => setError('No se pudo comprobar el acceso al audio.')) }, [])
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await loginTts(password); setPassword(''); setStatus(await getTtsSession()) }
    catch (cause) { setError(cause.message); setPassword('') }
    finally { setBusy(false) }
  }
  async function logout() {
    setBusy(true); setError('')
    try { await logoutTts(); setStatus(await getTtsSession()) }
    catch (cause) { setError(cause.message) }
    finally { setBusy(false) }
  }
  return <section className="panel" aria-label="Acceso al audio">
    <h2>Acceso al audio</h2>
    {status?.authenticated ? <p>Sesión del operador activa para solicitar MP3.</p> :
      <p>{status?.configured === false ? 'El acceso de operadores aún no está configurado en el servidor.' : 'Inicia sesión como operador antes de generar audios.'}</p>}
    {status?.authenticated ? <button type="button" disabled={busy} onClick={logout}>Cerrar sesión de audio</button> :
      <form onSubmit={login}>
        <label>Contraseña del operador <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button type="submit" disabled={busy || !password}>Acceder al audio</button>
      </form>}
    {error && <p role="alert">{error}</p>}
  </section>
}
