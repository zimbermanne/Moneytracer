import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'mt-theme-prefs'

export const ACCENT_PRESETS = {
  terracotta: { label: 'Terracotta', accent: '#C15F3C', hover: '#A94F30', soft: '#F3E1D6', softDark: '#2d1e17' },
  ocean:      { label: 'Ocean',      accent: '#2E6B8A', hover: '#25566F', soft: '#DCEAF1', softDark: '#12232c' },
  forest:     { label: 'Forest',     accent: '#4C7A4A', hover: '#3D6339', soft: '#E1EDDD', softDark: '#182619' },
  plum:       { label: 'Plum',       accent: '#7B4B8A', hover: '#623A6F', soft: '#EBDFF0', softDark: '#231a29' },
  slate:      { label: 'Slate',      accent: '#4A5568', hover: '#3A4353', soft: '#E2E5EA', softDark: '#1c1f27' },
  gold:       { label: 'Gold',       accent: '#B9862E', hover: '#9C7026', soft: '#F5E9D3', softDark: '#2a2010' },
}

const DEFAULTS = {
  mode: 'system',           // 'light' | 'dark' | 'system'
  accentKey: 'terracotta',  // key into ACCENT_PRESETS, or 'custom'
  customAccent: null,       // hex string when accentKey === 'custom'
  customBgImage: null,      // data URL string, or null to use the theme's default hero image
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function resolveMode(mode) {
  if (mode === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyPrefs(prefs) {
  const root = document.documentElement

  // ---- Light/Dark ----
  if (prefs.mode === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', prefs.mode)
  }

  // ---- Accent ----
  const accent = prefs.accentKey === 'custom' && prefs.customAccent
    ? { accent: prefs.customAccent, hover: prefs.customAccent, soft: 'color-mix(in srgb, ' + prefs.customAccent + ' 22%, white)', softDark: 'color-mix(in srgb, ' + prefs.customAccent + ' 30%, black)' }
    : (ACCENT_PRESETS[prefs.accentKey] || ACCENT_PRESETS.terracotta)

  const isDark = resolveMode(prefs.mode) === 'dark'
  root.style.setProperty('--accent', accent.accent)
  root.style.setProperty('--accent-hover', accent.hover)
  root.style.setProperty('--accent-soft', isDark ? accent.softDark : accent.soft)
  root.style.setProperty('--sidebar-active-text', accent.accent)
  root.style.setProperty('--sidebar-active-bg', isDark ? accent.softDark : accent.soft)

  // ---- Background image ----
  if (prefs.customBgImage) {
    root.style.setProperty('--app-bg-image', `url("${prefs.customBgImage}")`)
  } else {
    root.style.removeProperty('--app-bg-image')
  }
}

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(loadPrefs)

  useEffect(() => {
    applyPrefs(prefs)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
  }, [prefs])

  useEffect(() => {
    if (prefs.mode !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(prefs)
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange)
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange)
    }
  }, [prefs])

  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), [])
  const reset = useCallback(() => setPrefs({ ...DEFAULTS }), [])

  return (
    <ThemeContext.Provider value={{ prefs, update, reset }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}


