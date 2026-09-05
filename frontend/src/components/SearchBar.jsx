export default function SearchBar({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div className="search-bar-wrap" style={style}>
      <span className="search-bar-icon">🔍</span>
      <input
        type="text"
        className="search-bar-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=""
      />
      {!value && (
        <div className="typing-container">
          <div className="typing-text">{placeholder}</div>
        </div>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'rgba(0,0,0,0.1)', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 10, width: 20, height: 20, borderRadius: '50%', padding: 0, zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
