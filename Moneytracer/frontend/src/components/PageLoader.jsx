import './PageLoader.css'
import Spinner from './Spinner.jsx'

/**
 * Full-page loading state — three bouncing dots, same animation used
 * everywhere else in the app (see Spinner.jsx), just given room to sit
 * centered in the viewport.
 */
export default function PageLoader({ label = 'Loading' }) {
  return (
    <div className="page-loader">
      <Spinner label={label} />
    </div>
  )
}
