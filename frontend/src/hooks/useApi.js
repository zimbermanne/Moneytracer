import { useCallback } from 'react'
import { useAuth } from './useAuth.jsx'

export function useApi() {
  const { token, logout } = useAuth()

  const request = useCallback(async (path, options = {}) => {
    const headers = { ...(options.headers || {}) }
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`/api${path}`, { ...options, headers })

    if (res.status === 401) {
      logout()
      throw new Error('Session expired, please log in again')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Request failed (${res.status})`)
    }
    if (res.status === 204) return null
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return res.json()
    return res
  }, [token, logout])

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
    del: (path) => request(path, { method: 'DELETE' }),
  }
}
