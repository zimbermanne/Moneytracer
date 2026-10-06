import { useCallback } from 'react'
import { useAuth } from './useAuth.jsx'
import { apiUrl } from '../api-config.js'
import { setSessionExpiry } from '../utils/sessionClock.js'

export function useApi() {
  const { logout, requestReauth } = useAuth()

  const request = useCallback(async (path, options = {}) => {
    const headers = { ...(options.headers || {}) }
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    const send = async () => {
      try {
        // credentials: 'include' sends the httpOnly auth cookie set on login —
        // the browser handles this automatically; there's no token in JS to
        // attach manually (that's the point: nothing here is readable by an
        // injected script).
        const r = await fetch(apiUrl(`/api${path}`), { ...options, headers, credentials: 'include' })
        const exp = r.headers.get('x-session-expires')
        if (exp) setSessionExpiry(Number(exp) * 1000)
        return r
      } catch {
        throw new Error('Could not reach the server. Check your connection or the API configuration.')
      }
    }

    let res = await send()

    if (res.status === 401) {
      // Don't log out (that would wipe whatever the person is filling in).
      // Ask them to sign back in on top of the current screen, then retry once.
      const ok = await requestReauth()
      if (ok) res = await send()
      if (!ok || res.status === 401) {
        logout()
        throw new Error('Session expired, please log in again')
      }
    }
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Request failed (${res.status})`)
      }
      throw new Error(`Request failed (${res.status}) — the server returned an unexpected response. The API URL may be misconfigured.`)
    }
    if (res.status === 204) return null
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return res.json()
    return res
  }, [logout, requestReauth])

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    del: (path) => request(path, { method: 'DELETE' }),
  }
}
