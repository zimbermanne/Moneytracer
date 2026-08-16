import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import { buildFlatNav, EMOJI_ICONS } from './Sidebar.jsx'

// MOBILE ONLY: fixed bottom pill-rail nav.
// Each item is a compact 48×48 icon pill that expands on first tap to
// reveal its label (pill grows to ~168px). A second tap on the same
// expanded pill navigates. Tapping anywhere else collapses all pills.
// CSS lives in the "MOBILE: main phone breakpoint" block in globals.css.
export default function BottomNav({ onMore }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { user, account } = useAuth()
  const { t } = useTranslation()
  const railRef = useRef(null)

  // Which item is currently "expanded" (first-tap state)
  const [openPath, setOpenPath] = useState(null)

  const items = buildFlatNav(t)
    .filter((e) => !e.roles        || e.roles.includes(user?.role))
    .filter((e) => !e.accountTypes || e.accountTypes.includes(account?.account_type))

  // Collapse all pills when user taps outside the rail
  useEffect(() => {
    const handler = (e) => {
      if (railRef.current && !railRef.current.contains(e.target)) {
        setOpenPath(null)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  // Collapse when route changes (navigation completed)
  useEffect(() => { setOpenPath(null) }, [location.pathname])

  const handleClick = (path) => {
    if (openPath === path) {
      // Second tap → navigate
      setOpenPath(null)
      guardedNavigate(path)
    } else {
      // First tap → expand this pill, collapse others
      setOpenPath(path)
      // Scroll the expanded pill into view smoothly
      const btn = railRef.current?.querySelector(`[data-path="${path}"]`)
      if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }

  const handleMore = () => {
    setOpenPath(null)
    onMore?.()
  }

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {/* fade-edge wrapper so partially-visible pills look intentional */}
      <div className="bottom-nav-rail-outer">
        <div className="bottom-nav-scroll" ref={railRef}>
          {items.map((item) => {
            const active  = location.pathname === item.path
            const isOpen  = openPath === item.path
            return (
              <button
                key={item.path}
                type="button"
                data-path={item.path}
                className={[
                  'bottom-nav-item',
                  active ? 'active' : '',
                  isOpen ? 'is-open' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleClick(item.path)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <span className="bottom-nav-icon">{EMOJI_ICONS[item.icon] || '•'}</span>
                <span className="bottom-nav-label">{item.label}</span>
              </button>
            )
          })}

          {/* More / hamburger pill */}
          <button
            type="button"
            className="bottom-nav-item"
            onClick={handleMore}
            aria-label={t('nav.more', 'More')}
          >
            <span className="bottom-nav-icon">☰</span>
            <span className="bottom-nav-label">{t('nav.more', 'More')}</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
