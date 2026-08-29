import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../components/LanguageSwitcher'

/* ── Animated blob background ─────────────────────────────────────────────── */
function BlobBackground() {
  return (
    <div className="lg-blobs" aria-hidden="true">
      <div className="lg-blob lg-blob-1" />
      <div className="lg-blob lg-blob-2" />
      <div className="lg-blob lg-blob-3" />
      <div className="lg-blob lg-blob-4" />
      <div className="lg-blob lg-blob-5" />
    </div>
  )
}

/* ── Glass card ──────────────────────────────────────────────────────────── */
function GlassCard({ children, className = '', style = {}, onClick }) {
  return (
    <div className={`lg-glass-card ${className}`} style={style} onClick={onClick}>
      {children}
    </div>
  )
}

/* ── Feature grid ────────────────────────────────────────────────────────── */
function FeatureGrid({ features }) {
  return (
    <div className="lg-feature-grid">
      {features.map((f) => (
        <GlassCard key={f.title} className="lg-feature-card">
          <div className="lg-feature-icon">{f.icon}</div>
          <div className="lg-feature-title">{f.title}</div>
          <div className="lg-feature-text">{f.text}</div>
        </GlassCard>
      ))}
    </div>
  )
}

/* ── Floating stat pill ──────────────────────────────────────────────────── */
function StatPill({ value, label }) {
  return (
    <div className="lg-stat-pill">
      <span className="lg-stat-value">{value}</span>
      <span className="lg-stat-label">{label}</span>
    </div>
  )
}

/* ── Main Landing ────────────────────────────────────────────────────────── */
export default function Landing() {
  const [track, setTrack] = useState('business')
  const [scrolled, setScrolled] = useState(false)
  const { t } = useTranslation()

  const businessFeatures  = t('landing.features.business',  { returnObjects: true })
  const communityFeatures = t('landing.features.community', { returnObjects: true })
  const personalFeatures  = t('landing.features.personal',  { returnObjects: true })

  const ctaLabel = {
    business:  t('landing.ctaBusiness'),
    community: t('landing.ctaCommunity'),
    personal:  t('landing.ctaPersonal'),
  }[track]

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="lg-page">
      <style>{`
        /* ── CSS reset for this page ── */
        .lg-page *, .lg-page *::before, .lg-page *::after { box-sizing: border-box; }

        /* ── Page base ── */
        .lg-page {
          min-height: 100vh;
          font-family: var(--font-body);
          color: #fff;
          overflow-x: hidden;
          background: #0a0a1a url('../assets/hero-bg.jpg') no-repeat center center fixed;
          background-size: cover;
          position: relative;
        }

        /* ── Gradient Overlay ── */
        .lg-page::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(88, 28, 135, 0.4) 0%, rgba(249, 115, 22, 0.3) 100%);
          z-index: 1;
          pointer-events: none;
        }

        /* ── Animated blob backdrop ── */
        .lg-blobs {
          position: fixed;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          overflow: hidden;
        }
        .lg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.25;
          animation: lg-drift 18s ease-in-out infinite alternate;
        }
        .lg-blob-1 { width: 600px; height: 600px; background: radial-gradient(circle, #6c3bfa, #3b1fa8); top: -150px; left: -100px; animation-duration: 20s; }
        .lg-blob-2 { width: 500px; height: 500px; background: radial-gradient(circle, #1aa3ff, #005fa3); top: 40%; right: -80px; animation-duration: 16s; animation-delay: -5s; }
        .lg-blob-3 { width: 420px; height: 420px; background: radial-gradient(circle, #ff6db0, #c1002d); bottom: 10%; left: 15%; animation-duration: 22s; animation-delay: -8s; }
        .lg-blob-4 { width: 350px; height: 350px; background: radial-gradient(circle, #00d4aa, #007a5e); top: 20%; left: 40%; animation-duration: 25s; animation-delay: -3s; opacity: 0.35; }
        .lg-blob-5 { width: 280px; height: 280px; background: radial-gradient(circle, #ffc947, #e07800); bottom: 25%; right: 20%; animation-duration: 19s; animation-delay: -11s; opacity: 0.4; }

        @keyframes lg-drift {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(40px, -30px) scale(1.08); }
          66%  { transform: translate(-20px, 40px) scale(0.95); }
          100% { transform: translate(30px, 20px) scale(1.05); }
        }

        /* ── Glass surface utility ── */
        .lg-glass {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
        }
        .lg-glass-card {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 20px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.2);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .lg-glass-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 16px 48px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.25);
        }

        /* ── Header ── */
        .lg-header {
          position: sticky;
          top: 0;
          z-index: 100;
          transition: background 0.3s ease, box-shadow 0.3s ease;
        }
        .lg-header.scrolled {
          background: rgba(10,10,26,0.72);
          border-bottom: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        }
        .lg-header-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .lg-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          color: #fff;
        }
        .lg-brand-mark {
          width: 38px; height: 38px;
          border-radius: 10px;
          background: #f59e0b;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 20px; color: #fff;
          box-shadow: 0 4px 12px rgba(245,158,11,0.3);
        }
        .lg-brand-name {
          font-size: 20px; font-weight: 700; letter-spacing: -0.3px;
        }
        .lg-nav {
          display: flex; align-items: center; gap: 40px;
          font-size: 14px;
        }
        .lg-nav a {
          color: rgba(255,255,255,0.85);
          text-decoration: none;
          transition: color 0.15s;
          font-weight: 500;
        }
        .lg-nav a:hover { color: #fff; }
        .lg-nav-login {
          color: #fff !important;
          font-weight: 600;
        }
        .lg-nav-cta {
          background: #f59e0b !important;
          color: #fff !important;
          padding: 10px 24px;
          border-radius: 12px;
          font-weight: 700;
          box-shadow: 0 4px 14px rgba(245,158,11,0.4);
          transition: transform 0.15s !important;
        }
        .lg-nav-cta:hover { transform: translateY(-1px); background: #fbbf24 !important; }

        /* ── Hero ── */
        .lg-hero {
          position: relative;
          z-index: 10;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 120px 24px 80px;
        }
        .lg-hero-inner { max-width: 840px; margin: 0 auto; }
        .lg-hero-badge {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(124, 58, 237, 0.25);
          border: 1px solid rgba(139, 92, 246, 0.4);
          border-radius: 999px;
          padding: 6px 18px;
          font-size: 13px; font-weight: 600; color: #d8b4fe;
          margin-bottom: 32px;
        }
        .lg-hero-badge-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #8b5cf6;
          box-shadow: 0 0 10px #8b5cf6;
        }

        .lg-hero h1 {
          font-family: var(--font-display);
          font-size: clamp(2.8rem, 7vw, 4.8rem);
          font-weight: 700;
          line-height: 1.1;
          margin: 0 0 28px;
          color: #fff;
          letter-spacing: -1px;
        }
        .lg-hero-sub {
          font-size: clamp(1.1rem, 2.2vw, 1.3rem);
          color: rgba(255,255,255,0.8);
          line-height: 1.6;
          margin: 0 auto 48px;
          max-width: 680px;
        }

        /* ── Track switch ── */
        .lg-track-switch {
          display: inline-flex;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          padding: 6px;
          margin-bottom: 40px;
          backdrop-filter: blur(8px);
        }
        .lg-track-switch button {
          border: none;
          background: transparent;
          padding: 12px 24px;
          border-radius: 999px;
          font-size: 14px; font-weight: 600;
          color: rgba(255,255,255,0.6);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .lg-track-switch button.active {
          background: #f59e0b;
          color: #fff;
          box-shadow: 0 4px 12px rgba(245,158,11,0.4);
        }

        /* ── CTA buttons ── */
        .lg-hero-actions {
          display: flex; align-items: center; justify-content: center;
          gap: 20px; flex-wrap: wrap; margin-bottom: 40px;
        }
        .lg-btn-primary {
          display: inline-flex; align-items: center; gap: 10px;
          background: #f59e0b;
          color: #fff;
          text-decoration: none;
          font-weight: 700; font-size: 18px;
          padding: 16px 36px;
          border-radius: 14px;
          box-shadow: 0 6px 20px rgba(245,158,11,0.4);
          transition: transform 0.15s, background 0.15s;
        }
        .lg-btn-primary:hover {
          transform: translateY(-2px);
          background: #fbbf24;
          color: #fff;
        }
        .lg-btn-secondary {
          display: inline-flex; align-items: center;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.25);
          color: #fff;
          text-decoration: none;
          font-weight: 600; font-size: 16px;
          padding: 16px 32px;
          border-radius: 14px;
          transition: background 0.15s;
          backdrop-filter: blur(4px);
        }
        .lg-btn-secondary:hover {
          background: rgba(255,255,255,0.15);
        }

        /* ── Android download pill ── */
        .lg-app-download {
          display: inline-flex; align-items: center; gap: 10px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.8);
          text-decoration: none;
          font-size: 14px; font-weight: 600;
          padding: 11px 22px;
          border-radius: 999px;
          transition: background 0.15s;
        }
        .lg-app-download:hover { background: rgba(255,255,255,0.14); color: #fff; }

        /* ── Floating stat pills (hero) ── */
        .lg-hero-stats {
          display: flex; justify-content: center; gap: 16px;
          flex-wrap: wrap; margin-top: 48px;
        }
        .lg-stat-pill {
          display: flex; flex-direction: column; align-items: center;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 16px;
          padding: 16px 28px;
          min-width: 120px;
        }
        .lg-stat-value {
          font-size: 2rem; font-weight: 900;
          color: #fff;
          line-height: 1;
        }
        .lg-stat-label {
          font-size: 12px; color: rgba(255,255,255,0.55);
          margin-top: 6px; text-align: center; line-height: 1.3;
        }

        /* ── Sections ── */
        .lg-section {
          position: relative; z-index: 1;
          max-width: 1200px;
          margin: 0 auto;
          padding: 80px 28px;
          text-align: center;
        }
        .lg-section-full {
          max-width: none;
          padding-left: 0; padding-right: 0;
        }
        .lg-section-alt {
          background: rgba(255,255,255,0.03);
          border-top: 1px solid rgba(255,255,255,0.08);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .lg-section h2 {
          font-size: clamp(1.8rem, 4vw, 2.8rem);
          font-weight: 900;
          margin: 0 0 14px;
          background: linear-gradient(135deg, #fff 40%, rgba(180,160,255,0.8));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          letter-spacing: -0.5px;
        }
        .lg-section-sub {
          color: rgba(255,255,255,0.55);
          max-width: 560px;
          margin: 0 auto 48px;
          line-height: 1.7;
          font-size: 15px;
        }

        /* ── Feature grid ── */
        .lg-feature-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          text-align: left;
        }
        .lg-feature-card { padding: 28px; }
        .lg-feature-icon { font-size: 30px; margin-bottom: 14px; }
        .lg-feature-title { font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #fff; }
        .lg-feature-text { color: rgba(255,255,255,0.55); font-size: 13px; line-height: 1.65; }

        /* ── 3-column account type cards ── */
        .lg-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          max-width: 960px;
          margin: 0 auto;
          text-align: left;
        }

        /* ── About section ── */
        .lg-about-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 48px;
          text-align: left;
          align-items: start;
        }
        .lg-about-copy p {
          color: rgba(255,255,255,0.6);
          line-height: 1.75; margin: 0 0 16px; font-size: 15px;
        }
        .lg-about-stats {
          display: flex; gap: 32px; margin-top: 32px; flex-wrap: wrap;
        }
        .lg-about-stat-value {
          font-size: 2.4rem; font-weight: 900;
          background: linear-gradient(135deg, #7c5cfc, #3b82f6);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          line-height: 1; margin-bottom: 6px;
        }
        .lg-about-stat-label {
          color: rgba(255,255,255,0.5); font-size: 13px; max-width: 120px; line-height: 1.4;
        }
        .lg-about-values { display: flex; flex-direction: column; gap: 16px; }
        .lg-about-value-card { padding: 22px; }

        /* ── Beta notice ── */
        .lg-beta-notice {
          max-width: 640px; margin: 32px auto 0;
          display: flex; gap: 16px; align-items: flex-start;
          text-align: left; padding: 22px 26px;
        }
        .lg-beta-badge {
          flex: 0 0 auto;
          background: linear-gradient(135deg, #7c5cfc, #3b82f6);
          color: #fff; font-size: 12px; font-weight: 700;
          padding: 5px 14px; border-radius: 999px;
        }
        .lg-beta-notice p {
          color: rgba(255,255,255,0.6); font-size: 13px; line-height: 1.6; margin: 0;
        }

        /* ── Disclaimer ── */
        .lg-disclaimer { max-width: none; }
        .lg-disclaimer-text { max-width: 720px; margin: 0 auto; text-align: left; }
        .lg-disclaimer-text p { color: rgba(255,255,255,0.5); font-size: 13px; line-height: 1.75; margin: 0 0 16px; }
        .lg-disclaimer-note { font-style: italic; opacity: 0.7; }
        .lg-legal-link { display: inline-block; color: #a78bfa; font-weight: 600; text-decoration: none; margin-bottom: 12px; }
        .lg-legal-link:hover { text-decoration: underline; }

        /* ── CTA band ── */
        .lg-cta-band { padding-bottom: 100px; }
        .lg-cta-band h2 { margin-bottom: 14px; }

        /* ── Footer ── */
        .lg-footer {
          position: relative; z-index: 1;
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 28px 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          color: rgba(255,255,255,0.4);
          font-size: 13px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .lg-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
        .lg-footer-links a { color: rgba(255,255,255,0.4); text-decoration: none; }
        .lg-footer-links a:hover { color: rgba(255,255,255,0.8); }

        /* ── Language switcher overrides ── */
        .lg-page .language-switcher {
          background: #f59e0b;
          border-color: #f59e0b;
          color: #fff;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(245,158,11,0.3);
          border-radius: 10px;
          cursor: pointer;
        }
        .lg-page .language-switcher:hover {
          background: #fbbf24;
          border-color: #fbbf24;
        }
        .lg-page .language-switcher option {
          background: #1a1d27;
          color: #fff;
        }

        /* ── Responsive ── */
        @media (max-width: 860px) {
          .lg-feature-grid { grid-template-columns: 1fr 1fr; }
          .lg-grid-3 { grid-template-columns: 1fr; }
          .lg-about-grid { grid-template-columns: 1fr; }
          .lg-footer { flex-direction: column; align-items: flex-start; }
        }
        @media (max-width: 580px) {
          .lg-feature-grid { grid-template-columns: 1fr; }
          .lg-nav a:not(.lg-nav-login):not(.lg-nav-cta) { display: none; }
          .lg-nav { gap: 14px; }
          .lg-track-switch { flex-wrap: wrap; justify-content: center; }
          .lg-track-switch button { padding: 8px 14px; font-size: 12px; }
          .lg-hero-actions { flex-direction: column; align-items: stretch; width: 100%; max-width: 320px; margin-left: auto; margin-right: auto; }
          .lg-btn-primary, .lg-btn-secondary { text-align: center; justify-content: center; width: 100%; }
          .lg-hero-stats { gap: 10px; }
          .lg-stat-pill { padding: 12px 18px; min-width: 90px; }
        }
      `}</style>

      <BlobBackground />

      {/* ── Header ── */}
      <header className={`lg-header${scrolled ? ' scrolled' : ''}`}>
        <div className="lg-header-inner">
          <Link to="/" className="lg-brand">
            <div className="lg-brand-mark">M</div>
            <span className="lg-brand-name">Moneytracer</span>
          </Link>
          <nav className="lg-nav">
            <a href="#features">{t('landing.navFeatures')}</a>
            <Link to="/download">{t('landing.navDownload')}</Link>
            <Link to="/faq">FAQ</Link>
            <a href="#about">{t('landing.navAbout')}</a>
            <a href="#pricing">{t('landing.navPricing')}</a>
            <Link to="/login" className="lg-nav-login">{t('landing.login')}</Link>
            <Link to="/register" className="lg-nav-cta">{t('landing.getStarted')}</Link>
            <div style={{ marginLeft: '12px' }}>
              <LanguageSwitcher />
            </div>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lg-hero">
        <div className="lg-hero-inner">
          <div className="lg-hero-badge">
            <span className="lg-hero-badge-dot" />
            Now in Beta — Free during launch
          </div>

          <h1>{t('landing.heroTitle')}</h1>
          <p className="lg-hero-sub">{t('landing.heroSub')}</p>

          <div className="lg-track-switch">
            <button className={track === 'business'  ? 'active' : ''} onClick={() => setTrack('business')}>
              {t('landing.trackBusiness')}
            </button>
            <button className={track === 'community' ? 'active' : ''} onClick={() => setTrack('community')}>
              {t('landing.trackCommunity')}
            </button>
            <button className={track === 'personal'  ? 'active' : ''} onClick={() => setTrack('personal')}>
              {t('landing.trackPersonal')}
            </button>
          </div>

          <div className="lg-hero-actions">
            <Link to={`/register?track=${track}`} className="lg-btn-primary">
              + {ctaLabel}
            </Link>
            <Link to="/login" className="lg-btn-secondary">{t('landing.alreadyHaveAccount')}</Link>
          </div>

          <Link to="/download" className="lg-app-download">
            <span>⬇</span> {t('landing.downloadAndroid')}
          </Link>

          <div className="lg-hero-stats">
            <StatPill value="54" label={t('landing.statCountries')} />
            <StatPill value="3"  label={t('landing.statAccountTypes')} />
            <StatPill value="1"  label={t('landing.statDashboard')} />
            <StatPill value="∞"  label="Transactions tracked" />
          </div>
        </div>
      </section>

      {/* ── Features section ── */}
      {track === 'business' && (
        <section id="features" className="lg-section">
          <h2>{t('landing.businessFeaturesTitle')}</h2>
          <p className="lg-section-sub">{t('landing.businessFeaturesSub')}</p>
          <FeatureGrid features={t('landing.businessFeatures', { returnObjects: true })} />
        </section>
      )}
      {track === 'community' && (
        <section id="community" className="lg-section">
          <h2>{t('landing.communityFeaturesTitle')}</h2>
          <p className="lg-section-sub">{t('landing.communityFeaturesSub')}</p>
          <FeatureGrid features={t('landing.communityFeatures', { returnObjects: true })} />
        </section>
      )}
      {track === 'personal' && (
        <section id="personal" className="lg-section">
          <h2>{t('landing.personalFeaturesTitle')}</h2>
          <p className="lg-section-sub">{t('landing.personalFeaturesSub')}</p>
          <FeatureGrid features={t('landing.personalFeatures', { returnObjects: true })} />
        </section>
      )}

      {/* ── One account, three worlds ── */}
      <section className="lg-section lg-section-alt lg-section-full" style={{ padding: '80px 28px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2>{t('landing.oneAccountTitle')}</h2>
          <p className="lg-section-sub">{t('landing.oneAccountSub')}</p>
          <div className="lg-grid-3">
            <GlassCard className="lg-feature-card">
              <div className="lg-feature-icon">🏪</div>
              <div className="lg-feature-title">{t('landing.accountBusinessTitle')}</div>
              <div className="lg-feature-text">{t('landing.accountBusinessText')}</div>
            </GlassCard>
            <GlassCard className="lg-feature-card" style={{ border: '1px solid rgba(124,92,252,0.45)', background: 'rgba(124,92,252,0.12)' }}>
              <div className="lg-feature-icon">🌿</div>
              <div className="lg-feature-title">{t('landing.accountCommunityTitle')}</div>
              <div className="lg-feature-text">{t('landing.accountCommunityText')}</div>
            </GlassCard>
            <GlassCard className="lg-feature-card">
              <div className="lg-feature-icon">👛</div>
              <div className="lg-feature-title">{t('landing.accountPersonalTitle')}</div>
              <div className="lg-feature-text">{t('landing.accountPersonalText')}</div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* ── About ── */}
      <section id="about" className="lg-section">
        <div className="lg-about-grid">
          <div className="lg-about-copy">
            <h2 style={{ textAlign: 'left' }}>{t('landing.aboutTitle')}</h2>
            <p>{t('landing.aboutP1')}</p>
            <p>{t('landing.aboutP2')}</p>
            <div className="lg-about-stats">
              <div>
                <div className="lg-about-stat-value">54</div>
                <div className="lg-about-stat-label">{t('landing.statCountries')}</div>
              </div>
              <div>
                <div className="lg-about-stat-value">3</div>
                <div className="lg-about-stat-label">{t('landing.statAccountTypes')}</div>
              </div>
              <div>
                <div className="lg-about-stat-value">1</div>
                <div className="lg-about-stat-label">{t('landing.statDashboard')}</div>
              </div>
            </div>
          </div>
          <div className="lg-about-values">
            <GlassCard className="lg-about-value-card">
              <div className="lg-feature-icon">🎯</div>
              <div className="lg-feature-title">{t('landing.valueSimpleTitle')}</div>
              <div className="lg-feature-text">{t('landing.valueSimpleText')}</div>
            </GlassCard>
            <GlassCard className="lg-about-value-card">
              <div className="lg-feature-icon">🔒</div>
              <div className="lg-feature-title">{t('landing.valueDataTitle')}</div>
              <div className="lg-feature-text">{t('landing.valueDataText')}</div>
            </GlassCard>
            <GlassCard className="lg-about-value-card">
              <div className="lg-feature-icon">🌍</div>
              <div className="lg-feature-title">{t('landing.valueAfricaTitle')}</div>
              <div className="lg-feature-text">{t('landing.valueAfricaText')}</div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* ── Pricing / CTA ── */}
      <section id="pricing" className="lg-section lg-section-alt lg-cta-band lg-section-full" style={{ padding: '100px 28px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2>{t('landing.pricingTitle')}</h2>
          <p className="lg-section-sub">{t('landing.pricingSub')}</p>
          <Link to={`/register?track=${track}`} className="lg-btn-primary" style={{ display: 'inline-flex' }}>
            + {t('landing.getStartedFree')}
          </Link>
          <GlassCard className="lg-beta-notice">
            <div className="lg-beta-badge">{t('landing.betaBadge')}</div>
            <p>{t('landing.betaNoticeP1')} <strong style={{ color: '#fff' }}>{t('landing.betaNoticeDays')}</strong> {t('landing.betaNoticeP2')}</p>
          </GlassCard>
        </div>
      </section>

      {/* ── Disclaimer ── */}
      <section className="lg-section lg-disclaimer">
        <h2>{t('landing.disclaimerTitle')}</h2>
        <div className="lg-disclaimer-text">
          <p>{t('landing.disclaimerText')}</p>
          <Link to="/legal" className="lg-legal-link">{t('landing.readFullTerms')}</Link>
          <p className="lg-disclaimer-note">{t('landing.availableInLanguages')}</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lg-footer">
        <div>© {new Date().getFullYear()} {t('landing.copyright')}</div>
        <div className="lg-footer-links">
          <Link to="/faq">FAQ</Link>
          <Link to="/login">{t('landing.logInLink')}</Link>
          <Link to="/register">{t('landing.signUpLink')}</Link>
          <Link to="/legal/tos">Terms of Service</Link>
          <Link to="/legal/privacy">Privacy Policy</Link>
          <Link to="/legal/refund">Refund Policy</Link>
          <a href="https://instagram.com/zimbermanne_studios" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://facebook.com/moneytracer" target="_blank" rel="noopener noreferrer">Facebook</a>
        </div>
      </footer>
    </div>
  )
}
