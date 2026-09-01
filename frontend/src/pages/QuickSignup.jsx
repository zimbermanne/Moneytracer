import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import logoMark from '../assets/logo-mark.png'

/**
 * Reached by scanning the quick-signup QR/barcode (see Settings > Sign-up QR
 * code, and GET /api/auth/quick-signup/qr). Needs no input from the user:
 * it fires POST /api/auth/quick-signup on mount, which creates a brand-new
 * account and logs the scanner straight in, then drops them on the
 * dashboard where a banner nudges them to fill in their details later.
 */
export default function QuickSignup() {
  const { quickSignup, user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (user) {
      navigate('/app', { replace: true })
      return
    }
    if (started.current) return
    started.current = true
    quickSignup()
      .then(() => navigate('/app', { replace: true }))
      .catch((err) => setError(err.message))
  }, [user, quickSignup, navigate])

  return (
    <div className="login-screen">
      <div className="login-orb login-orb-shadow login-orb-1" />
      <div className="login-orb login-orb-shadow login-orb-2" />
      <div className="login-orb login-orb-glass login-orb-3" />
      <div className="login-orb login-orb-glass login-orb-4" />
      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <div className="login-brand">
          <img src={logoMark} alt="Moneytracer" className="login-brand-mark" />
          <div className="login-brand-name">Moneytracer</div>
        </div>
        <div className="login-card">
          {error ? (
            <>
              <h1>{t('auth.quickSignupFailedTitle', 'Something went wrong')}</h1>
              <div className="error-text" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => navigate('/login', { replace: true })}>
                {t('auth.backToLogin', 'Back to login')}
              </button>
            </>
          ) : (
            <>
              <h1>{t('auth.quickSignupSettingUp', 'Setting up your account…')}</h1>
              <div className="sub">{t('auth.quickSignupSubtitle', "You'll be able to add your name and business details afterwards.")}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
