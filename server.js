// 极简生产代理：托管构建产物 + 转发微信读书 API + 华为运动健康数据拉取
// 运行：node server.js（或 npm run serve），默认端口 4173，可用 PORT 环境变量覆盖
//
// 华为：先 `npm run huawei:auth` 一次性授权（把 refresh_token 存到 .huawei-token.json），
//       之后本服务 /api/huawei/data 直接用 refresh_token 拉步数/卡路里/睡眠，无需常驻回调路由。
import http from 'node:http'
import https from 'node:https'
import { getValidAccessToken, fetchHealthData } from './huawei.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '成品与文档', 'dist')
const PORT = process.env.PORT || 4173
const STORE = path.join(__dirname, 'zion-sync-store.json')
const WEREAD_HOST = 'i.weread.qq.com'
const WEREAD_PATH = '/api/agent/gateway'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  let filePath = path.join(DIST, urlPath)
  // SPA 回退：文件不存在则交给 index.html（支持客户端路由）
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 500; res.end('read error'); return }
    res.end(data)
  })
}

function proxyWeread(req, res) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const opt = {
      method: 'POST',
      hostname: WEREAD_HOST,
      path: WEREAD_PATH,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        // 客户端传来的 Authorization（wrk- Key）原样转发，代理不存储 Key
        'Authorization': req.headers['authorization'] || '',
      },
    }
    const p = https.request(opt, (pres) => {
      const out = []
      pres.on('data', (c) => out.push(c))
      pres.on('end', () => {
        res.statusCode = pres.statusCode
        res.setHeader('Content-Type', pres.headers['content-type'] || 'application/json')
        res.end(Buffer.concat(out))
      })
    })
    p.on('error', (e) => { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })) })
    p.write(body)
    p.end()
  })
}

// /api/huawei/data：用本地 refresh_token 换新 access_token 后拉取步数/卡路里
async function huaweiData(res) {
  try {
    const access = await getValidAccessToken()
    const r = await fetchHealthData(access)
    res.statusCode = r.status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(r.body))
  } catch (e) {
    const needAuth = e.message === 'NOT_AUTHORIZED'
    res.statusCode = needAuth ? 401 : 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(needAuth
      ? { error: 'not authorized', needAuth: true }
      : { error: e.message }))
  }
}

// /api/sync：双端同步。服务器持有整个 zion-data-v1 blob 的唯一真值。
// GET -> { rev, blob }；POST { blob, rev } -> 乐观并发：rev 匹配则接受并 rev+1，
// 否则返回 409（客户端拉取合并后重试）。无鉴权（仅本机 + 局域网个人使用，切勿暴露公网）。
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'))
  } catch {
    return { rev: 0, blob: {} }
  }
}
function writeStore(obj) {
  fs.writeFileSync(STORE, JSON.stringify(obj))
}
function syncGet(res) {
  const store = readStore()
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(store))
}
function syncPost(req, res) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      res.statusCode = 400; res.end('bad json'); return
    }
    const store = readStore()
    const clientRev = Number(body.rev) || 0
    if (store.rev !== clientRev) {
      // 冲突：服务器已被其他设备更新，退回让客户端重拉合并
      res.statusCode = 409
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(store))
      return
    }
    store.blob = body.blob && typeof body.blob === 'object' ? body.blob : {}
    store.rev = store.rev + 1
    writeStore(store)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, rev: store.rev }))
  })
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/huawei')) return huaweiData(res)
  if ((req.url || '').startsWith('/api/sync')) {
    if (req.method === 'GET') return syncGet(res)
    if (req.method === 'POST') return syncPost(req, res)
    res.statusCode = 405; res.end('method not allowed'); return
  }
  if (req.method === 'POST' && (req.url || '').startsWith('/api/weread')) return proxyWeread(req, res)
  return serveStatic(req, res)
})

server.listen(PORT, '0.0.0.0', () => {
  const nets = []
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) nets.push(ni.address)
      }
    }
  } catch {}
  console.log(`[zion] 生产服务已启动: http://localhost:${PORT}`)
  if (nets.length) console.log(`[zion] 手机访问（同 WiFi）: http://${nets[0]}:${PORT}`)
  console.log(`[zion] 静态目录: ${DIST}`)
  console.log(`[zion] /api/weread -> https://${WEREAD_HOST}${WEREAD_PATH}`)
  console.log(`[zion] /api/huawei/data -> 华为运动健康（需先 npm run huawei:auth 一次性授权）`)
  console.log(`[zion] /api/sync -> 双端数据同步（仅本机/局域网，勿暴露公网）`)
})
