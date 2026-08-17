import Clock from '../Clock.jsx'
import logoMark from '../assets/logo-mark.png'

// MOBILE ONLY: always rendered by Layout in App.jsx, but CSS keeps it
// hidden (display:none) until the phone breakpoint kicks in — see
// .mobile-topbar / .mobile-info-row in src/styles/globals.css
// ("MOBILE: main phone breakpoint" block). No JS width check; it's pure
// CSS. Styling/sizing tweaks go in that CSS file, not here.
export default function MobileTopBar({
  title, onToggle, open, accountName, accountRank,
  reminders, onAddReminder, onDismissReminder,
}) {
  const hasInfoRow = accountName || accountRank || (reminders && reminders.length > 0) || onAddReminder

  return (
    <>
      <div className="mobile-topbar">
        <button className="hamburger" onClick={onToggle} aria-label="Toggle menu">
          {open ? '✕' : '☰'}
        </button>
        <img src={logoMark} alt="Moneytracer" className="brand-logo" style={{ width: 26, height: 26 }} />
        <div className="mobile-topbar-title">{title}</div>
        <Clock showAccount={false} showReminders={false} />
      </div>
      {hasInfoRow && (
        <div className="mobile-info-row">
          <Clock
            showClock={false}
            accountName={accountName}
            accountRank={accountRank}
            reminders={reminders}
            onAddReminder={onAddReminder}
            onDismissReminder={onDismissReminder}
          />
        </div>
      )}
    </>
  )
}
