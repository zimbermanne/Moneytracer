import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../components/LanguageSwitcher'

function FeatureGrid({ features }) {
  return (
    <div className="landing-grid">
      {features.map((f) => (
        <div className="landing-feature-card" key={f.title}>
          <div className="landing-feature-icon">{f.icon}</div>
          <div className="landing-feature-title">{f.title}</div>
          <div className="landing-feature-text">{f.text}</div>
        </div>
      ))}
    </div>
  )
}

export default function Landing() {
  const [track, setTrack] = useState('business')
  const { t } = useTranslation()

  // Feature arrays come straight from the translation file, so they
  // automatically switch language along with everything else.
  const businessFeatures = t('landing.businessFeatures', { returnObjects: true })
  const communityFeatures = t('landing.communityFeatures', { returnObjects: true })
  const personalFeatures = t('landing.personalFeatures', { returnObjects: true })

  const ctaLabel = {
    business: t('landing.ctaBusiness'),
    community: t('landing.ctaCommunity'),
    personal: t('landing.ctaPersonal'),
  }[track]

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="landing-brand">
            <span className="landing-brand-mark">M</span>
            <span className="landing-brand-name">Moneytracer</span>
          </div>
          <nav className="landing-nav">
            <a href="#features">{t('landing.navFeatures')}</a>
            <Link to="/download">{t('landing.navDownload')}</Link>
            <a href="#about">{t('landing.navAbout')}</a>
            <a href="#pricing">{t('landing.navPricing')}</a>
            <Link to="/login" className="landing-nav-login">{t('landing.login')}</Link>
            <Link to="/register" className="landing-nav-cta">{t('landing.getStarted')}</Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <h1>{t('landing.heroTitle')}</h1>
          <p className="landing-hero-sub">{t('landing.heroSub')}</p>

          <div className="landing-track-switch">
            <button
              className={track === 'business' ? 'active' : ''}
              onClick={() => setTrack('business')}
            >
              {t('landing.trackBusiness')}
            </button>
            <button
              className={track === 'community' ? 'active' : ''}
              onClick={() => setTrack('community')}
            >
              {t('landing.trackCommunity')}
            </button>
            <button
              className={track === 'personal' ? 'active' : ''}
              onClick={() => setTrack('personal')}
            >
              {t('landing.trackPersonal')}
            </button>
          </div>

          <div className="landing-hero-actions">
            <Link to={`/register?track=${track}`} className="landing-btn-primary">
              {ctaLabel}
            </Link>
            <Link to="/login" className="landing-btn-secondary">{t('landing.alreadyHaveAccount')}</Link>
          </div>

          <Link to="/download" className="landing-app-download">
            <span className="landing-app-download-icon">⬇</span>
            {t('landing.downloadAndroid')}
          </Link>
        </div>
      </section>

      {track === 'business' && (
        <section id="features" className="landing-section">
          <h2>{t('landing.businessFeaturesTitle')}</h2>
          <p className="landing-section-sub">{t('landing.businessFeaturesSub')}</p>
          <FeatureGrid features={businessFeatures} />
        </section>
      )}

      {track === 'community' && (
        <section id="community" className="landing-section">
          <h2>{t('landing.communityFeaturesTitle')}</h2>
          <p className="landing-section-sub">{t('landing.communityFeaturesSub')}</p>
          <FeatureGrid features={communityFeatures} />
        </section>
      )}

      {track === 'personal' && (
        <section id="personal" className="landing-section">
          <h2>{t('landing.personalFeaturesTitle')}</h2>
          <p className="landing-section-sub">{t('landing.personalFeaturesSub')}</p>
          <FeatureGrid features={personalFeatures} />
        </section>
      )}

      <section className="landing-section landing-section-alt">
        <h2>{t('landing.oneAccountTitle')}</h2>
        <p className="landing-section-sub">{t('landing.oneAccountSub')}</p>
        <div className="landing-grid landing-grid-three">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🏪</div>
            <div className="landing-feature-title">{t('landing.accountBusinessTitle')}</div>
            <div className="landing-feature-text">{t('landing.accountBusinessText')}</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🌿</div>
            <div className="landing-feature-title">{t('landing.accountCommunityTitle')}</div>
            <div className="landing-feature-text">{t('landing.accountCommunityText')}</div>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">👛</div>
            <div className="landing-feature-title">{t('landing.accountPersonalTitle')}</div>
            <div className="landing-feature-text">{t('landing.accountPersonalText')}</div>
          </div>
        </div>
      </section>

      <section id="about" className="landing-section landing-about">
        <div className="landing-about-grid">
          <div className="landing-about-copy">
            <h2>{t('landing.aboutTitle')}</h2>
            <p>{t('landing.aboutP1')}</p>
            <p>{t('landing.aboutP2')}</p>
            <div className="landing-about-stats">
              <div className="landing-about-stat">
                <div className="landing-about-stat-value">54</div>
                <div className="landing-about-stat-label">{t('landing.statCountries')}</div>
              </div>
              <div className="landing-about-stat">
                <div className="landing-about-stat-value">3</div>
                <div className="landing-about-stat-label">{t('landing.statAccountTypes')}</div>
              </div>
              <div className="landing-about-stat">
                <div className="landing-about-stat-value">1</div>
                <div className="landing-about-stat-label">{t('landing.statDashboard')}</div>
              </div>
            </div>
          </div>
          <div className="landing-about-values">
            <div className="landing-about-value-card">
              <div className="landing-feature-icon">🎯</div>
              <div className="landing-feature-title">{t('landing.valueSimpleTitle')}</div>
              <div className="landing-feature-text">{t('landing.valueSimpleText')}</div>
            </div>
            <div className="landing-about-value-card">
              <div className="landing-feature-icon">🔒</div>
              <div className="landing-feature-title">{t('landing.valueDataTitle')}</div>
              <div className="landing-feature-text">{t('landing.valueDataText')}</div>
            </div>
            <div className="landing-about-value-card">
              <div className="landing-feature-icon">🌍</div>
              <div className="landing-feature-title">{t('landing.valueAfricaTitle')}</div>
              <div className="landing-feature-text">{t('landing.valueAfricaText')}</div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="landing-section landing-cta-band">
        <h2>{t('landing.pricingTitle')}</h2>
        <p className="landing-section-sub">{t('landing.pricingSub')}</p>
        <Link to={`/register?track=${track}`} className="landing-btn-primary">{t('landing.getStartedFree')}</Link>

        <div className="landing-beta-notice">
          <div className="landing-beta-badge">{t('landing.betaBadge')}</div>
          <p>
            {t('landing.betaNoticeP1')} <strong>{t('landing.betaNoticeDays')}</strong> {t('landing.betaNoticeP2')}
          </p>
        </div>
      </section>

      <section className="landing-section landing-disclaimer">
        <h2>{t('landing.disclaimerTitle')}</h2>
        <div className="landing-disclaimer-text">
          <p>{t('landing.disclaimerText')}</p>
          <Link to="/legal" className="landing-legal-link">{t('landing.readFullTerms')}</Link>
          <p className="landing-disclaimer-note">{t('landing.availableInLanguages')}</p>
        </div>
      </section>

      <footer className="landing-footer">
        <div>© {new Date().getFullYear()} {t('landing.copyright')}</div>
        <div className="landing-footer-links">
          <Link to="/login">{t('landing.logInLink')}</Link>
          <Link to="/register">{t('landing.signUpLink')}</Link>
          <a href="https://instagram.com/zimbermanne_studios" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://facebook.com/moneytracer" target="_blank" rel="noopener noreferrer">Facebook</a>
        </div>
      </footer>
    </div>
  )
}
