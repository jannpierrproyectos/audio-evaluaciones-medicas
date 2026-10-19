import { useEffect, useState } from 'react'
import { getTtsSession, logoutTts } from '../lib/ttsAccessClient.js'

const messages = {
  account: 'Esa cuenta no tiene acceso. Continúa con la cuenta de Google autorizada.',
  signin: 'No se completó el acceso con Google. Puedes intentarlo de nuevo.',
  configuration: 'La conexión con Google está pendiente de configuración en el servidor.',
}

export default function GoogleAccess() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(() => messages[new URLSearchParams(window.location.search).get('auth_error')] || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const url = new URL(window.location.href)
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    getTtsSession().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setError('No se pudo comprobar el acceso. Recarga la página para reintentar.') })
    return () => { active = false }
  }, [])
  if (status?.provider !== 'google' && !error) return null
  return <section className="google-access" aria-label="Cuenta de Google">
    <div><strong>{status?.authenticated ? 'Cuenta conectada' : 'Accede al audio con Google'}</strong>
      <p>{status?.authenticated ? status.email : status?.configured ? 'Usa tu cuenta autorizada desde cualquier equipo.' : 'Falta completar la conexión de Google en el servidor.'}</p>
      {error && <p className="inline-feedback is-error" role="alert">{error}</p>}
    </div>
    {status?.authenticated ? <button type="button" className="secondary-button" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await logoutTts(); setStatus(await getTtsSession()) }
      catch { setError('No se pudo cerrar la sesión. Inténtalo nuevamente.') }
      finally { setBusy(false) }
    }}>Cerrar sesión</button> : status?.configured ? <a className="google-signin" href="/api/auth/google">Continuar con Google</a> : null}
  </section>
}
