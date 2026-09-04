import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import { EMOJI_ICONS } from './Sidebar.jsx'

// MOBILE ONLY: fixed bottom tab bar, the standard 4-5-icon pattern (Home,
// a couple of the most-used destinations, Messages, and a "More" button
// that opens the full drawer for everything else). Deliberately NOT built
// from the full flattened sidebar nav — cramming 30+ destinations into a
// bottom bar (the previous approach) doesn't fit on a phone screen no
// matter how it's styled. Everything not shortcut here is one tap away
// via More -> the existing slide-in drawer (Sidebar.jsx mobileOpen).
// CSS lives in the "MOBILE: main phone breakpoint" block in globals.css.
function buildPrimaryItems(t, accountType) {
  const items = [
    { label: t('nav.home'), icon: 'home', path: '/app' },
  ]
  if (accountType === 'business') {
    items.push(
      { label: t('nav.pos'), icon: 'point-of-sale', path: '/app/pos' },
      { label: t('nav.salesHistory'), icon: 'sales-history', path: '/app/sales' },
    )
  } else {
    items.push({ label: t('nav.personal'), icon: 'personal-accounting', path: '/app/personal' })
  }
  items.push({ label: 'Messages', icon: 'messages', path: '/app/messages' })
  return items
}

export default function BottomNav({ onMore }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { account } = useAuth()
  const { t } = useTranslation()

  const items = buildPrimaryItems(t, account?.account_type)

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map((item) => {
        const active = location.pathname === item.path
        return (
          <button
            key={item.path}
            type="button"
            className={`bottom-nav-item${active ? ' active' : ''}`}
            onClick={() => guardedNavigate(item.path)}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
          >
            <span className="bottom-nav-icon">{EMOJI_ICONS[item.icon] || '•'}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        )
      })}

      <button type="button" className="bottom-nav-item" onClick={onMore} aria-label={t('nav.more', 'More')}>
        <span className="bottom-nav-icon">☰</span>
        <span className="bottom-nav-label">{t('nav.more', 'More')}</span>
      </button>
    </nav>
  )
}
