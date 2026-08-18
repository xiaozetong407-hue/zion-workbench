// 数据安全层：纯函数，零依赖（浏览器/Node 均可直接使用）
// 职责：schemaVersion 兼容框架、结构校验、深拷贝。事务式写入逻辑在 sync.js 的 commit()。

// 当前业务数据结构版本。没有 schemaVersion 的历史数据一律视为 v1。
export const SCHEMA_VERSION = 1

// 顶层已知字段 -> 期望类型（白名单）。未知字段允许存在（向后兼容未来版本）。
// 注意：字段值为 null/undefined 视为「缺失」，跳过类型检查（业务代码普遍有 || {} 兜底）；
// 只有「存在且类型不符」才算校验失败。
const OBJECT_KEYS = [
  'checkIns', 'status', 'reviews', 'plans',
  'monthReviews', 'yearReviews', 'prompts', 'settings',
  'wereadStat', 'studyPlans',
]
const ARRAY_KEYS = [
  'tasks', 'ideas', 'ledger', 'books', 'quotes',
  'wereadReviews', 'wereadBooks', 'favorites', 'studyLogs', 'pastReports',
]
const NUMBER_KEYS = ['wereadSyncAt', 'schemaVersion']
const BOOLEAN_KEYS = ['_seeded']
const STRING_KEYS = ['_lastTaskDay']

// 校验业务数据顶层结构，返回 { ok, errors }
export function validateData(data) {
  const errors = []
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['data 必须是普通对象'] }
  }
  for (const k of OBJECT_KEYS) {
    if (k in data && data[k] != null) {
      if (typeof data[k] !== 'object' || Array.isArray(data[k])) errors.push(`${k} 应为对象`)
    }
  }
  for (const k of ARRAY_KEYS) {
    if (k in data && data[k] != null) {
      if (!Array.isArray(data[k])) errors.push(`${k} 应为数组`)
    }
  }
  for (const k of NUMBER_KEYS) {
    if (k in data && data[k] != null && typeof data[k] !== 'number') errors.push(`${k} 应为数字`)
  }
  for (const k of BOOLEAN_KEYS) {
    if (k in data && data[k] != null && typeof data[k] !== 'boolean') errors.push(`${k} 应为布尔`)
  }
  for (const k of STRING_KEYS) {
    if (k in data && data[k] != null && typeof data[k] !== 'string') errors.push(`${k} 应为字符串`)
  }
  return { ok: errors.length === 0, errors }
}

// 读取数据的 schemaVersion（无则为 1）
export function schemaVersionOf(data) {
  return data && typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
}

// 迁移链：v1 -> v2 -> v3 …… 当前 SCHEMA_VERSION=1，无迁移（空跑，仅补版本字段）。
// 未来升版时在此追加迁移函数：
//   function migrateV1toV2(d) { ... 返回结构升级后的新对象 ... }
//   function migrateV2toV3(d) { ... }
// 约定：迁移只做「结构升级」，绝不删改业务字段；迁移结果不落盘前一律先过 validateData。
export function migrateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const v = schemaVersionOf(data)
  let cur = data
  // if (v < 2) cur = migrateV1toV2(cur)
  // if (v < 3) cur = migrateV2toV3(cur)
  // 无 schemaVersion（视为 v1）或版本低于当前 -> 补上当前版本号（内存副本，不落盘）
  // 未来版本数据（v > 当前）不动，保持原样（未知结构不得降级处理）
  const hasVersion = typeof data.schemaVersion === 'number'
  if (!hasVersion || v < SCHEMA_VERSION) {
    cur = { ...cur, schemaVersion: SCHEMA_VERSION }
  }
  return cur
}

// 深拷贝：优先 structuredClone，降级 JSON 序列化。
// 业务 blob 是纯 JSON 数据（无 Date/Blob/函数），两种方式都安全。
export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj) } catch { /* 降级 */ }
  }
  return JSON.parse(JSON.stringify(obj))
}
