import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import PasswordInput from '../components/PasswordInput.jsx'

export default function Login() {
  const { login, loginAsDemo, user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)

  if (user) {
    navigate('/app', { replace: true })
    return null
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username, password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const tryDemo = async () => {
    setError('')
    setDemoBusy(true)
    try {
      await loginAsDemo()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="login-brand">
          <div className="login-brand-mark">M</div>
          <div className="login-brand-name">Moneytracer</div>
        </div>

        <div className="login-card">
          <h1>{t('auth.welcomeBack')}</h1>
          <div className="sub">{t('auth.signInSubtitle')}</div>
          <form onSubmit={submit}>
            <div className="form-row">
              <label>{t('auth.username')}</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="form-row">
              <label>{t('auth.password')}</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{t('common.or')}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <button className="btn btn-outline" style={{ width: '100%' }} onClick={tryDemo} disabled={demoBusy}>
            {demoBusy ? t('auth.loadingDemo') : t('auth.continueAsDemo')}
          </button>

          <div style={{ marginTop: 20, fontSize: 13, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('auth.dontHaveAccount')} <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('auth.createOne')}</Link>
          </div>
        </div>

        <div className="login-tagline">{t('auth.tagline')}</div>
      </div>
    </div>
  )
}
