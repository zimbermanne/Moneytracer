import { useEffect, useState } from 'react'
import './PageLoader.css'
import Spinner from './Spinner.jsx'

/**
 * Full-page loading state — three bouncing dots, same animation used
 * everywhere else in the app (see Spinner.jsx), just given room to sit
 * centered in the viewport.
 *
 * On a free/hobby hosting tier the backend can go to sleep after a period
 * of inactivity, so the very first request after a while can take much
 * longer than usual while the server spins back up. If we're still loading
 * after a few seconds, swap in a message that explains that instead of
 * leaving the person staring at a spinner that looks stuck.
 */
export default function PageLoader({ label = 'Loading' }) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="page-loader">
      <Spinner label={slow ? 'Waking up the server — this can take up to a minute after inactivity' : label} />
    </div>
  )
}
