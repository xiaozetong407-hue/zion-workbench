// P8 老用户升级模拟：0.30.2 数据 -> 0.32.x 启动 -> 正常使用（任务/复盘/账本/状态）
// -> 导出 -> 清空 -> 导入 -> 对比关键业务数据。
// 必须证明：原任务字段不被污染；reviews 不被重写；ledger 不被重算写回；
//          status 历史不被改写；pastReports 不被破坏；旧数据可正常使用。
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

// 模拟 0.30.2 老数据（无 schemaVersion；_seeded=true 老用户；含带/不带时间的任务等）
function legacyData() {
  return {
    checkIns: { '2026-08-15': { english: true, note: '打卡' } },
    tasks: [
      { id: 't-time', title: '带时间旧任务', done: true, date: '2026-08-15', start: '09:30', estMin: 45 },
      { id: 't-plain', title: '无时间旧任务', done: false, date: '2026-08-16' },
    ],
    plans: { month: { '2026-08': '八月计划' }, year: { '2026': '年计划' }, fiveYear: { '2026': '五年' } },
    ledger: [
      { id: 'l1', type: 'exp', tag: '餐饮', amount: 12.5, note: '午饭', date: '2026-08-15', createdAt: 1700000000000 },
      { id: 'l2', type: 'inc', tag: '工资', amount: 8000, note: '', date: '2026-08-10', createdAt: 1700000000001 },
    ],
    reviews: {
      '2026-08-16': {
        closer: '推进求职',
        pleasure: '看电影',
        gameMinutes: 30,
        tomorrow: '完成简历',
        weekly: { advanced: '有进步', issue: '游戏多', next: '减少游戏' },
      },
    },
    status: {
      '2026-08-15': { weight: 65.2, sleepHours: 7.5, steps: 8000, calories: 1800, exerciseMin: 30 },
      '2026-08-16': { weight: 65.1, sleepHours: 6.8, steps: 5200, calories: 1600, exerciseMin: 0 },
    },
    pastReports: [
      { id: 'pr1', kind: 'week', title: '周报', period: 'x ~ y', createdAt: 1700000000002,
        metrics: { ciRate: 80, gameMin: 210, wereadSec: 3600, exp: 12.5, inc: 8000 } },
    ],
    ideas: [{ id: 'i1', text: '个人网站', createdAt: 1700000000003 }],
    settings: { birthDate: '2002-12-02', gender: 'male', age: 24, height: 175,
      checkInDay: '2026-08-17', reviewDay: '2026-08-17', statusDay: '2026-08-17', taskDay: '2026-08-17' },
    _seeded: true,
    _lastTaskDay: '2026-08-17',
  }
}

beforeEach(() => {
  globalThis.localStorage.clear()
  sync.resetForTest()
})

test('老用户升级：启动 -> 使用 -> 导出 -> 导入 -> 关键业务数据一致且不被污染', () => {
  const legacy = legacyData()
  const rawBefore = JSON.stringify(legacy)
  localStorage.setItem(KEY, rawBefore)

  // ① 新版启动（bootstrap + ensureSeed：_seeded=true 不触发写盘）
  const boot = db.bootstrap()
  assert.equal(boot.ok, true)
  db.ensureSeed()
  assert.equal(localStorage.getItem(KEY), rawBefore, '启动后盘上原文不得变化')

  // ② 正常使用（模拟用户在 0.32.x 上操作）
  const today = '2026-08-18'
  db.addTask(today, '新版无时间任务')                        // 任务：新规则（无时间）
  db.addTask(today, '新版有时间任务', '11:00', 30)            // 任务：主动设置时间
  db.setReview(today, { closer: '新版复盘', gameMinutes: 15 }) // 复盘
  db.addLedger({ type: 'exp', tag: '购物', amount: 99, note: '买书', date: today }) // 账本
  db.setStatus(today, { weight: 65.0, sleepHours: 7, steps: 9000, calories: 1900, exerciseMin: 45 }) // 状态

  // ③ 导出
  const exp = JSON.parse(db.exportData())
  assert.equal(exp.schemaVersion, 1)
  assert.equal(exp.appVersion, '0.32.1')

  // ④ 清空环境后导入
  localStorage.clear()
  sync.resetForTest()
  db.importData(JSON.stringify(exp))

  // ⑤ 对比关键业务数据
  const data = JSON.parse(db.exportData()).data

  // 5.1 原任务字段不被污染
  const oldTime = data.tasks.find((t) => t.id === 't-time')
  assert.equal(oldTime.start, '09:30')
  assert.equal(oldTime.estMin, 45)
  const oldPlain = data.tasks.find((t) => t.id === 't-plain')
  assert.equal('start' in oldPlain, false, '旧无时间任务不得被新增 start')
  assert.equal('estMin' in oldPlain, false, '旧无时间任务不得被新增 estMin')

  // 5.2 新任务符合新规则
  const newPlain = data.tasks.find((t) => t.title === '新版无时间任务')
  assert.equal('start' in newPlain, false)
  assert.equal('estMin' in newPlain, false)
  const newTime = data.tasks.find((t) => t.title === '新版有时间任务')
  assert.equal(newTime.start, '11:00')
  assert.equal(newTime.estMin, 30)

  // 5.3 reviews 不被重写（老条目含 weekly 原样；新复盘在）
  assert.deepEqual(data.reviews['2026-08-16'], legacy.reviews['2026-08-16'])
  assert.deepEqual(data.reviews['2026-08-16'].weekly, { advanced: '有进步', issue: '游戏多', next: '减少游戏' })
  assert.equal(data.reviews[today].closer, '新版复盘')

  // 5.4 ledger 不被重算写回（旧金额原样 + 新记录在）
  assert.equal(data.ledger.find((i) => i.id === 'l1').amount, 12.5)
  assert.equal(data.ledger.find((i) => i.id === 'l2').amount, 8000)
  assert.ok(data.ledger.some((i) => i.tag === '购物' && i.amount === 99))

  // 5.5 status 历史不被改写（含 0 值）+ 新记录在
  assert.deepEqual(data.status['2026-08-15'], legacy.status['2026-08-15'])
  assert.equal(data.status['2026-08-16'].exerciseMin, 0)
  assert.equal(data.status[today].steps, 9000)

  // 5.6 pastReports 不被破坏（旧 wereadSec 字段保留兼容）
  assert.equal(data.pastReports.length, 1)
  assert.equal(data.pastReports[0].id, 'pr1')
  assert.equal(data.pastReports[0].metrics.wereadSec, 3600)
  assert.equal(data.pastReports[0].metrics.gameMin, 210)

  // 5.7 其他业务字段
  assert.deepEqual(data.checkIns, legacy.checkIns)
  assert.deepEqual(data.plans, legacy.plans)
  assert.deepEqual(data.ideas, legacy.ideas)
  assert.equal(data.settings.birthDate, '2002-12-02')

  // 5.8 导入后导出统计一致（round-trip 完整）
  const statBefore = exp.statistics
  const statAfter = JSON.parse(db.exportData()).statistics
  assert.deepEqual(statAfter, statBefore)
})

test('老用户升级：无时间旧任务在「使用后导出」全流程仍不被注入时间字段', () => {
  const legacy = legacyData()
  localStorage.setItem(KEY, JSON.stringify(legacy))
  db.bootstrap(); db.ensureSeed()
  // 只做「查看/勾选」类操作
  db.toggleTask('t-plain')
  db.toggleTask('t-plain')
  const tasks = JSON.parse(db.exportData()).data.tasks
  const t = tasks.find((x) => x.id === 't-plain')
  assert.equal('start' in t, false)
  assert.equal('estMin' in t, false)
  assert.equal(t.done, false) // 勾选两次回到原状
})
