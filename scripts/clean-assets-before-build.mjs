// 构建前清空 dist/assets（0.32.1 修正）：
// 让 vite build 生成的 sw.js precache 只包含本次新哈希资源，杜绝「旧文件残留被误缓存」。
// 背景：OneDrive 中文路径下目录删除走 safe-delete(trash) 失败，故逐文件 unlinkSync；
//       本环境 unlinkSync 可能抛 safe-delete 错误但文件实际已删除，故删除后复查 existsSync。
import { readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = join(root, '成品与文档', 'dist', 'assets')
if (!existsSync(assetsDir)) {
  console.log('[clean-assets] 无 assets 目录，跳过')
  process.exit(0)
}

let removed = 0
for (const f of readdirSync(assetsDir)) {
  try {
    unlinkSync(join(assetsDir, f))
  } catch (e) {
    if (existsSync(join(assetsDir, f))) {
      console.warn('[clean-assets] 删除失败且文件仍存在：', f, e.message)
      continue
    }
  }
  removed += 1
}

console.log(`[clean-assets] 构建前清空 ${removed} 个旧 assets 文件`)
