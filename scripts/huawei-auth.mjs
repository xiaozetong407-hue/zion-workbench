// 一次性华为运动健康授权（个人本地用）
//
// 用法：
//   1) 在项目根目录 .env 填写 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET
//   2) 在华为开发者联盟把「OAuth 2.0 授权回调地址」登记为 http://localhost:4188/callback
//   3) 运行 `npm run huawei:auth`
//   4) 按提示在浏览器打开授权页，登录华为账号并点「同意」
//   5) 本脚本收完 code 换 token，存到 .huawei-token.json 后自动退出
//
// 之后日常只需 `npm run serve` 起服务，在 zion 状态栏点「同步今日数据」即可。
import http from 'node:http'
import { loadCreds, getAuthUrl, exchangeCodeForToken, saveToken } from '../huawei.mjs'

const DEFAULT_PORT = 4188
const creds = loadCreds()

if (!creds.clientId || !creds.clientSecret) {
  console.error('\n✗ 缺少 HUAWEI_CLIENT_ID / HUAWEI_CLIENT_SECRET。')
  console.error('  请在项目根目录创建 .env 并填写（参考 .env.example），然后重试。\n')
  process.exit(1)
}

const redirectUri = creds.redirectUri || 'http://localhost:4188/callback'
const listenPort = Number(new URL(redirectUri).port) || DEFAULT_PORT

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost')
  if (parsed.pathname !== '/callback') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const code = parsed.searchParams.get('code')
  if (!code) {
    res.statusCode = 400
    res.end('missing code')
    return
  }
  try {
    const token = await exchangeCodeForToken(code, creds)
    saveToken(token)
    res.statusCode = 200
    res.end('✓ 华为运动健康授权成功！你可以关闭此页面，回到终端。token 已保存。')
    console.log('✓ 授权成功，token 已保存到 .huawei-token.json')
    server.close(() => process.exit(0))
  } catch (e) {
    res.statusCode = 500
    res.end('授权失败：' + e.message)
    console.error('\n✗ 授权失败：', e.message, '\n')
    server.close(() => process.exit(1))
  }
})

server.listen(listenPort, () => {
  const authUrl = getAuthUrl(creds)
  console.log('\n请在浏览器中打开以下地址完成华为授权：\n')
  console.log('  ' + authUrl + '\n')
  console.log('登录你的华为账号并点击「同意」后，本脚本会自动收尾并保存 token。\n')
  console.log('（如浏览器未自动跳转回本机，请确认已在华为开发者联盟把回调地址登记为：')
  console.log('   ' + redirectUri + ' ）\n')
})
