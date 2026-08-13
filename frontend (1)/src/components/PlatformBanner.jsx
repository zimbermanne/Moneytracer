import { useEffect, useState } from 'react'
import { apiUrl } from '../api-config.js'

const LEVEL_STYLE = {
  info: { bg: 'var(--info-bg)', color: 'var(--info)' },
  warning: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  critical: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
}

// Unauthenticated on purpose — /api/public/announcement/active carries no
// tenant-specific data, and this needs to render on the login screen too
// (e.g. a maintenance notice before anyone signs in), not just inside the
// authenticated app shell. Polled rather than fetched once so a banner
// posted by a superadmin mid-session shows up without a page reload.
const POLL_MS = 5 * 60 * 1000

// A dismissal is remembered per-message (not just "banner closed"), so a
// NEW announcement still shows even if the person dismissed an earlier one
// in this browser.
const DISMISSED_KEY = 'mt_dismissed_announcement'

export default function PlatformBanner() {
  const [announcement, setAnnouncement] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(apiUrl('/api/public/announcement/active'))
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (data.active) {
          setAnnouncement(data)
          setDismissed(localStorage.getItem(DISMISSED_KEY) === data.message)
        } else {
          setAnnouncement(null)
        }
      } catch {
        // Silent — a banner is a nice-to-have, not worth surfacing a
        // network error for on every page.
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!announcement || dismissed) return null

  const style = LEVEL_STYLE[announcement.level] || LEVEL_STYLE.info

  return (
    <div
      style={{
        background: style.bg,
        color: style.color,
        padding: '10px 20px',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span>{announcement.message}</span>
      <button
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, announcement.message)
          setDismissed(true)
        }}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          opacity: 0.75,
          fontWeight: 600,
          fontSize: 13,
          padding: 0,
          cursor: 'pointer',
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
