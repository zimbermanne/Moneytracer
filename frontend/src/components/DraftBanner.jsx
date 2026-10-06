export default function DraftBanner({ draft }) {
  if (!draft?.pending) return null
  const when = new Date(draft.pending.savedAt).toLocaleString()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      margin: '0 0 14px', padding: '10px 14px', borderRadius: 10, fontSize: 13,
      background: 'var(--warning-bg, #fff7e6)', color: 'var(--warning-text, #8a5a00)',
    }}>
      <span>📝 You have an unsaved draft from {when}.</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={draft.restore}>Restore</button>
        <button type="button" className="btn btn-outline" style={{ padding: '4px 12px', fontSize: 12 }} onClick={draft.discard}>Discard</button>
      </span>
    </div>
  )
}
