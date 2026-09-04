import { useState } from 'react'
import { useTheme } from '../hooks/useTheme.jsx'

const MODES = [
  { key: 'light', label: '☀️ Light' },
  { key: 'dark', label: '🌙 Dark' },
  { key: 'system', label: '🖥️ System' },
]

const STYLES = [
  { key: 'glass', label: '💧 Liquid Glass' },
  { key: 'classic', label: '▫️ Classic' },
]

// Downscale + compress an uploaded image before it goes into localStorage —
// a full-resolution photo can easily blow past the ~5MB storage quota.
function fileToCompressedDataUrl(file, maxDim = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode image'))
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export default function AppearanceSettings() {
  const { prefs, update, reset } = useTheme()
  const [bgError, setBgError] = useState('')
  const [bgBusy, setBgBusy] = useState(false)
  // Image the user has picked but not yet applied as the background.
  const [pendingBgImage, setPendingBgImage] = useState(null)

  const handleBgPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setBgError('Please choose an image file.')
      return
    }
    setBgError('')
    setBgBusy(true)
    try {
      const dataUrl = await fileToCompressedDataUrl(file)
      setPendingBgImage(dataUrl)
    } catch (err) {
      setBgError(err.message || 'Could not process that image.')
    } finally {
      setBgBusy(false)
    }
  }

  const handleSetBg = () => {
    if (!pendingBgImage) return
    update({ customBgImage: pendingBgImage })
    setPendingBgImage(null)
  }

  const previewImage = pendingBgImage || prefs.customBgImage

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>🎨 Appearance</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
        Customize the theme used across the app. Saved on this device.
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

      {/* Style: liquid glass vs classic */}
      <div className="form-row" style={{ marginBottom: 20 }}>
        <label>Style</label>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Switch between the frosted "Liquid Glass" look and the original flat "Classic" look.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={(prefs.style || 'glass') === s.key ? 'btn btn-primary' : 'btn btn-outline'}
              onClick={() => update({ style: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background image */}
      <div className="form-row" style={{ marginBottom: 20 }}>
        <label>Background Image</label>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          Replace the app's backdrop image with your own.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
            {bgBusy ? 'Processing…' : '📁 Choose Image'}
            <input type="file" accept="image/*" onChange={handleBgPick} disabled={bgBusy} style={{ display: 'none' }} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSetBg}
            disabled={!pendingBgImage || bgBusy}
          >
            ✅ Set as Background
          </button>
          {prefs.customBgImage && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => { update({ customBgImage: null }); setPendingBgImage(null) }}
            >
              Remove (use default)
            </button>
          )}
        </div>
        {bgError && <div className="error-text" style={{ marginTop: 6 }}>{bgError}</div>}
        {previewImage && (
          <>
            <img
              src={previewImage}
              alt={pendingBgImage ? 'Selected background preview (not yet applied)' : 'Custom background preview'}
              style={{ marginTop: 10, width: '100%', maxWidth: 320, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
            />
            {pendingBgImage && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Not applied yet — click "Set as Background" to use this image.
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn btn-outline" onClick={reset}>Reset to Defaults</button>
    </div>
  )
}
