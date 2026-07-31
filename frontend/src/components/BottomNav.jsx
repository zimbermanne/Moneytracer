import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

// Primary destinations only — this sits alongside the hamburger drawer
// (which still holds the full nav), giving phone users the one-tap-away
// muscle memory of a real app's tab bar instead of two taps through a
// slide-out menu for the things they reach for constantly.
function buildTabs(t) {
  return [
    { label: t('nav.home'), icon: '🏠', path: '/app', match: (p) => p === '/app' },
    { label: t('nav.pos'), icon: '🧾', path: '/app/pos', accountTypes: ['business', 'community'], match: (p) => p === '/app/pos' },
    { label: t('nav.salesHistory'), icon: '📜', path: '/app/sales', accountTypes: ['business', 'community'], match: (p) => p.startsWith('/app/sales') },
    { label: t('nav.clientsDebtors'), icon: '📒', path: '/app/debtors', match: (p) => p.startsWith('/app/debtors') },
  ]
}

export default function BottomNav({ onMore }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { account } = useAuth()
  const { t } = useTranslation()

  const tabs = buildTabs(t).filter(
    (tab) => !tab.accountTypes || tab.accountTypes.includes(account?.account_type)
  )

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          type="button"
          className={`bottom-nav-item ${tab.match(location.pathname) ? 'active' : ''}`}
          onClick={() => guardedNavigate(tab.path)}
        >
          <span className="bottom-nav-icon">{tab.icon}</span>
          <span className="bottom-nav-label">{tab.label}</span>
        </button>
      ))}
      <button type="button" className="bottom-nav-item" onClick={onMore}>
        <span className="bottom-nav-icon">☰</span>
        <span className="bottom-nav-label">{t('nav.more', 'More')}</span>
      </button>
    </nav>
  )
}
