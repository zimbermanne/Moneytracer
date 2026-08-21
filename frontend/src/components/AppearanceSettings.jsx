import { useState } from 'react'
import { useTheme, ACCENT_PRESETS, FROST_PRESETS, hexToRgbString, rgbStringToHex } from '../hooks/useTheme.jsx'

const MODES = [
  { key: 'light', label: '☀️ Light' },
  { key: 'dark', label: '🌙 Dark' },
  { key: 'system', label: '🖥️ System' },
]

function Swatch({ active, onClick, title, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
        border: active ? '3px solid var(--text-dark)' : '2px solid var(--border)',
        boxShadow: active ? '0 0 0 2px var(--surface)' : 'none',
        padding: 0, ...style,
      }}
    />
  )
}

export default function AppearanceSettings() {
  const { prefs, update, reset } = useTheme()
  const [customAccentHex, setCustomAccentHex] = useState(prefs.customAccent || '#C15F3C')
  const [customFrostHex, setCustomFrostHex] = useState(rgbStringToHex(prefs.customFrostColor || '255, 255, 255'))

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>🎨 Appearance</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
        Customize the theme, accent color, and frosted-glass effect used across the app. Saved on this device.
      </div>

      {/* Theme mode */}
      <div className="form-row" style={{ marginBottom: 20 }}>
        <label>Theme</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={prefs.mode === m.key ? 'btn btn-primary' : 'btn btn-outline'}
              onClick={() => update({ mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color */}
      <div className="form-row" style={{ marginBottom: 20 }}>
        <label>Accent Color</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(ACCENT_PRESETS).map(([key, p]) => (
            <Swatch
              key={key}
              title={p.label}
              active={prefs.accentKey === key}
              onClick={() => update({ accentKey: key })}
              style={{ background: p.accent }}
            />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <input
              type="color"
              value={customAccentHex}
              onChange={(e) => {
                setCustomAccentHex(e.target.value)
                update({ accentKey: 'custom', customAccent: e.target.value })
              }}
              style={{ width: 32, height: 32, border: prefs.accentKey === 'custom' ? '3px solid var(--text-dark)' : '2px solid var(--border)', borderRadius: '50%', padding: 0, cursor: 'pointer', background: 'none' }}
              title="Custom accent color"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custom</span>
          </div>
        </div>
      </div>

      {/* Frost color */}
      <div className="form-row" style={{ marginBottom: 20 }}>
        <label>Frost Color</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(FROST_PRESETS).map(([key, p]) => (
            <Swatch
              key={key}
              title={p.label}
              active={prefs.frostKey === key}
              onClick={() => update({ frostKey: key })}
              style={{ background: `rgb(${p.color})`, border: (prefs.frostKey === key ? '3px solid var(--text-dark)' : '2px solid var(--border-strong)') }}
            />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <input
              type="color"
              value={customFrostHex}
              onChange={(e) => {
                setCustomFrostHex(e.target.value)
                update({ frostKey: 'custom', customFrostColor: hexToRgbString(e.target.value) })
              }}
              style={{ width: 32, height: 32, border: prefs.frostKey === 'custom' ? '3px solid var(--text-dark)' : '2px solid var(--border)', borderRadius: '50%', padding: 0, cursor: 'pointer', background: 'none' }}
              title="Custom frost color"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custom</span>
          </div>
        </div>
      </div>

      {/* Frost intensity */}
      <div className="form-row" style={{ marginBottom: 20, maxWidth: 320 }}>
        <label>Frost Intensity ({Math.round(prefs.frostIntensity * 100)}%)</label>
        <input
          type="range"
          min="0.04"
          max="0.30"
          step="0.01"
          value={prefs.frostIntensity}
          onChange={(e) => update({ frostIntensity: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
      </div>

      {/* Live preview */}
      <div style={{ position: 'relative', padding: 24, borderRadius: 16, marginBottom: 16, background: 'linear-gradient(135deg, var(--accent) 0%, var(--info) 100%)' }}>
        <div className="card" style={{ maxWidth: 260 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Preview</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Net Profit</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>This is how your cards will look.</div>
        </div>
      </div>

      <button className="btn btn-outline" onClick={reset}>Reset to Defaults</button>
    </div>
  )
}
