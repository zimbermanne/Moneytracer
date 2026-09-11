import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const NavigationGuardContext = createContext(null)

/**
 * Provides a way for any page to mark itself "dirty" (unsaved work in progress)
 * so that navigating away — via the sidebar, the browser back button, a page
 * refresh, or closing the tab — shows a warning instead of silently discarding
 * the work.
 */
export function NavigationGuardProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false)
  const [message, setMessage] = useState('You have unsaved changes that will be lost if you leave this page.')
  const [pendingPath, setPendingPath] = useState(null) // null = no prompt, 'BACK' = browser back, or a path string
  const [onSaveDraft, setOnSaveDraft] = useState(null) // async function to save work as draft
  const navigate = useNavigate()
  const isDirtyRef = useRef(false)
  isDirtyRef.current = isDirty

  // Warn on tab close / refresh
  useEffect(() => {
    const handler = (e) => {
      if (isDirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Warn on browser/hardware back button
  useEffect(() => {
    const onPopState = () => {
      if (isDirtyRef.current) {
        // Cancel the back navigation by re-pushing the current entry, and
        // show the confirmation modal instead.
        window.history.pushState(null, '', window.location.href)
        setPendingPath('BACK')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const guardedNavigate = useCallback((path) => {
    if (isDirtyRef.current) {
      setPendingPath(path)
    } else {
      navigate(path)
    }
  }, [navigate])

  const confirmLeave = useCallback(() => {
    const path = pendingPath
    setPendingPath(null)
    setIsDirty(false)
    isDirtyRef.current = false
    if (path === 'BACK') {
      window.history.back()
    } else if (path) {
      navigate(path)
    }
  }, [pendingPath, navigate])

  const saveDraftAndLeave = useCallback(async () => {
    if (onSaveDraft) {
      const success = await onSaveDraft()
      if (success) confirmLeave()
    }
  }, [onSaveDraft, confirmLeave])

  const cancelLeave = useCallback(() => setPendingPath(null), [])

  return (
    <NavigationGuardContext.Provider value={{
      isDirty,
      setDirty: setIsDirty,
      setDirtyMessage: setMessage,
      guardedNavigate,
      setOnSaveDraft: setOnSaveDraft
    }}>
      {children}
      {pendingPath !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '100%', background: 'var(--surface)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 28 }}>🛒</span>
              <h3 style={{ margin: 0 }}>Unsaved sale in progress</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
              {message}
            </p>
            <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={cancelLeave}>Keep Editing</button>
                {onSaveDraft ? (
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={saveDraftAndLeave}>
                    💾 Save as Draft
                  </button>
                ) : (
                  <div style={{ flex: 1 }} />
                )}
                <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={confirmLeave}>Discard</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </NavigationGuardContext.Provider>
  )
}

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext)
  if (!ctx) throw new Error('useNavigationGuard must be used within a NavigationGuardProvider')
  return ctx
}
