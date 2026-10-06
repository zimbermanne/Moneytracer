import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth.jsx'

/**
 * Autosaves a form to this device while it is open, so a logout, server
 * restart, crash or accidental refresh can't wipe it.
 *
 * - key: a stable id for the form ("quotations:new"); pass null when the form
 *   is closed — nothing is read or written.
 * - On open, if a saved draft exists it's offered back as `pending` (the form
 *   itself is untouched until the user chooses restore()).
 * - Call clear() after a successful save or a deliberate cancel.
 */
export function useDraft(key, value, setValue, { isEmpty = () => false, delay = 700 } = {}) {
  const { user } = useAuth()
  const storageKey = key && user ? `mt-draft:${user.id ?? user.username}:${key}` : null
  const [pending, setPending] = useState(null)
  const isEmptyRef = useRef(isEmpty)
  isEmptyRef.current = isEmpty

  useEffect(() => {
    if (!storageKey) { setPending(null); return }
    try {
      const raw = localStorage.getItem(storageKey)
      setPending(raw ? JSON.parse(raw) : null)
    } catch { setPending(null) }
  }, [storageKey])

  // Hold off autosaving while a saved draft is still waiting for a decision,
  // otherwise the blank form would overwrite it before the user can restore.
  useEffect(() => {
    if (!storageKey || pending) return undefined
    const t = setTimeout(() => {
      try {
        if (isEmptyRef.current(value)) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), value }))
      } catch { /* storage full or blocked — autosave is best-effort */ }
    }, delay)
    return () => clearTimeout(t)
  }, [value, storageKey, pending, delay])

  const remove = useCallback(() => {
    if (!storageKey) return
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }, [storageKey])

  const restore = useCallback(() => {
    if (pending) setValue(pending.value)
    setPending(null)
  }, [pending, setValue])

  const discard = useCallback(() => { remove(); setPending(null) }, [remove])

  return { pending, restore, discard, clear: remove }
}
