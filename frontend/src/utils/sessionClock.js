// Last session-expiry time (ms epoch) the server told us about, via the
// X-Session-Expires header on every authenticated response. Module-level so
// useApi can write it and the status banner can read it without re-renders.
let expiresAt = null
export const setSessionExpiry = (ms) => { expiresAt = ms }
export const getSessionExpiry = () => expiresAt
