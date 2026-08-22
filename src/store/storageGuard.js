// 存储安全守卫（1.1.1 数据可靠性升级）
// 职责（全部只读/无副作用，永不抛错、永不阻塞启动）：
//   - requestPersist()：启动时请求浏览器持久化存储保护（降低自动清理风险，非绝对保险）
//   - getPersistence()：查询当前持久化状态（以 persisted() 结果为准）
//   - hasUsageTraces()：检测「过去使用过 Zion」的痕迹（用于区分首次使用 vs 疑似数据丢失）
//
// 降级原则：API 不存在 / Promise reject / 权限异常 → 一律返回安全值，应用正常运行。

// 使用痕迹 key（不含 zion-data-v1 本身）：任一存在即视为「用过」
// - zion-tab：每次切换页面都会写入（最可靠的日常使用痕迹）
// - zion-last-backup-at：导出过备份（1.1.0+）
// - zion-backup-last：做过导入操作（导入前自动备份）
// - 各草稿 / 微信读书 Key：日常使用痕迹
const USAGE_TRACES = [
  'zion-tab',
  'zion-last-backup-at',
  'zion-backup-last',
  'zion-checkin-draft',
  'zion-status-draft',
  'zion-review-draft',
  'zion-weread-key',
]

// 检测本浏览器是否残留「使用过 Zion」的痕迹
export function hasUsageTraces() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false
    return USAGE_TRACES.some((k) => localStorage.getItem(k) != null)
  } catch {
    return false
  }
}

// 查询浏览器 Storage API 能力
function storageApi() {
  try {
    if (typeof navigator === 'undefined' || !navigator || !navigator.storage) return null
    return navigator.storage
  } catch {
    return null
  }
}

// 启动时请求持久化存储保护（一次即可，浏览器会记住授权结果）。
// 返回最终状态：'persisted' | 'normal' | 'unsupported'。任何异常都安全降级。
export async function requestPersist() {
  try {
    const s = storageApi()
    if (!s || typeof s.persist !== 'function') return 'unsupported'
    try { await s.persist() } catch { /* 请求被拒绝/异常：以 persisted() 实际结果为准 */ }
    return await getPersistence()
  } catch {
    return 'normal'
  }
}

// 查询当前持久化状态（不发起请求）：'persisted' | 'normal' | 'unsupported' | 'unknown'
export async function getPersistence() {
  try {
    const s = storageApi()
    if (!s || typeof s.persisted !== 'function') return 'unsupported'
    const ok = await s.persisted()
    return ok ? 'persisted' : 'normal'
  } catch {
    return 'normal'
  }
}
