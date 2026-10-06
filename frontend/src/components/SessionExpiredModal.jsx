import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'

/**
 * Shown on top of the app (nothing is unmounted) when the server says the
 * session has ended. The person signs back in and whatever they were doing —
 * including a half-filled form and the save they just attempted — carries on.
 */
export default function SessionExpiredModal() {
  const { sessionExpired, user, reauth, cancelReauth } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!sessionExpired) return null

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try { await reauth(password); setPassword('') }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 380, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Session expired</h3>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Sign back in as <b>{user?.username}</b> to continue. Nothing you typed has been lost.
        </div>
        <input type="password" autoFocus placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error-text">{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={cancelReauth}>Log out</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !password}>{busy ? 'Signing in…' : 'Continue'}</button>
        </div>
      </form>
    </div>
  )
}
