import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import { buildFlatNav } from './Sidebar.jsx'

// MOBILE ONLY: the fixed bottom tab strip shown on phones. The .bottom-nav
// class is display:none by default (desktop) and only switched on inside
// the "MOBILE: main phone breakpoint" @media block in
// src/styles/globals.css — edit sizing/spacing/scroll behavior there.
//
// Shows every destination from the sidebar (groups flattened) as a single
// horizontally-scrolling row, so nothing on the phone requires opening the
// drawer just to navigate — the drawer (via "More") stays around only for
// logout and anything not represented here.
export default function BottomNav({ onMore }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { user, account } = useAuth()
  const { t } = useTranslation()

  const items = buildFlatNav(t)
    .filter((entry) => !entry.roles || entry.roles.includes(user?.role))
    .filter((entry) => !entry.accountTypes || entry.accountTypes.includes(account?.account_type))

  return (
    <nav className="bottom-nav" aria-label="Primary">
      <div className="bottom-nav-scroll">
        {items.map((item) => {
          const active = location.pathname === item.path
          return (
            <button
              key={item.path}
              type="button"
              className={`bottom-nav-item ${active ? 'active' : ''}`}
              onClick={() => guardedNavigate(item.path)}
            >
              <span className="bottom-nav-icon">{item.icon}</span>
              <span className="bottom-nav-label">{item.label}</span>
            </button>
          )
        })}
        <button type="button" className="bottom-nav-item" onClick={onMore}>
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">{t('nav.more', 'More')}</span>
        </button>
      </div>
    </nav>
  )
}
