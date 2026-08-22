// 1.1.1 存储守卫测试：使用痕迹检测 + 持久化存储保护（优雅降级，永不抛错）
// 对应需求场景：② 真正首次使用 ③ 疑似历史数据丢失 ⑤ persist 支持 ⑥ persist 不支持 ⑦ persist 被拒绝
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

function createMockStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

beforeEach(() => {
  globalThis.localStorage = createMockStorage()
  try { delete globalThis.navigator } catch { globalThis.navigator = undefined }
})

const { hasUsageTraces, requestPersist, getPersistence } = await import('../src/store/storageGuard.js')

// ---- 使用痕迹检测 ----

test('无任何痕迹 -> 视为首次使用（hasUsageTraces=false，允许 ensureSeed）', () => {
  assert.equal(hasUsageTraces(), false)
})

test('场景3：正式数据不存在 + 有 zion-tab 痕迹 -> 疑似历史数据丢失（不得静默初始化）', () => {
  assert.equal(localStorage.getItem('zion-data-v1'), null) // 正式数据不存在
  localStorage.setItem('zion-tab', 'tasks') // 但曾切换过页面（使用痕迹）
  assert.equal(hasUsageTraces(), true) // 启动门禁凭此进入异常恢复提示，而非 seed
})

test('导出备份时间戳存在 -> 有使用痕迹', () => {
  localStorage.setItem('zion-last-backup-at', '1755400000000')
  assert.equal(hasUsageTraces(), true)
})

test('场景4：zion-backup-last 存在 -> 有使用痕迹（应提示恢复）', () => {
  localStorage.setItem('zion-backup-last', '{"checkIns":{}}')
  assert.equal(hasUsageTraces(), true)
})

test('打卡/状态/复盘草稿、微信读书 Key 也算使用痕迹', () => {
  localStorage.setItem('zion-checkin-draft', '{}')
  assert.equal(hasUsageTraces(), true)
})

// ---- 持久化存储保护（降级） ----

test('场景6：navigator.storage 不存在 -> unsupported，不抛错、不阻塞', async () => {
  assert.equal(await requestPersist(), 'unsupported')
  assert.equal(await getPersistence(), 'unsupported')
})

test('场景7：persist() 被拒绝 -> 降级 normal，不抛错', async () => {
  globalThis.navigator = {
    storage: {
      persist: () => Promise.reject(new Error('denied')),
      persisted: () => Promise.resolve(false),
    },
  }
  assert.equal(await requestPersist(), 'normal')
})

test('场景5：persist 支持且 persisted=true -> persisted', async () => {
  globalThis.navigator = {
    storage: {
      persist: () => Promise.resolve(),
      persisted: () => Promise.resolve(true),
    },
  }
  assert.equal(await requestPersist(), 'persisted')
})

test('persist 正常但 persisted=false -> normal（以实际查询为准，不假设已保护）', async () => {
  globalThis.navigator = {
    storage: {
      persist: () => Promise.resolve(),
      persisted: () => Promise.resolve(false),
    },
  }
  assert.equal(await requestPersist(), 'normal')
})

test('persisted() 抛异常 -> 降级 normal，不抛错', async () => {
  globalThis.navigator = {
    storage: {
      persist: () => Promise.resolve(),
      persisted: () => Promise.reject(new Error('boom')),
    },
  }
  assert.equal(await getPersistence(), 'normal')
})
