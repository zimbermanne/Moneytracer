import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'mt-theme-prefs'

// Fixed accent — "Carrot" orange. No longer user-configurable.
const ACCENT = { accent: '#ED9121', hover: '#D67F16', soft: '#FBE3C7', softDark: '#2e1f0d' }

const DEFAULTS = {
  mode: 'system',           // 'light' | 'dark' | 'system'
  style: 'glass',           // 'glass' (liquid glass) | 'classic' (original flat look)
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

  // ---- Style: liquid glass vs classic ----
  if (prefs.style === 'classic') {
    root.setAttribute('data-style', 'classic')
  } else {
    root.removeAttribute('data-style')
  }

  // ---- Accent (fixed) ----
  const isDark = resolveMode(prefs.mode) === 'dark'
  root.style.setProperty('--accent', ACCENT.accent)
  root.style.setProperty('--accent-hover', ACCENT.hover)
  root.style.setProperty('--accent-soft', isDark ? ACCENT.softDark : ACCENT.soft)
  root.style.setProperty('--sidebar-active-text', ACCENT.accent)
  root.style.setProperty('--sidebar-active-bg', isDark ? ACCENT.softDark : ACCENT.soft)

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


