// P8 业务逻辑测试：账本统计 / 状态统计 / 任务时间字段 / 周复盘数据源
// 口径与组件实现一致（数据层验证 + 规则复算），确保旧数据不被这些功能修改。
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

beforeEach(() => {
  globalThis.localStorage.clear()
  sync.resetForTest()
})

// ---------- 账本：本月 / 本年统计 ----------
test('账本：本月/本年收支统计正确（自然年口径，历史记录原样）', () => {
  db.update((d) => {
    d.ledger = [
      { id: 'l1', type: 'exp', tag: '餐饮', amount: 12.5, date: '2026-08-01' },
      { id: 'l2', type: 'exp', tag: '交通', amount: 8, date: '2026-07-30' },      // 上月
      { id: 'l3', type: 'inc', tag: '工资', amount: 8000, date: '2026-08-10' },
      { id: 'l4', type: 'inc', tag: '红包', amount: 200, date: '2026-01-05' },    // 本年非本月
      { id: 'l5', type: 'exp', tag: '购物', amount: 100, date: '2025-12-31' },    // 去年
    ]
  })
  const items = db.getLedger()
  const monthKey = (d) => d.slice(0, 7)
  const yearKey = (d) => d.slice(0, 4)
  const cur = '2026-08'

  const monthItems = items.filter((it) => monthKey(it.date) === cur)
  const expM = monthItems.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
  const incM = monthItems.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)
  assert.equal(expM, 12.5)
  assert.equal(incM, 8000)

  const yearItems = items.filter((it) => yearKey(it.date) === '2026')
  const expY = yearItems.filter((it) => it.type === 'exp').reduce((s, it) => s + it.amount, 0)
  const incY = yearItems.filter((it) => it.type === 'inc').reduce((s, it) => s + it.amount, 0)
  assert.equal(expY, 12.5 + 8) // l1 餐饮 + l2 交通（都在 2026 年）
  assert.equal(incY, 8000 + 200) // l3 工资 + l4 红包（都在 2026 年）
  // 2025 年的 l5 不计入本年
  assert.equal(yearItems.length, 4)

  // 历史记录原样保留
  assert.equal(items.length, 5)
  assert.equal(items.find((i) => i.id === 'l5').amount, 100)
  assert.equal(items.find((i) => i.id === 'l1').amount, 12.5)
})

// ---------- 状态：近一周平均（4 项，活动小时，仅统计有记录的日期） ----------
test('状态：近一周平均口径正确（处理 0 值 / 字符串数字 / 缺失日期）', () => {
  const today = new Date()
  const ymd = (d) => {
    const x = new Date(d)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }
  const d0 = ymd(today)                                    // 今天
  const d1 = ymd(today.getTime() - 86400000)               // 昨天
  const d3 = ymd(today.getTime() - 3 * 86400000)           // 3 天前
  const d9 = ymd(today.getTime() - 9 * 86400000)           // 9 天前（超出近一周）
  db.setStatus(d0, { sleepHours: 7, steps: '8000', calories: 1800, exerciseMin: 1 }) // 1 小时
  db.setStatus(d1, { sleepHours: 0, steps: 0, calories: '0', exerciseMin: 0 }) // 0 值不计入平均
  db.setStatus(d3, { sleepHours: '7.5', steps: 5200, calories: 1600, exerciseMin: 2 }) // 2 小时
  db.setStatus(d9, { sleepHours: 9, steps: 9999, calories: 2000, exerciseMin: 3 }) // 范围外

  const all = db.getAllStatus()
  const from = ymd(today.getTime() - 6 * 86400000)
  const days = Object.keys(all).filter((d) => d >= from && d <= d0).sort()

  const sum = { sleep: 0, steps: 0, calories: 0, exercise: 0 }
  const cnt = { sleep: 0, steps: 0, calories: 0, exercise: 0 }
  days.forEach((d) => {
    const s = all[d] || {}
    const sl = Number(s.sleepHours) || 0
    if (sl > 0) { sum.sleep += sl; cnt.sleep += 1 }
    const st = Number(s.steps) || 0
    if (st > 0) { sum.steps += st; cnt.steps += 1 }
    const ca = Number(s.calories) || 0
    if (ca > 0) { sum.calories += ca; cnt.calories += 1 }
    const exMin = Number(s.exerciseMin) || 0
    if (exMin > 0) { sum.exercise += exMin; cnt.exercise += 1 } // 字段语义=小时，原值累加
  })
  // 近一周内：d0(7h,8000,1800,1h) + d1(0 不计) + d3(7.5h,5200,1600,2h) = 3 个有效日
  assert.equal(days.length, 3)
  assert.equal(cnt.sleep, 2) // d0、d3
  assert.equal(cnt.steps, 2)
  assert.equal(cnt.calories, 2)
  assert.equal(cnt.exercise, 2)
  assert.equal(Math.round((sum.sleep / cnt.sleep) * 10) / 10, 7.3) // (7+7.5)/2
  assert.equal(Math.round(sum.steps / cnt.steps), 6600)            // (8000+5200)/2
  assert.equal(Math.round(sum.calories / cnt.calories), 1700)      // (1800+1600)/2
  assert.equal(Math.round((sum.exercise / cnt.exercise) * 10) / 10, 1.5) // (1+2)/2 小时
  // 最新一天（最大日期）= 今天，含 6 项
  assert.equal(days[days.length - 1], d0)
})

// ---------- 任务：需求 1 时间字段可选 ----------
test('任务：默认无时间（字段不存在）；主动设置才保存 start/estMin', () => {
  db.ensureSeed()
  // 不带时间
  db.addTask('2026-08-18', '无时间任务')
  // 带开始时间
  db.addTask('2026-08-18', '有开始时间', '09:30')
  // 带开始+预计
  db.addTask('2026-08-18', '完整时间', '10:00', 45)

  const tasks = db.getTasks('2026-08-18')
  const noTime = tasks.find((t) => t.title === '无时间任务')
  assert.ok(noTime)
  assert.equal('start' in noTime, false)
  assert.equal('estMin' in noTime, false)

  const withStart = tasks.find((t) => t.title === '有开始时间')
  assert.equal(withStart.start, '09:30')
  assert.equal('estMin' in withStart, false)

  const full = tasks.find((t) => t.title === '完整时间')
  assert.equal(full.start, '10:00')
  assert.equal(full.estMin, 45)
})

// ---------- 周复盘数据源：周日 weekly 字段读取（需求 4/5 数据源） ----------
test('周复盘：reviews[周日].weekly 可读取且不被改写', () => {
  db.update((d) => {
    d.reviews = {
      '2026-08-16': {
        closer: 'x', gameMinutes: 30,
        weekly: { advanced: '有进步', issue: '不足', next: '下周重点' },
      },
    }
  })
  const w = db.getReview('2026-08-16').weekly
  assert.deepEqual(w, { advanced: '有进步', issue: '不足', next: '下周重点' })
  // 再次写入其他数据后 weekly 仍原样
  db.setReview('2026-08-16', { gameMinutes: 60 })
  assert.deepEqual(db.getReview('2026-08-16').weekly, { advanced: '有进步', issue: '不足', next: '下周重点' })
  assert.equal(db.getReview('2026-08-16').gameMinutes, 60)
})

// ---------- 历史周报：旧报告带 wereadSec 字段不受影响（需求 10 只去 UI） ----------
test('历史周报：旧 wereadSec 数据保留在库中（仅 UI 不展示）', () => {
  db.update((d) => {
    d.pastReports = [
      { id: 'pr1', kind: 'week', title: '周报', period: 'a ~ b', metrics: { gameMin: 30, wereadSec: 3600 } },
    ]
  })
  const reports = db.getPastReports()
  assert.equal(reports[0].metrics.wereadSec, 3600) // 底层数据不删
  assert.equal(reports[0].metrics.gameMin, 30)
})
