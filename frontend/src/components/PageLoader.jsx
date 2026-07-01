import './PageLoader.css'

/**
 * Full-page loading state — a soft, morphing gradient orb
 * (Gemini-style) built from the app's own warm palette.
 */
export default function PageLoader({ label = 'Loading' }) {
  return (
    <div className="page-loader">
      <div className="page-loader-orb">
        <span className="page-loader-blob page-loader-blob-a" />
        <span className="page-loader-blob page-loader-blob-b" />
        <span className="page-loader-blob page-loader-blob-c" />
      </div>
      <p className="page-loader-label">{label}</p>
    </div>
  )
}
