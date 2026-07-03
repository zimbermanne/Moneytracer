import { useEffect, useState } from 'react'

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}

const RANK_LABELS = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
}

/**
 * Topbar clock/reminders/account bar.
 *
 * `reminders` — array of { id, text } saved via `onAddReminder`; shown as
 * dismissible chips. `onAddReminder(text)` / `onDismissReminder(id)` are
 * optional — omit them to render a read-only bar (e.g. before data loads).
 *
 * `accountName` renders bold/large, `accountRank` renders small underneath —
 * just the values, no "Account name:" label text.
 */
export default function Clock({ reminders = [], onAddReminder, onDismissReminder, accountName, accountRank }) {
  const [now, setNow] = useState(new Date())
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString('en-GB', { hour12: false })
  const month = now.toLocaleDateString('en-US', { month: 'short' })
  const week = isoWeek(now)
  const year = now.getFullYear()
  const day = now.getDate()
  const rankLabel = accountRank ? (RANK_LABELS[accountRank] || accountRank) : null

  const submitReminder = () => {
    const text = draft.trim()
    if (!text || !onAddReminder) { setAdding(false); return }
    onAddReminder(text)
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="clock-bar clock-bar-wide" title={now.toString()}>
      <div className="reminders-segment">
        {reminders.length === 0 && !adding && (
          <span className="reminders-placeholder">No reminders</span>
        )}
        {reminders.map((r) => (
          <span key={r.id} className="reminder-chip">
            {r.text}
            {onDismissReminder && (
              <button
                type="button"
                className="reminder-chip-dismiss"
                onClick={() => onDismissReminder(r.id)}
                aria-label="Dismiss reminder"
              >✕</button>
            )}
          </span>
        ))}
        {onAddReminder && (
          adding ? (
            <input
              autoFocus
              className="reminder-input"
              placeholder="Type a reminder, press Enter…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitReminder()
                if (e.key === 'Escape') { setAdding(false); setDraft('') }
              }}
              onBlur={submitReminder}
            />
          ) : (
            <button type="button" className="reminder-add-btn" onClick={() => setAdding(true)}>+ Reminder</button>
          )
        )}
      </div>
      {(accountName || rankLabel) && (
        <>
          <div className="clock-divider" />
          <div className="account-segment">
            {accountName && <div className="account-name">{accountName}</div>}
            {rankLabel && <div className="account-rank">{rankLabel}</div>}
          </div>
        </>
      )}
      <div className="clock-divider" />
      <div className="clock-segment">
        <div className="clock-time">{time}</div>
        <div className="clock-date">Wk {week} · {month} {day} · {year}</div>
      </div>
    </div>
  )
}
