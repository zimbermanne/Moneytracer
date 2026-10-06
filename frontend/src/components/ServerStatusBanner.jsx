import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../api-config.js'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import { getSessionExpiry } from '../utils/sessionClock.js'

const HEALTH_MS = 15000       // how often we check the server is reachable
const VERSION_MS = 60000      // how often we check a new app version was released
const SESSION_WARN_S = 300    // warn when the session has < 5 min left
const AUTO_REFRESH_S = 30     // idle (nothing unsaved) → refresh this many seconds after an update

const bundleOf = (html) => (html.match(/assets\/index-[\w-]+\.js/) || [])[0] || null

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function ServerStatusBanner() {
  const { isDirty } = useNavigationGuard()
  const [offlineSince, setOfflineSince] = useState(null)
  const [retryAt, setRetryAt] = useState(null)
  const [updateAt, setUpdateAt] = useState(null)   // ms timestamp when an update was first noticed
  const [now, setNow] = useState(Date.now())
  const failsRef = useRef(0)
  const timerRef = useRef(null)
  const currentBundle = useRef(bundleOf(document.documentElement.innerHTML + [...document.scripts].map((s) => s.src).join(' ')))

  const checkHealth = useCallback(async () => {
    clearTimeout(timerRef.current)
    let delay = HEALTH_MS
    try {
      const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' })
      if (!res.ok) throw new Error('bad')
      failsRef.current = 0
      setOfflineSince(null); setRetryAt(null)
    } catch {
      failsRef.current += 1
      setOfflineSince((t) => t || Date.now())
      delay = Math.min(5000 * failsRef.current, 15000)   // 5s, 10s, 15s, 15s…
      setRetryAt(Date.now() + delay)
    }
    timerRef.current = setTimeout(checkHealth, delay)
  }, [])

  useEffect(() => {
    checkHealth()
    return () => clearTimeout(timerRef.current)
  }, [checkHealth])

  // Has a newer version of the app been released since this tab loaded?
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store' })
        const latest = bundleOf(await res.text())
        if (latest && currentBundle.current && latest !== currentBundle.current) {
          setUpdateAt((t) => t || Date.now())
        }
      } catch { /* offline — the health check already covers this */ }
    }
    const id = setInterval(check, VERSION_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // New version + nothing unsaved → refresh automatically after a short countdown.
  const idleUpdateIn = updateAt && !isDirty ? Math.max(0, AUTO_REFRESH_S - Math.floor((now - updateAt) / 1000)) : null
  useEffect(() => {
    if (idleUpdateIn === 0) window.location.reload()
  }, [idleUpdateIn])

  const expiry = getSessionExpiry()
  const sessionLeft = expiry ? Math.floor((expiry - now) / 1000) : null

  let tone = null
  let content = null
  if (offlineSince) {
    const left = Math.max(0, Math.ceil((retryAt - now) / 1000))
    tone = 'danger'
    content = (
      <>
        <span>⚠️ The server is restarting or unreachable. Your work is saved on this device. Retrying in <b>{left}s</b>…</span>
        <button type="button" className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12 }} onClick={checkHealth}>Retry now</button>
      </>
    )
  } else if (updateAt) {
    tone = 'info'
    content = isDirty ? (
      <>
        <span>🔄 A new version was released. Finish and save what you're doing, then refresh.</span>
        <button type="button" className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => window.location.reload()}>Refresh now</button>
      </>
    ) : (
      <>
        <span>🔄 A new version was released. Updating in <b>{idleUpdateIn}s</b>…</span>
        <button type="button" className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => window.location.reload()}>Update now</button>
      </>
    )
  } else if (sessionLeft !== null && sessionLeft > 0 && sessionLeft <= SESSION_WARN_S) {
    tone = 'warn'
    content = <span>⏳ Your session ends in <b>{fmt(sessionLeft)}</b>. Save your work — you'll be asked to sign back in.</span>
  }

  if (!content) return null
  const colors = {
    danger: ['var(--danger-bg, #fdecea)', 'var(--danger-text, #b3261e)'],
    warn: ['var(--warning-bg, #fff7e6)', 'var(--warning-text, #8a5a00)'],
    info: ['var(--info-bg, #e8f1ff)', 'var(--info-text, #1a4d99)'],
  }[tone]
  return (
    <div role="status" style={{
      position: 'sticky', top: 0, zIndex: 9000, background: colors[0], color: colors[1],
      padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      {content}
    </div>
  )
}
