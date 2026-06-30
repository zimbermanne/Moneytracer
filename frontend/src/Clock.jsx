import { useEffect, useState } from 'react'

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}

export default function Clock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString('en-GB', { hour12: false })
  const month = now.toLocaleDateString('en-US', { month: 'short' })
  const week = isoWeek(now)
  const year = now.getFullYear()
  const day = now.getDate()

  return (
    <div className="clock-widget" title={now.toString()}>
      <div className="clock-time">{time}</div>
      <div className="clock-date">Wk {week} · {month} {day} · {year}</div>
    </div>
  )
}
