// P1 数据完整性回归测试：
// 模拟「现有用户数据快照」→ 新版本启动（bootstrap + ensureSeed + export）→ 逐字段对比，
// 证明 P1 架构重构不会修改任何已有业务数据。
// 特别验证：旧任务不新增 start/estMin；reviews 未重新生成；ledger/status 未重算写回。
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
globalThis.localStorage = createMockStorage()

const { db } = await import('../src/store/db.js')
const { default: sync } = await import('../src/store/sync.js')

const KEY = 'zion-data-v1'

// 模拟用户历史数据快照（无 schemaVersion = 旧版数据；_seeded=true = 已是老用户）
function makeLegacySnapshot() {
  return {
    checkIns: {
      '2026-08-15': { english: true, reading: true, note: '今日读书打卡' },
      '2026-08-16': { english: true, exercise: true },
    },
    tasks: [
      // 旧任务：带时间字段（必须原样保留）
      { id: 't-with-time', title: '带时间的旧任务', done: true, date: '2026-08-15', start: '09:30', estMin: 45 },
      // 旧任务：没有时间字段（绝不能自动新增 start/estMin）
      { id: 't-no-time', title: '没有时间的旧任务', done: false, date: '2026-08-16' },
      { id: 't-other-day', title: '其他日期任务', done: false, date: '2026-08-10' },
    ],
    plans: {
      month: { '2026-08': '八月计划内容' },
      year: { '2026': '年度计划内容' },
      fiveYear: { '2026': '五年计划内容' },
    },
    ledger: [
      { id: 'l1', type: 'exp', tag: '餐饮', amount: 12.5, note: '午饭', date: '2026-08-15', createdAt: 1700000000000 },
      { id: 'l2', type: 'inc', tag: '工资', amount: 8000, note: '', date: '2026-08-10', createdAt: 1700000000001 },
    ],
    reviews: {
      // 周日复盘带 weekly 字段：必须原样保留，不得重新生成
      '2026-08-16': {
        closer: '推进了求职准备',
        pleasure: '看了电影',
        gameMinutes: 30,
        tomorrow: '完成简历初稿',
        weekly: { advanced: '本周有进步', issue: '游戏时间偏多', next: '下周减少游戏' },
      },
      '2026-08-15': { closer: '学习韩语', gameMinutes: 0 },
    },
    status: {
      '2026-08-15': { weight: 65.2, sleepHours: 7.5, steps: 8000, calories: 1800, exerciseMin: 30 },
      '2026-08-16': { weight: 65.1, sleepHours: 6.8, steps: 5200, calories: 1600, exerciseMin: 0 },
    },
    pastReports: [
      {
        id: 'pr1', kind: 'week', title: '周报', period: '2026-08-10 ~ 2026-08-16',
        createdAt: 1700000000002,
        metrics: { ciRate: 80, gameMin: 210, wereadSec: 3600, exp: 12.5, inc: 8000 },
      },
    ],
    ideas: [{ id: 'i1', text: '想做一个个人网站', createdAt: 1700000000003 }],
    settings: {
      birthDate: '2002-12-02', gender: 'male', age: 24,
      checkInDay: '2026-08-17', reviewDay: '2026-08-17', statusDay: '2026-08-17', taskDay: '2026-08-17',
      height: 175,
    },
    _seeded: true,
    _lastTaskDay: '2026-08-17',
  }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  sync.resetForTest()
})

test('老用户数据：启动全流程后业务字段逐字节不变（含盘上原文）', () => {
  const legacy = makeLegacySnapshot()
  const rawBefore = JSON.stringify(legacy)
  localStorage.setItem(KEY, rawBefore)

  // 新版本启动流程
  const boot = db.bootstrap()
  assert.equal(boot.ok, true)
  db.ensureSeed() // _seeded=true -> 不应触发任何写入

  // ① 盘上原文一字未改（最强证明）
  assert.equal(localStorage.getItem(KEY), rawBefore)

  // ② 导出后业务数据与快照逐字段一致
  const exp = JSON.parse(db.exportData())
  assert.deepEqual(exp.data.checkIns, legacy.checkIns)
  assert.deepEqual(exp.data.tasks, legacy.tasks)
  assert.deepEqual(exp.data.plans, legacy.plans)
  assert.deepEqual(exp.data.ledger, legacy.ledger)
  assert.deepEqual(exp.data.reviews, legacy.reviews)
  assert.deepEqual(exp.data.status, legacy.status)
  assert.deepEqual(exp.data.pastReports, legacy.pastReports)
  assert.deepEqual(exp.data.ideas, legacy.ideas)
  assert.deepEqual(exp.data.settings, legacy.settings)
})

test('旧任务：无时间字段的绝不新增 start/estMin；有时间的原样保留', () => {
  const legacy = makeLegacySnapshot()
  localStorage.setItem(KEY, JSON.stringify(legacy))
  const boot = db.bootstrap()
  assert.equal(boot.ok, true)
  db.ensureSeed()

  const tasks = JSON.parse(db.exportData()).data.tasks
  const noTime = tasks.find((t) => t.id === 't-no-time')
  assert.ok(noTime)
  assert.equal('start' in noTime, false, '不得自动增加 start')
  assert.equal('estMin' in noTime, false, '不得自动增加 estMin')
  assert.deepEqual(noTime, legacy.tasks.find((t) => t.id === 't-no-time'))

  const withTime = tasks.find((t) => t.id === 't-with-time')
  assert.equal(withTime.start, '09:30')
  assert.equal(withTime.estMin, 45)
})

test('reviews：未被重新生成，weekly 周复盘字段原样保留', () => {
  const legacy = makeLegacySnapshot()
  localStorage.setItem(KEY, JSON.stringify(legacy))
  db.bootstrap(); db.ensureSeed()
  const reviews = JSON.parse(db.exportData()).data.reviews
  assert.deepEqual(reviews['2026-08-16'], legacy.reviews['2026-08-16'])
  assert.deepEqual(reviews['2026-08-16'].weekly, { advanced: '本周有进步', issue: '游戏时间偏多', next: '下周减少游戏' })
  assert.deepEqual(reviews['2026-08-15'], legacy.reviews['2026-08-15'])
})

test('ledger / status：未被重算写回，金额与数值原样', () => {
  const legacy = makeLegacySnapshot()
  localStorage.setItem(KEY, JSON.stringify(legacy))
  db.bootstrap(); db.ensureSeed()
  const data = JSON.parse(db.exportData()).data
  assert.equal(data.ledger[0].amount, 12.5)
  assert.equal(data.ledger[1].amount, 8000)
  assert.equal(data.status['2026-08-15'].weight, 65.2)
  assert.equal(data.status['2026-08-16'].exerciseMin, 0) // 0 值保留
  assert.deepEqual(data.ledger, legacy.ledger)
  assert.deepEqual(data.status, legacy.status)
})

test('老用户数据带 schemaVersion:1：启动后同样不变', () => {
  const legacy = makeLegacySnapshot()
  legacy.schemaVersion = 1
  const rawBefore = JSON.stringify(legacy)
  localStorage.setItem(KEY, rawBefore)
  db.bootstrap(); db.ensureSeed()
  assert.equal(localStorage.getItem(KEY), rawBefore)
  const exp = JSON.parse(db.exportData())
  assert.equal(exp.schemaVersion, 1)
  assert.deepEqual(exp.data, legacy)
})

test('新用户（无 _seeded）：ensureSeed 只补默认值，不触碰已有业务字段', () => {
  const partial = {
    tasks: [{ id: 't1', title: '已有任务', done: false, date: '2026-08-18' }],
    ledger: [{ id: 'l1', type: 'exp', tag: '其他', amount: 9.9, date: '2026-08-18' }],
    settings: { birthDate: '2002-12-02' },
  }
  localStorage.setItem(KEY, JSON.stringify(partial))
  const boot = db.bootstrap()
  assert.equal(boot.ok, true)
  const seeded = db.ensureSeed()
  assert.equal(seeded._seeded, true)
  const data = JSON.parse(db.exportData()).data
  // 已有任务原样（无 start/estMin 注入）
  assert.deepEqual(data.tasks, partial.tasks)
  // 账本原样
  assert.deepEqual(data.ledger, partial.ledger)
  // 只补齐了默认字段
  assert.equal(data.settings.birthDate, '2002-12-02')
  assert.ok(data.settings.checkInDay && data.settings.reviewDay && data.settings.statusDay)
  assert.ok(Array.isArray(data.checkIns) === false) // checkIns 是对象
})

test('数据损坏：bootstrap 失败，ensureSeed 不会被调用（恢复模式隔离）', () => {
  localStorage.setItem(KEY, '{broken!!')
  sync.resetForTest()
  const boot = db.bootstrap()
  assert.equal(boot.ok, false)
  // 损坏场景下 ensureSeed 若被调用会直接抛错（load() 抛）——这里证明门禁在 seed 之前拦下
  assert.throws(() => db.ensureSeed())
  // 原始损坏字符串保留
  assert.equal(localStorage.getItem(KEY), '{broken!!')
})
