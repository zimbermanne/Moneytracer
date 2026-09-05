import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import { buildFlatNav, EMOJI_ICONS } from './Sidebar.jsx'

// MOBILE ONLY: the sidebar, moved to the bottom. Every destination the
// desktop sidebar has is here too — nothing is hidden behind a "More"
// drawer, since that was exactly the complaint (bank loans, sales, etc.
// weren't reachable on a phone). A horizontally-scrollable pill rail is
// the only way ~30 destinations fit on a phone width at all.
//
// Interaction: tap a collapsed icon pill to expand it and reveal its
// label (like a touch-friendly stand-in for the desktop :hover reveal);
// tap the now-expanded pill again to actually navigate. Tapping anywhere
// else collapses it back down. This is a two-step confirm specifically
// so a mis-tap while scrolling the rail can't accidentally fire a
// navigation.
export default function BottomNav({ onMore }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { user, account } = useAuth()
  const { t } = useTranslation()
  const railRef = useRef(null)

  const [openPath, setOpenPath] = useState(null)

  const items = buildFlatNav(t)
    .filter((e) => !e.roles        || e.roles.includes(user?.role))
    .filter((e) => !e.accountTypes || e.accountTypes.includes(account?.account_type))

  useEffect(() => {
    const handler = (e) => {
      if (railRef.current && !railRef.current.contains(e.target)) setOpenPath(null)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  useEffect(() => { setOpenPath(null) }, [location.pathname])

  const handleClick = (path) => {
    if (openPath === path) {
      setOpenPath(null)
      guardedNavigate(path)
    } else {
      setOpenPath(path)
      railRef.current
        ?.querySelector(`[data-path="${path}"]`)
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }

  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <div className="bottom-nav-rail-outer">
        <div className="bottom-nav-scroll" ref={railRef}>
          {items.map((item) => {
            const active = location.pathname === item.path
            const isOpen = openPath === item.path
            return (
              <button
                key={item.path}
                type="button"
                data-path={item.path}
                className={`bottom-nav-item${active ? ' active' : ''}${isOpen ? ' is-open' : ''}`}
                onClick={() => handleClick(item.path)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <span className="bottom-nav-icon">{EMOJI_ICONS[item.icon] || '•'}</span>
                <span className="bottom-nav-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
