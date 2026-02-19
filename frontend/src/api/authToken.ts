/**
 * authToken - shared singleton for the JWT access token
 *
 * This module breaks the circular dependency between:
 *   client.ts → useAuthStore → client.ts
 *
 * The auth store writes to this singleton when the token changes,
 * and the axios client reads from it in the request interceptor.
 *
 * This avoids module-level imports of useAuthStore inside client.ts.
 */

let _accessToken: string | null = null
let _clearAuthCallback: (() => void) | null = null
let _refreshTokenCallback: (() => Promise<string | null>) | null = null

export const authToken = {
  get(): string | null {
    return _accessToken
  },
  set(token: string | null) {
    _accessToken = token
  },
  setClearCallback(fn: () => void) {
    _clearAuthCallback = fn
  },
  setRefreshCallback(fn: () => Promise<string | null>) {
    _refreshTokenCallback = fn
  },
  async refresh(): Promise<string | null> {
    if (_refreshTokenCallback) {
      return _refreshTokenCallback()
    }
    return null
  },
  clearAuth() {
    if (_clearAuthCallback) {
      _clearAuthCallback()
    }
  },
}
