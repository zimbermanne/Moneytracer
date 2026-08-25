import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiUrl } from '../api-config.js'
import PasswordInput from '../components/PasswordInput.jsx'
import logoMark from '../assets/logo-mark.png'
import PlatformBanner from '../components/PlatformBanner.jsx'

export default function ResetPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match")
      return
    }
    setBusy(true)
    try {
      const res = await fetch(apiUrl('/api/auth/reset-password-confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'This reset link is invalid or has expired. Please request a new one.')
      }
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
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
          {!token ? (
            <>
              <h1>Invalid link</h1>
              <div className="sub">This reset link is missing its token. Please request a new one.</div>
            </>
          ) : done ? (
            <>
              <h1>Password updated</h1>
              <div className="sub">Redirecting you to sign in…</div>
            </>
          ) : (
            <>
              <h1>Choose a new password</h1>
              <div className="sub">Enter and confirm your new password below.</div>
              <form onSubmit={submit}>
                <div className="form-row">
                  <label>New password</label>
                  <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoFocus autoComplete="new-password" />
                </div>
                <div className="form-row">
                  <label>Confirm new password</label>
                  <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
                </div>
                {error && <div className="error-text">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
                  {busy ? 'Updating…' : 'Update password'}
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
