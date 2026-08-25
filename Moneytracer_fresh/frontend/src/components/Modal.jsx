import { useState } from 'react'

/**
 * isDirty defaults to true: a modal is assumed to hold in-progress input
 * worth protecting unless the caller says otherwise. This is a deliberately
 * conservative default — better an occasional "discard changes?" on a modal
 * that turned out to be empty than the silent data-loss this replaces.
 * Callers that can cheaply compute real dirtiness (e.g. isDirty={form.name
 * !== '' || form.items.length > 0}) should pass it for a more precise
 * "only ask when there's actually something to lose" experience.
 */
export default function Modal({ title, onClose, children, footer, isDirty = true, wide = false }) {
  const [confirmingClose, setConfirmingClose] = useState(false)

  const handleBackdropClick = () => {
    if (isDirty) setConfirmingClose(true)
    else onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        {footer && <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>{footer}</div>}
      </div>

      {confirmingClose && (
        <div className="modal-overlay" style={{ zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
          <div className="card" style={{ maxWidth: 360, width: '100%', background: 'var(--surface)', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <h3 style={{ margin: 0 }}>Discard changes?</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
              Closing now will discard what you've entered in this form.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setConfirmingClose(false)}>Keep editing</button>
              <button className="btn btn-danger" onClick={onClose}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
