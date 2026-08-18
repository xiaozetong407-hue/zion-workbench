import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base './' 让构建产物可在子路径 / 直接打开文件时正常运行
// 构建成品统一输出到 成品与文档/dist（与源码分离，便于交付查看）
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: 'public/manifest.webmanifest',
      workbox: {
        // P7 整改：HTML 永不预缓存（白屏根因修复）——只缓存带 hash 的静态资源
        globPatterns: ['**/*.{js,css,svg,png,ico,woff2}'],
        // 数据抢救页（data-export.html）必须始终走网络、不被 SW 预缓存
        globIgnores: ['**/data-export.html'],
        cleanupOutdatedCaches: true,
        // 导航请求 NetworkFirst：在线取新 HTML，网络失败降级最近一次成功缓存；
        // data-export / 恢复相关路径完全绕过 SW（denylist）
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !url.pathname.includes('data-export'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'zion-html',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
        // 不设置 navigateFallback：本应用无深链接，避免「旧 HTML fallback」造成版本错配。
        // 显式置 undefined 以覆盖 vite-plugin-pwa 默认的 navigateFallback:'index.html'
        navigateFallback: undefined,
      },
    }),
  ],
  build: {
    outDir: '成品与文档/dist',
    // OneDrive 中文路径下自动清空 dist 会触发 safe-delete 失败，故关闭自动清空（旧哈希资源无害，index.html 只引用新资源）
    emptyOutDir: false,
  },
  server: {
    // 开发态把前端同源请求 /api/weread 转发到微信读书网关，
    // 绕开 CORS（生产部署需配套后端代理，详见汇报）
    proxy: {
      '/api/weread': {
        target: 'https://i.weread.qq.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/weread/, '/api/agent/gateway'),
      },
      // 华为运动健康 OAuth：开发态代理到生产服务器（4173，由 server.js 处理），
      // proxy 优先级高于 Vite SPA 兜底，可正确转发 /api/huawei/*
      '/api/huawei': {
        target: 'http://localhost:4173',
        changeOrigin: true,
      },
    },
  },
})
