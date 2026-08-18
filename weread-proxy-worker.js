// 微信读书代理 · Cloudflare Worker
// 部署：登录 https://workers.cloudflare.com → 创建 Worker → 把本文件内容粘贴进去 → 部署
// 得到 https://<你的子域>.workers.dev 后，填入 App「我 → 微信读书代理」。
// 作用：把浏览器发来的 POST /api/weread 转发到微信读书网关，绕开 CORS。
// Key 仅作为 Authorization 头原样转发，代理不存储任何用户数据。

const UPSTREAM = 'https://i.weread.qq.com/api/agent/gateway'

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // 处理浏览器跨域预检（Authorization 头会触发 OPTIONS）
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/weread') {
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
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: 'proxy_failed', message: String(e) }), {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}
