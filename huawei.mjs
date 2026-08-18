// 华为运动健康 Health Kit —— 个人本地应用极简封装
//
// 设计思路（个人、非商用、最小复杂度）：
//   1) 一次性授权：运行 `npm run huawei:auth`，脚本临时起一个 localhost 收 OAuth 回调，
//      用 code 换 token，把 refresh_token 落盘到本地 .huawei-token.json（不进 git）。
//   2) 日常拉取：server.js 的 /api/huawei/data 直接用 refresh_token 换新 access_token，
//      调 Health Kit 读步数/卡路里/睡眠，不再每次重定向浏览器走完整 OAuth。
//
// 凭证只存在于服务端（.env 或环境变量），绝不下发前端：
//   HUAWEI_CLIENT_ID      华为开发者联盟应用 Client ID
//   HUAWEI_CLIENT_SECRET  华为开发者联盟应用 Client Secret
//   HUAWEI_REDIRECT_URI   一次性授权回调地址，默认 http://localhost:4188/callback
//                        （需在华为开发者联盟「OAuth 2.0 授权回调地址」登记这一条）
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '.env')
const TOKEN_PATH = path.join(__dirname, '.huawei-token.json')

const AUTH_BASE = 'https://oauth-login.cloud.huawei.com/oauth2/v3'
const TOKEN_PATH_HUAWEI = '/oauth2/v3/token'
const HEALTH_HOST = 'health-api.cloud.huawei.com'
const HEALTH_PATH = '/healthkit/v2/sampleSet:dailyPolymerize'
const SCOPE = 'https://www.huawei.com/healthkit.step.read https://www.huawei.com/healthkit.calorie.read https://www.huawei.com/healthkit.activity.read https://www.huawei.com/healthkit.sleep.read'
const DEFAULT_REDIRECT = 'http://localhost:4188/callback'

// ---- .env 零依赖解析 ----
export function loadCreds() {
  const env = {}
  try {
    const text = fs.readFileSync(ENV_PATH, 'utf8')
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    })
  } catch (e) { /* 无 .env 则回退到 process.env */ }
  return {
    clientId: env.HUAWEI_CLIENT_ID || process.env.HUAWEI_CLIENT_ID || '',
    clientSecret: env.HUAWEI_CLIENT_SECRET || process.env.HUAWEI_CLIENT_SECRET || '',
    redirectUri: env.HUAWEI_REDIRECT_URI || process.env.HUAWEI_REDIRECT_URI || DEFAULT_REDIRECT,
  }
}

export function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
  } catch (e) {
    return null
  }
}

export function saveToken(t) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2))
}

function reqHttps(hostname, p, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null
    const opt = {
      method,
      hostname,
      path: p,
      headers: {
        'Content-Type': data && method !== 'GET' ? 'application/json' : 'application/x-www-form-urlencoded',
        ...headers,
      },
    }
    if (data) opt.headers['Content-Length'] = Buffer.byteLength(data)
    const r = https.request(opt, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        let json
        try { json = d ? JSON.parse(d) : {} } catch (e) { json = { raw: d } }
        resolve({ status: res.statusCode, body: json })
      })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

export function getAuthUrl(creds) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    scope: SCOPE,
    state: 'zion',
  })
  return `${AUTH_BASE}/authorize?${q.toString()}`
}

export async function exchangeCodeForToken(code, creds) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: creds.redirectUri,
  })
  const r = await reqHttps('oauth-login.cloud.huawei.com', TOKEN_PATH_HUAWEI, { method: 'POST', body: form.toString() })
  const b = r.body || {}
  if (!b.access_token) throw new Error('token 换取失败: ' + JSON.stringify(b))
  return {
    access: b.access_token,
    refresh: b.refresh_token || '',
    expireAt: Date.now() + (Number(b.expires_in) || 3600) * 1000,
  }
}

// 用 refresh_token 换新 access_token（华为 refresh_token 失效则需重新跑授权脚本）
export async function refreshAccessToken(creds, refreshToken) {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })
  const r = await reqHttps('oauth-login.cloud.huawei.com', TOKEN_PATH_HUAWEI, { method: 'POST', body: form.toString() })
  const b = r.body || {}
  if (!b.access_token) throw new Error('refresh 失败: ' + JSON.stringify(b))
  return {
    access: b.access_token,
    refresh: b.refresh_token || refreshToken,
    expireAt: Date.now() + (Number(b.expires_in) || 3600) * 1000,
  }
}

// 取一个有效的 access_token：优先用已存 token，临近过期则用 refresh_token 换新并落盘
export async function getValidAccessToken() {
  const creds = loadCreds()
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('缺少 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET（写入 .env 或环境变量）')
  }
  const t = loadToken()
  if (!t || !t.refresh) throw new Error('NOT_AUTHORIZED')
  if (t.access && t.expireAt && t.expireAt > Date.now() + 60 * 1000) return t.access
  const refreshed = await refreshAccessToken(creds, t.refresh)
  saveToken(refreshed)
  return refreshed.access
}

export async function fetchHealthData(accessToken) {
  const end = Date.now()
  const start = end - 7 * 24 * 3600 * 1000
  const body = {
    dataTypes: [
      'com.huawei.continuous.steps.delta',
      'com.huawei.continuous.calories.burnt.total',
      'com.huawei.health.sleep',
    ],
    startTime: start,
    endTime: end,
  }
  return reqHttps(HEALTH_HOST, HEALTH_PATH, {
    method: 'POST',
    body,
    headers: { Authorization: 'Bearer ' + accessToken },
  })
}
