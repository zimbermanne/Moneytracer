/**
 * Shared loading indicator — three small bouncing dots — used at every
 * level of the app: full-page (via PageLoader), inline in buttons, and
 * blocked inside cards/tables while data loads. Always the same animation.
 */
export default function Spinner({ label, inline = false }) {
  const dots = (
    <span className="dots-loader" role="status" aria-label={label || 'Loading'}>
      <span className="dots-loader-dot" />
      <span className="dots-loader-dot" />
      <span className="dots-loader-dot" />
    </span>
  )

  if (inline) return dots

  return (
    <div className="spinner-block">
      {dots}
      {label && <span>{label}</span>}
    </div>
  )
}
