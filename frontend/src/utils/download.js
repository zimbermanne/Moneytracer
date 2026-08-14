/**
 * Triggers a browser download/open for a server-generated file (PDF,
 * xlsx, etc.) without the fetch()+blob()+URL.createObjectURL() dance
 * used elsewhere in this codebase.
 *
 * Why this matters on mobile: that blob approach spans an `await fetch()`
 * before the click/open happens. Once you cross an `await`, you've left
 * the synchronous call stack the click handler started in — and mobile
 * Safari (and many Android browsers) only allow a popup/navigation/
 * download to proceed if it's the *direct, synchronous* result of a user
 * gesture. Anything after an intervening await gets silently blocked,
 * which is exactly what "downloads don't work on mobile, but work fine
 * on desktop" looks like — no error, nothing happens.
 *
 * The fix is to skip JS entirely: point an <a> straight at the endpoint
 * URL and click it synchronously. Auth here is a cookie
 * (credentials: 'include' elsewhere in the app), so the browser attaches
 * it automatically on this direct navigation too — no need to fetch
 * client-side first. The backend already sets
 * `Content-Disposition: attachment` on these endpoints, which is what
 * actually triggers a download rather than a navigation; the `download`
 * attribute here is just a same-origin-only filename hint on top of that.
 */
export function downloadFile(url, filename) {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * Opens a server-generated PDF in a new tab for viewing/printing, for the
 * "Print" (not thermal-printer) buttons scattered around invoices/
 * quotations/debit notes.
 *
 * Deliberately does NOT try to fetch a blob and call win.print() on it —
 * that also crosses the same await-breaks-the-gesture problem above, and
 * even when the popup does survive, mobile browsers almost never expose
 * a working print() on a PDF rendered by their native viewer anyway,
 * so the call was mostly a no-op on phones even before the popup-block
 * issue. Opening the PDF directly is the one thing that reliably works
 * everywhere: desktop gets its usual PDF-viewer print icon, mobile gets
 * its native PDF viewer with a share/print option in the toolbar.
 */
export function openPdfForPrint(url) {
  window.open(url, '_blank', 'noopener')
}
