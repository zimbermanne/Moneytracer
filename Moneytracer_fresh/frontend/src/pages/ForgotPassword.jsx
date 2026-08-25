import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '../api-config.js'
import PlatformBanner from '../components/PlatformBanner.jsx'
import logoMark from '../assets/logo-mark.png'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Once the request succeeds we show a generic confirmation and stop
  // showing the form — matches the backend's intentionally generic
  // response (it never reveals whether the account existed).
  const [submitted, setSubmitted] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch(apiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username_or_email: identifier }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Something went wrong. Please try again.')
      }
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-orb login-orb-shadow login-orb-1" />
      <div className="login-orb login-orb-shadow login-orb-2" />
      <div className="login-orb login-orb-glass login-orb-3" />
      <div className="login-orb login-orb-glass login-orb-4" />
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 20 }}>
        <PlatformBanner />
      </div>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="login-brand">
          <img src={logoMark} alt="Moneytracer" className="login-brand-mark" />
          <div className="login-brand-name">Moneytracer</div>
        </div>

        <div className="login-card">
          {submitted ? (
            <>
              <h1>Check your email</h1>
              <div className="sub">
                If an account matches <strong>{identifier}</strong>, we've sent password
                reset instructions to the email on file. The link expires in 30 minutes.
              </div>
            </>
          ) : (
            <>
              <h1>Forgot password?</h1>
              <div className="sub">Enter your username or email and we'll send you a reset link.</div>
              <form onSubmit={submit}>
                <div className="form-row">
                  <label>Username or email</label>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error && <div className="error-text">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}

          <div style={{ marginTop: 20, fontSize: 13, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>Back to sign in</Link>
          </div>
        </div>

        <div className="login-tagline">{t('auth.tagline')}</div>
      </div>
    </div>
  )
}
