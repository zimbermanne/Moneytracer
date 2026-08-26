export default function SearchBar({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div style={{ position: 'relative', maxWidth: 340, flex: '1 1 240px', ...style }}>
      <span style={{
        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-muted)', fontSize: 14, pointerEvents: 'none', zIndex: 2,
      }}>
        🔍
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={value ? '' : ''} // Hide native placeholder while animating
        style={{ width: '100%', padding: '8px 12px 8px 32px' }}
      />
      {!value && (
        <div className="typing-container">
          <div className="typing-text">
            {placeholder}
            <span className="typing-mask"></span>
          </div>
        </div>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: 4, zIndex: 2,
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
