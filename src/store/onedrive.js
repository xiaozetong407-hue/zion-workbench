// Microsoft Graph（OneDrive）作为数据同步后端。
// 认证：Entra ID 公共客户端 + PKCE（无客户端密钥，纯前端，个人账号可用）。
// 数据：整个 zion-data-v1 blob 读写到 OneDrive 文件 /zion-workbench/zion-data.json。
// 注意：必须在「安全上下文」（https 或 localhost）下运行，否则 crypto.subtle 不可用。

const TENANT = 'common'
const SCOPES = ['Tasks.ReadWrite', 'offline_access'] // 仅 To Do：读写待办 + 刷新令牌
const FILE_PATH = 'zion-workbench/zion-data.json'
const CLIENT_ID_KEY = 'zion-ms-client-id'

// Client ID 两种来源：构建期注入 VITE_MICROSOFT_CLIENT_ID，或运行时在「我」页填写（存 localStorage）
function getClientId() {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) || import.meta.env.VITE_MICROSOFT_CLIENT_ID || ''
  } catch {
    return import.meta.env.VITE_MICROSOFT_CLIENT_ID || ''
  }
}
function setClientId(id) {
  try {
    if (id && String(id).trim()) localStorage.setItem(CLIENT_ID_KEY, String(id).trim())
    else localStorage.removeItem(CLIENT_ID_KEY)
  } catch { /* ignore */ }
}

// 登录完成（授权回跳换到 token 后）通知订阅者，便于面板刷新
const authListeners = new Set()
function emitAuth() {
  authListeners.forEach((cb) => { try { cb() } catch { /* ignore */ } })
}
const TOKEN_KEY = 'zion-ms-token'
const VERIFIER_KEY = 'zion-ms-verifier'

function redirectUri() {
  // 去掉 hash，保留 origin + pathname（如 https://x.github.io/zion-workbench/）
  return window.location.origin + window.location.pathname
}
const AUTH = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const GRAPH = 'https://graph.microsoft.com/v1.0'

function bufToBase64Url(buf) {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function sha256(str) {
  const data = new TextEncoder().encode(str)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bufToBase64Url(digest)
}
function randomString(len) {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return bufToBase64Url(arr)
}

export const onedrive = {
  isConfigured() {
    return !!getClientId()
  },
  getClientId,
  setClientId,
  getRedirectUri: redirectUri,
  onAuth(cb) {
    authListeners.add(cb)
    return () => authListeners.delete(cb)
  },

  async signIn() {
    if (!getClientId()) throw new Error('未配置 Microsoft Client ID（请在「我」页填写）')
    const verifier = randomString(64)
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    const challenge = await sha256(verifier)
    const params = new URLSearchParams({
      client_id: getClientId(),
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: randomString(16),
      prompt: 'select_account',
    })
    window.location.href = `${AUTH}?${params.toString()}`
  },

  // 页面加载时调用：若 URL 带 code（微软授权跳回），则换取 token
  async handleRedirect() {
    const sp = new URLSearchParams(window.location.search)
    const code = sp.get('code')
    if (!code) return false
    const verifier = sessionStorage.getItem(VERIFIER_KEY) || ''
    sessionStorage.removeItem(VERIFIER_KEY)
    const url = new URL(window.location.href)
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    window.history.replaceState({}, '', url.pathname + url.search)
    try {
      const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: getClientId(),
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(),
          code_verifier: verifier,
        }),
      })
      if (!res.ok) return false
      const d = await res.json()
      this._storeToken(d)
      emitAuth()
      return true
    } catch {
      return false
    }
  },

  _storeToken(d) {
    const token = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    }
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
  },

  getTokenInfo() {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null
    } catch {
      return null
    }
  },

  isSignedIn() {
    const t = this.getTokenInfo()
    return !!(t && t.access_token)
  },

  async getValidToken() {
    const t = this.getTokenInfo()
    if (!t) return null
    if (t.expires_at - Date.now() > 60000) return t.access_token
    if (!t.refresh_token) return null
    try {
      const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: getClientId(),
          grant_type: 'refresh_token',
          refresh_token: t.refresh_token,
          scope: SCOPES.join(' '),
        }),
      })
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY)
        return null
      }
      const d = await res.json()
      this._storeToken(d)
      return d.access_token
    } catch {
      return null
    }
  },

  signOut() {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(VERIFIER_KEY)
  },

  // 返回 { blob, etag }；文件不存在返回 { blob: {}, etag: null }
  async download() {
    const token = await this.getValidToken()
    if (!token) return null
    const url = `${GRAPH}/me/drive/root:/${FILE_PATH}:/content`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 404) return { blob: {}, etag: null }
    if (!res.ok) throw new Error('download ' + res.status)
    const etag = res.headers.get('etag') || ''
    const text = await res.text()
    let blob = {}
    try {
      blob = JSON.parse(text)
    } catch {
      blob = {}
    }
    return { blob, etag }
  },

  // 上传 blob，带 If-Match etag 做乐观并发。返回 { ok, conflict, etag }
  async upload(blob, etag) {
    const token = await this.getValidToken()
    if (!token) return { ok: false, conflict: false }
    const url = `${GRAPH}/me/drive/root:/${FILE_PATH}:/content`
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    if (etag) headers['If-Match'] = etag
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(blob),
    })
    if (res.status === 412) return { ok: false, conflict: true }
    if (!res.ok) return { ok: false, conflict: false }
    const etag2 = res.headers.get('etag') || ''
    return { ok: true, conflict: false, etag: etag2 }
  },
}

export default onedrive
