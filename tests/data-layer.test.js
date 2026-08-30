// P1 数据层测试：validate / migrate / deepClone / 事务式写入 / export-import 安全流程
// 运行：npm test（node --test tests/，零外部依赖）
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ---- mock localStorage（内存实现）----
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

// 纯函数层（零依赖，先静态导入）
const { validateData, migrateData, deepClone, SCHEMA_VERSION, schemaVersionOf } = await import('../src/utils/dataValidate.js')

// 业务层（依赖 localStorage，动态导入；db.js 顶层不再自动 ensureSeed）
const { db } = await import('../src/store/db.js')
const { default: sync } = await import('../src/store/sync.js')

const KEY = 'zion-data-v1'
const BACKUP_KEY = 'zion-backup-last'

beforeEach(() => {
  globalThis.localStorage.clear()
  sync.resetForTest()
})

// ---------- validateData ----------
test('validateData：合法对象通过', () => {
  const ok = validateData({
    checkIns: {}, tasks: [], reviews: {}, settings: {}, ledger: [],
    status: {}, plans: { month: {} }, ideas: [], pastReports: [],
    _seeded: true, schemaVersion: 1,
  })
  assert.equal(ok.ok, true)
})

test('validateData：空对象 / 缺失字段通过（向后兼容）', () => {
  assert.equal(validateData({}).ok, true)
  assert.equal(validateData(null).ok, false)
  assert.equal(validateData([]).ok, false)
  assert.equal(validateData('x').ok, false)
})

test('validateData：类型不符被拒', () => {
  assert.equal(validateData({ tasks: {} }).ok, false)
  assert.equal(validateData({ checkIns: [] }).ok, false)
  assert.equal(validateData({ settings: 'x' }).ok, false)
  assert.equal(validateData({ schemaVersion: '1' }).ok, false)
  assert.equal(validateData({ ledger: {} }).ok, false)
})

test('validateData：null 值字段视为缺失（不误伤旧数据）', () => {
  assert.equal(validateData({ tasks: null, checkIns: null }).ok, true)
})

test('validateData：未知字段允许（未来版本兼容）', () => {
  assert.equal(validateData({ futureField: { a: 1 } }).ok, true)
})

// ---------- migrateData / schemaVersion ----------
test('migrateData：无 schemaVersion 视为 v1，返回带 schemaVersion:1 的副本且不改原对象', () => {
  const old = { tasks: [] }
  const out = migrateData(old)
  assert.equal(schemaVersionOf(old), 1)
  assert.equal(schemaVersionOf(out), 1)
  assert.equal(out.schemaVersion, SCHEMA_VERSION)
  assert.notEqual(out, old) // 副本
  assert.deepEqual(out.tasks, [])
})

test('migrateData：v1 数据原样返回（当前无迁移，引用相同）', () => {
  const v1 = { schemaVersion: 1, tasks: [] }
  assert.equal(migrateData(v1), v1)
})

test('migrateData：非法输入原样返回', () => {
  assert.equal(migrateData(null), null)
  assert.equal(migrateData('x'), 'x')
})

// ---------- deepClone ----------
test('deepClone：嵌套修改不污染原对象', () => {
  const src = { tasks: [{ id: 't1', title: 'a' }], settings: { day: 'x' } }
  const c = deepClone(src)
  c.tasks[0].title = 'b'
  c.settings.day = 'y'
  assert.equal(src.tasks[0].title, 'a')
  assert.equal(src.settings.day, 'x')
})

// ---------- bootstrap ----------
test('bootstrap：空存储 -> ok（空库，非损坏，视图补版本字段）', () => {
  const b = db.bootstrap()
  assert.equal(b.ok, true)
  assert.deepEqual(b.data, { schemaVersion: 1 })
})

test('bootstrap：损坏 JSON -> {ok:false}（不静默吞掉）', () => {
  localStorage.setItem(KEY, '{not-json!!!')
  sync.resetForTest()
  const b = db.bootstrap()
  assert.equal(b.ok, false)
  assert.ok(b.error)
  assert.match(String(b.error.message), /JSON/)
})

test('bootstrap：结构校验失败 -> {ok:false}', () => {
  localStorage.setItem(KEY, JSON.stringify({ tasks: { bad: true } }))
  sync.resetForTest()
  const b = db.bootstrap()
  assert.equal(b.ok, false)
  assert.match(String(b.error.message), /校验/)
})

// ---------- ensureSeed（安全写边界） ----------
test('ensureSeed：首次空库播种，走统一安全写；二次调用不重复写', () => {
  const d1 = db.ensureSeed()
  assert.equal(d1._seeded, true)
  assert.ok(Array.isArray(d1.tasks) && d1.tasks.length > 0)
  assert.ok(d1.settings.birthDate)
  const rawAfter = localStorage.getItem(KEY)
  const d2 = db.ensureSeed()
  assert.equal(d2._seeded, true)
  // 已播种：不再触发写入（原始字符串不变）
  assert.equal(localStorage.getItem(KEY), rawAfter)
})

// ---------- 事务式 update ----------
test('update：mutator 抛错 -> 数据与盘上均不变', () => {
  db.ensureSeed()
  const before = localStorage.getItem(KEY)
  assert.throws(() => db.update(() => { throw new Error('boom') }))
  assert.equal(localStorage.getItem(KEY), before)
})

test('update：mutator 产生非法数据 -> 拒绝提交，盘上不变', () => {
  db.ensureSeed()
  const before = localStorage.getItem(KEY)
  assert.throws(() => db.update((d) => { d.tasks = { bad: 1 } }))
  assert.equal(localStorage.getItem(KEY), before)
})

test('update：正常写入 -> 落盘并可读回；副本不污染后续读取', () => {
  db.ensureSeed()
  db.update((d) => { d.tasks.push({ id: 'x1', title: '新任务' }) })
  const all = db.get()
  assert.equal(all.tasks.some((t) => t.id === 'x1'), true)
  // 再写一次，确认之前的写入已稳定（非共享引用）
  db.update((d) => { d.tasks.push({ id: 'x2', title: '另一个' }) })
  const ids = db.get().tasks.map((t) => t.id)
  assert.equal(ids.filter((i) => i === 'x2').length, 1)
})

// ---------- export / import ----------
test('exportData：包含版本 / 统计 / 完整业务数据', () => {
  db.ensureSeed()
  const exp = JSON.parse(db.exportData())
  assert.equal(exp.appVersion, '1.1.3')
  assert.equal(exp.schemaVersion, 1)
  assert.ok(exp.exportTime)
  assert.ok(exp.statistics && typeof exp.statistics === 'object')
  assert.ok(exp.data && typeof exp.data === 'object')
  assert.ok('checkIns' in exp.data && 'tasks' in exp.data && 'settings' in exp.data)
})

test('import/export round-trip：数据统计完全一致', () => {
  db.ensureSeed()
  db.update((d) => {
    d.tasks.push({ id: 't-a', title: 'A', done: false, date: '2026-08-18' })
    d.checkIns = d.checkIns || {}
    d.checkIns['2026-08-17'] = { english: true }
    d.ledger = d.ledger || []
    d.ledger.push({ id: 'l-a', type: 'exp', tag: '餐饮', amount: 12.5, date: '2026-08-18' })
    d.reviews = d.reviews || {}
    d.reviews['2026-08-16'] = { closer: 'x', gameMinutes: 30 }
  })
  const json = db.exportData()
  const before = JSON.parse(db.exportData()).statistics

  // 清空后导入
  localStorage.clear(); sync.resetForTest()
  db.importData(json)
  const after = JSON.parse(db.exportData()).statistics
  assert.deepEqual(after, before)
  // 业务数据逐字段一致（导入会补 schemaVersion:1，业务字段必须完全一致）
  const imported = JSON.parse(db.exportData()).data
  const original = JSON.parse(json).data
  assert.equal(imported.schemaVersion, 1)
  const { schemaVersion: _sv, ...importedBiz } = imported
  assert.deepEqual(importedBiz, original)
})

test('importData：兼容旧格式备份（纯业务 blob，无 data 包装）', () => {
  const oldBlob = { tasks: [{ id: 't1', title: '旧任务', done: false }], settings: { birthDate: '2002-12-02' } }
  db.importData(JSON.stringify(oldBlob))
  const data = JSON.parse(db.exportData()).data
  assert.deepEqual(data.tasks, oldBlob.tasks)
  assert.equal(data.settings.birthDate, '2002-12-02')
})

test('importData：损坏 JSON -> 抛错且原数据保留', () => {
  db.ensureSeed()
  const before = localStorage.getItem(KEY)
  assert.throws(() => db.importData('{bad json'))
  assert.equal(localStorage.getItem(KEY), before)
})

test('importData：非法结构（校验失败）-> 抛错且原数据保留', () => {
  db.ensureSeed()
  const before = localStorage.getItem(KEY)
  assert.throws(() => db.importData(JSON.stringify({ tasks: { bad: 1 } })))
  assert.equal(localStorage.getItem(KEY), before)
})

test('importData：导入前自动生成备份，可 restoreLastBackup 恢复', () => {
  db.ensureSeed()
  db.update((d) => { d.tasks.push({ id: 'keep', title: '保留我' }) })
  const before = localStorage.getItem(KEY)
  // 导入一份不同数据
  db.importData(JSON.stringify({ tasks: [{ id: 'new1', title: '新库' }], _seeded: true }))
  assert.equal(localStorage.getItem(BACKUP_KEY), before) // 备份 = 导入前原文
  // 恢复备份
  db.restoreLastBackup()
  const data = JSON.parse(db.exportData()).data
  assert.equal(data.tasks.some((t) => t.id === 'keep'), true)
})

test('restoreLastBackup：无备份时抛错', () => {
  assert.throws(() => db.restoreLastBackup())
})
