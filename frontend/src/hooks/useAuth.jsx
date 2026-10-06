import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { apiUrl } from '../api-config.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // The real session lives in an httpOnly cookie set by the backend on
  // login — it's never readable by JS (that's the point: an XSS payload
  // can't steal it). `isAuthenticated` is just a local UI flag, hydrated by
  // asking the server "am I logged in?" via /auth/me (cookie sent
  // automatically with credentials: 'include').
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState(null)

  const fetchAccount = useCallback(async (currentUser) => {
    // Only account admins have (or need) an onboarding wizard; superadmin
    // and staff accounts (manager/employee) never see it.
    if (!currentUser || currentUser.role !== 'admin') {
      setAccount(null)
      setAccountError(null)
      return
    }
    setAccountLoading(true)
    setAccountError(null)
    try {
      const res = await fetch(apiUrl('/api/accounts/my-account'), { credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Could not load account details (Status ${res.status})`)
      }
      setAccount(await res.json())
    } catch (err) {
      setAccount(null)
      setAccountError(err.message)
    } finally {
      setAccountLoading(false)
    }
  }, [])

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
      if (!res.ok) throw new Error('unauthorized')
      const data = await res.json()
      setUser(data)
      setIsAuthenticated(true)
      await fetchAccount(data)
    } catch {
      setIsAuthenticated(false)
      setUser(null)
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [fetchAccount])

  useEffect(() => {
    // On first load we don't know yet whether a session cookie exists, so
    // always ask the server rather than trusting any local flag.
    fetchMe()
  }, [fetchMe])

  const refreshAccount = useCallback(() => {
    if (isAuthenticated && user) return fetchAccount(user)
  }, [isAuthenticated, user, fetchAccount])

  const login = useCallback(async (username, password) => {
    // Collect non-PII client telemetry for UX optimization and security auditing
    const telemetry = {
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      is_pwa: window.matchMedia('(display-mode: standalone)').matches,
      connection_type: navigator.connection?.effectiveType || 'unknown',
    }

    let res
    try {
      res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...telemetry }),
        credentials: 'include',
      })
    } catch {
      throw new Error('Could not reach the server. Check your connection or the API configuration.')
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Login failed')
      }
      throw new Error(`Login failed (${res.status}) — the server returned an unexpected response. The API URL may be misconfigured.`)
    }
    const data = await res.json()
    setIsAuthenticated(true)
    setUser(data.user)
    await fetchAccount(data.user)
    return data.user
  }, [fetchAccount])

  const loginAsDemo = useCallback(async () => {
    let res
    try {
      res = await fetch(apiUrl('/api/auth/demo-login'), { method: 'POST', credentials: 'include' })
    } catch {
      throw new Error('Could not reach the server. Check your connection or the API configuration.')
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Demo login failed')
      }
      throw new Error(`Demo login failed (${res.status}) — the server returned an unexpected response. The API URL may be misconfigured.`)
    }
    const data = await res.json()
    setIsAuthenticated(true)
    setUser(data.user)
    await fetchAccount(data.user)
    return data.user
  }, [fetchAccount])

  const quickSignup = useCallback(async (accountType = 'business') => {
    // Generate a best-effort device fingerprint so the backend can recognize
    // this device if it scans the same QR twice.
    const parts = [
      navigator.userAgent,
      navigator.language,
      window.screen.width,
      window.screen.height,
      new Date().getTimezoneOffset(),
    ]
    const fingerprintStr = parts.join('|')
    let fingerprintHash
    if (window.crypto && window.crypto.subtle) {
      const msgUint8 = new TextEncoder().encode(fingerprintStr)
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      fingerprintHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } else {
      // Fallback for non-secure contexts (http) or older browsers: a simple
      // non-cryptographic hash that handles non-ASCII characters.
      let hash = 0
      for (let i = 0; i < fingerprintStr.length; i++) {
        const char = fingerprintStr.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // Convert to 32bit integer
      }
      fingerprintHash = Math.abs(hash).toString(16) + '-' + btoa(unescape(encodeURIComponent(fingerprintStr.slice(0, 32)))).replace(/=/g, '')
    }

    const payload = {
      fingerprint_hash: fingerprintHash,
      account_type: accountType,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      is_pwa: window.matchMedia('(display-mode: standalone)').matches,
      connection_type: navigator.connection?.effectiveType || 'unknown',
    }

    let res
    try {
      res = await fetch(apiUrl('/api/auth/quick-signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
    } catch {
      throw new Error('Could not reach the server. Check your connection or the API configuration.')
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Quick signup failed')
      }
      throw new Error(`Quick signup failed (${res.status}) — the server returned an unexpected response. The API URL may be misconfigured.`)
    }
    const data = await res.json()
    setIsAuthenticated(true)
    setUser(data.user)
    await fetchAccount(data.user)
    return data.user
  }, [fetchAccount])

  const completeProfile = useCallback(async (payload) => {
    let res
    try {
      res = await fetch(apiUrl('/api/auth/complete-profile'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      })
    } catch {
      throw new Error('Could not reach the server. Check your connection or the API configuration.')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Could not save your details')
    }
    const data = await res.json()
    setUser(data)
    return data
  }, [])

  // --- Re-login without losing the screen ---------------------------------
  // When the server answers 401 mid-session we don't log out (that unmounts
  // every page and wipes open forms). We raise a "session expired" prompt on
  // top of the app, wait for the person to sign back in, then retry the
  // request that failed. Concurrent 401s share one prompt.
  const [sessionExpired, setSessionExpired] = useState(false)
  const reauthRef = useRef(null)

  const requestReauth = useCallback(() => {
    if (!reauthRef.current) {
      let resolve
      const promise = new Promise((r) => { resolve = r })
      reauthRef.current = { promise, resolve }
      setSessionExpired(true)
    }
    return reauthRef.current.promise
  }, [])

  const finishReauth = useCallback((ok) => {
    reauthRef.current?.resolve(ok)
    reauthRef.current = null
    setSessionExpired(false)
  }, [])

  const reauth = useCallback(async (password) => {
    let res
    try {
      res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user?.username, password }),
        credentials: 'include',
      })
    } catch {
      throw new Error('Could not reach the server — it may be restarting. Try again in a few seconds.')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Sign-in failed')
    }
    finishReauth(true)
  }, [user, finishReauth])

  const logout = useCallback(() => {
    if (isAuthenticated) {
      // Record the logout for the audit trail, then clear the server-side
      // cookie. Both fire-and-forget-ish, but we await the cookie clear so
      // we don't race a stale cookie against the next login.
      fetch(apiUrl('/api/activity/log'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'logout', details: 'User logged out' }),
      }).catch(() => {})
      fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {})
    }
    setIsAuthenticated(false)
    setUser(null)
    setAccount(null)
    reauthRef.current?.resolve(false)
    reauthRef.current = null
    setSessionExpired(false)
  }, [isAuthenticated])

  const cancelReauth = useCallback(() => { logout() }, [logout])

  return (
    <AuthContext.Provider value={{
      isAuthenticated, user, loading, login, loginAsDemo, quickSignup, completeProfile, logout,
      account, accountLoading, accountError, setAccount, refreshAccount,
      sessionExpired, requestReauth, reauth, cancelReauth,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
