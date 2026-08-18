// 微信读书代理 · Cloudflare Worker
// 部署：登录 https://workers.cloudflare.com → 创建 Worker → 把本文件内容粘贴进去 → 部署
// 得到 https://<你的子域>.workers.dev 后，填入 App「我 → 微信读书代理（高级）」。
// 作用：把浏览器发来的 POST /api/weread 转发到微信读书 Agent Gateway，绕开 CORS。
// Key 仅作为 Authorization 头原样转发，Worker 不存储、不记录、不硬编码任何用户 Key。

// 允许调用的正式前端 origin（精确白名单；如新增环境在此追加）
const ALLOWED_ORIGINS = [
  'https://xiaozetong407-hue.github.io',
  'https://8b8e47a9331742b88bd666f979190500.bj8.agentos-app.net',
]

const UPSTREAM = 'https://i.weread.qq.com/api/agent/gateway'

// 返回当前请求的允许 origin；不在白名单返回 null（不跨域放行，但非浏览器调用不受影响）
function allowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  if (!origin) return null
  return ALLOWED_ORIGINS.includes(origin) ? origin : null
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (origin) h['Access-Control-Allow-Origin'] = origin
  return h
}

export default {
  async fetch(request) {
    const origin = allowedOrigin(request)
    const cors = corsHeaders(origin)

    // 浏览器跨域预检（Authorization 头会触发 OPTIONS）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (request.method === 'POST' && new URL(request.url).pathname === '/api/weread') {
      const auth = request.headers.get('Authorization') || ''
      const body = await request.text()
      try {
        const upstream = await fetch(UPSTREAM, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': auth,
          },
          body,
        })
        const text = await upstream.text()
        return new Response(text, {
          status: upstream.status,
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            cors
          ),
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: 'proxy_failed', message: String(e) }), {
          status: 502,
          headers: Object.assign({ 'Content-Type': 'application/json' }, cors),
        })
      }
    }

    return new Response('Not Found', { status: 404, headers: cors })
  },
}
