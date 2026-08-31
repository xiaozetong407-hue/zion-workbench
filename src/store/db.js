// 本地数据层：所有数据存于浏览器 localStorage，按日期主键组织。
// 双端同步：底层读写经 sync.js（Storage Adapter，唯一接触 zion-data-v1 的层）。
//
// P1 安全边界：
//   - load()：安全加载（解析失败/校验失败抛错 -> 上层进入 Recovery Mode，绝不静默返回 {}）
//   - update(mutator)：在深拷贝副本上执行 mutator，再事务式提交（validate->serialize->write->read-back->validate）
//   - exportData()：含 appVersion / schemaVersion / exportTime / statistics / 完整业务数据
//   - importData()：导入前自动备份 + 解析/校验/迁移 + 安全写入 + 失败自动回滚
//   - ensureSeed()：纳入统一安全写边界（副本 + commit），不在模块顶层自动执行（由启动门禁显式调用）

import { todayStr, addDays, appDay } from '../utils/date.js'
import { validateData, migrateData, deepClone, SCHEMA_VERSION, schemaVersionOf } from '../utils/dataValidate.js'
import sync from './sync.js'

// 与 package.json version 保持一致（手工同步）
const APP_VERSION = '1.1.4'
// 导入前自动备份的 key（独立于业务 blob，供「恢复上一次备份」）
const BACKUP_KEY = 'zion-backup-last'

// 安全加载：直接读 Storage Adapter 的内存/落盘数据
function load() {
  return sync.getCache()
}

// 全量业务数据统计（导出 meta 用）
function dataStatistics(d) {
  const objCount = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0)
  const arrCount = (a) => (Array.isArray(a) ? a.length : 0)
  return {
    checkIns: objCount(d.checkIns),
    status: objCount(d.status),
    reviews: objCount(d.reviews),
    plans: objCount(d.plans),
    monthReviews: objCount(d.monthReviews),
    yearReviews: objCount(d.yearReviews),
    prompts: objCount(d.prompts),
    settings: objCount(d.settings),
    tasks: arrCount(d.tasks),
    ideas: arrCount(d.ideas),
    ledger: arrCount(d.ledger),
    books: arrCount(d.books),
    quotes: arrCount(d.quotes),
    favorites: arrCount(d.favorites),
    studyLogs: arrCount(d.studyLogs),
    pastReports: arrCount(d.pastReports),
    wereadReviews: arrCount(d.wereadReviews),
    wereadBooks: arrCount(d.wereadBooks),
  }
}

// 首次启动时填充样例历史打卡，便于查看历史区（真实使用后可忽略）
const SEED_PATTERNS = [
  { english: true, reading: true, earlySleep: true },
  { english: true, exercise: true, reading: true, lowCarbon: true },
  { english: true, reading: true },
  { english: true, exercise: true, earlySleep: true, lowCarbon: true, reading: true },
  { reading: true, earlySleep: true },
  { english: true, exercise: true, lowCarbon: true },
  { english: true, reading: true, earlySleep: true, lowCarbon: true },
  { exercise: true, reading: true },
]

export const db = {
  get() {
    return load()
  },

  // P1 安全边界：在深拷贝副本上执行 mutator，然后事务式提交。
  // mutator 抛错 -> 副本丢弃，原数据与内存 cache 均不变；
  // 提交失败 -> 回滚并抛错，绝不覆盖旧数据。
  update(mutator) {
    const current = load()
    const draft = deepClone(current)
    mutator(draft)
    sync.commit(draft)
    return draft
  },

  // 启动门禁：安全加载 + 兼容迁移（当前 v1 空迁移，仅内存视图，不写盘）。
  // 返回 { ok:true, data } 或 { ok:false, error }
  bootstrap() {
    try {
      const data = load()
      const migrated = migrateData(data)
      return { ok: true, data: migrated }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) }
    }
  },

  // 结构校验（透传 dataValidate，供 UI/测试使用）
  validateData(data) {
    return validateData(data)
  },

  // 当前数据 schemaVersion（无则为 1）
  schemaVersion() {
    return schemaVersionOf(load())
  },

  // 首次启动：填充样例 + 锁定出生日期（P1：在深拷贝副本上执行，走统一事务式安全写）
  // 仅在启动门禁（main.jsx）数据加载成功后由上层显式调用；数据损坏时绝不执行。
  ensureSeed() {
    const data = load()
    if (data._seeded) return data
    const draft = deepClone(data)
    let changed = false
    if (!draft.checkIns || Object.keys(draft.checkIns).length === 0) {
      draft.checkIns = {}
      const today = todayStr()
      SEED_PATTERNS.forEach((p, i) => {
        draft.checkIns[addDays(today, -(i + 1))] = p
      })
      changed = true
    }
    if (!draft.settings) draft.settings = {}
    if (!draft.settings.birthDate) {
      draft.settings.birthDate = '2002-12-02'
      changed = true
    }
    if (draft.settings.gender == null) {
      draft.settings.gender = 'male'   // 'male' | 'female'
      changed = true
    }
    if (draft.settings.age == null) {
      // 从出生日期推算，若无效则默认 24
      const bd = new Date(draft.settings.birthDate)
      const ageMs = Date.now() - bd.getTime()
      draft.settings.age = Math.max(18, Math.floor(ageMs / 31557600000))
      changed = true
    }
    // 记录日指针默认值：每个面板各自维护「当前正在记录的那一天」，去除 6 点自动清空后只在手动保存时 +1
    if (!draft.settings.checkInDay) draft.settings.checkInDay = todayStr()
    if (!draft.settings.reviewDay) draft.settings.reviewDay = todayStr()
    if (!draft.settings.statusDay) draft.settings.statusDay = todayStr()
    if (!draft.tasks || draft.tasks.length === 0) {
      const today = todayStr()
      draft.tasks = [
        { id: 'seed-1', title: '完成简历初稿', done: true, date: today },
        { id: 'seed-2', title: '复习韩语字母表', done: false, date: today },
        { id: 'seed-3', title: '录制一条口播视频', done: false, date: today },
      ]
      changed = true
    }
    // 兼容旧版（plans 为扁平字符串）-> 转为「按周期存储」的 keyed 结构
    if (draft.plans && typeof draft.plans.month === 'string') {
      const curMonth = todayStr().slice(0, 7)
      const curYear = String(new Date().getFullYear())
      const old = draft.plans
      draft.plans = {
        month: { [curMonth]: old.month || '' },
        year: { [curYear]: old.year || '' },
        fiveYear: { [curYear]: old.fiveYear || '' },
      }
      changed = true
    }
    if (!draft.plans) {
      draft.plans = { month: {}, year: {}, fiveYear: {} }
      changed = true
    }
    // 首次播种标记：之后即便用户清空全部打卡/任务，也不再自动复活演示数据
    draft._seeded = true
    changed = true
    if (changed) sync.commit(draft)
    return draft
  },

  // ---- 打卡项定义 ----
  CHECKIN_ITEMS: [
    { key: 'english', label: '外语学习', short: '语' },
    { key: 'exercise', label: '运动', short: '动' },
    { key: 'reading', label: '阅读', short: '阅' },
    { key: 'earlySleep', label: '早睡', short: '眠' },
    { key: 'lowCarbon', label: '低碳饮食', short: '食' },
    { key: 'accounting', label: '记账', short: '账' },
  ],

  // ---- 打卡 ----
  getCheckIn(date) {
    return (load().checkIns && load().checkIns[date]) || null
  },

  setCheckIn(date, patch) {
    return db.update((d) => {
      d.checkIns = d.checkIns || {}
      d.checkIns[date] = { ...(d.checkIns[date] || {}), ...patch }
    })
  },

  deleteCheckIn(date) {
    return db.update((d) => {
      d.checkIns = d.checkIns || {}
      delete d.checkIns[date]
    })
  },

  getAllCheckIns() {
    const data = load()
    return data.checkIns || {}
  },

  // ---- 复盘 ----
  getReview(date) {
    return (load().reviews && load().reviews[date]) || null
  },

  setReview(date, patch) {
    return db.update((d) => {
      d.reviews = d.reviews || {}
      d.reviews[date] = { ...(d.reviews[date] || {}), ...patch }
    })
  },

  // ---- 设置 ----
  getSettings() {
    return load().settings || {}
  },

  setSettings(patch) {
    return db.update((d) => {
      d.settings = d.settings || {}
      Object.assign(d.settings, patch)
    })
  },

  // ---- 记录日指针（每个面板各自维护「当前正在记录的那一天」）----
  // 去除「凌晨 6 点自动清空」逻辑后，记录日只在用户手动保存时 +1。
  RECORD_DAY_KEYS: { checkIn: 'checkInDay', review: 'reviewDay', status: 'statusDay', task: 'taskDay' },
  getRecordDay(kind) {
    const data = load()
    const key = db.RECORD_DAY_KEYS[kind]
    if (!data.settings || !data.settings[key]) {
      const def = todayStr()
      db.setSettings({ [key]: def })
      return def
    }
    return data.settings[key]
  },
  setRecordDay(kind, val) {
    const key = db.RECORD_DAY_KEYS[kind]
    db.setSettings({ [key]: val })
  },

  // ---- 任务（待办）----
  getTasks(date) {
    const all = load().tasks || []
    return all.filter((t) => t.date === date)
  },

  // 需求 1：任务时间字段可选。start / estMin 仅在用户主动设置时才写入；
  // 未设置时字段「不存在」（绝不写 null/0 默认值）。历史任务不受影响。
  addTask(date, title, start, estMin) {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    db.update((d) => {
      d.tasks = d.tasks || []
      const t = {
        id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: trimmed,
        done: false,
        date,
      }
      const s = start != null ? String(start).trim() : ''
      if (s) t.start = s
      const e = Number(estMin)
      if (estMin !== undefined && estMin !== null && estMin !== '' && !isNaN(e) && e > 0) {
        t.estMin = e
      }
      d.tasks.push(t)
    })
  },

  toggleTask(id) {
    db.update((d) => {
      const t = (d.tasks || []).find((x) => x.id === id)
      if (t) t.done = !t.done
    })
  },

  deleteTask(id) {
    db.update((d) => {
      d.tasks = (d.tasks || []).filter((x) => x.id !== id)
    })
  },

  editTask(id, title) {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    db.update((d) => {
      const t = (d.tasks || []).find((x) => x.id === id)
      if (t) t.title = trimmed
    })
  },

  // 在同一日期的待办列表内，按「可见位置」重排（from/to 为日期过滤后的序号）
  reorderTask(date, from, to) {
    db.update((d) => {
      const all = d.tasks || []
      const idxs = []
      all.forEach((t, i) => {
        if (t.date === date) idxs.push(i)
      })
    // to 允许等于 idxs.length，表示移动到该日期任务的最末尾
    if (from < 0 || from >= idxs.length || to < 0 || to > idxs.length) return
    const gFrom = idxs[from]
    const [item] = all.splice(gFrom, 1)
    const idxs2 = []
    all.forEach((t, i) => {
      if (t.date === date) idxs2.push(i)
    })
    // 目标为末尾（to 越界）时，插入到所有该日期任务之后；否则插到对应全局位置
    const gTo = to >= idxs2.length ? all.length : idxs2[to]
    all.splice(gTo, 0, item)
    })
  },

  getAllTasks() {
    return load().tasks || []
  },

  // 任务每日滚动（以 6 点为界）：
  // - 首次运行新版本：把「今天」的日历日期任务对齐到当前任务日（6 点前算前一天），避免列表变空。
  // - 跨过 6 点：前一天任务已按日期存档（=已保存），仅推进标记；新的一天列表自然为空（=清空待办）。
  rolloverTasks() {
    const cur = appDay()
    db.update((d) => {
      d.tasks = d.tasks || []
      const cal = todayStr()
      if (!d._lastTaskDay) {
        if (cal !== cur) d.tasks.forEach((t) => { if (t.date === cal) t.date = cur })
        d._lastTaskDay = cur
      } else if (d._lastTaskDay !== cur) {
        d._lastTaskDay = cur
      }
    })
  },

  // ---- 想做的事（灵感池：跨记录日，随手记临时想法，日后做计划时参考）----
  getIdeas() {
    return load().ideas || []
  },

  addIdea(text) {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    db.update((d) => {
      d.ideas = d.ideas || []
      d.ideas.unshift({
        id: 'i-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        text: trimmed,
        createdAt: Date.now(),
      })
    })
  },

  deleteIdea(id) {
    db.update((d) => {
      d.ideas = (d.ideas || []).filter((x) => x.id !== id)
    })
  },

  // ---- 长期计划（按月 / 年 / 五年周期存储，方便后台留存与回顾）----
  // kind: 'month' | 'year' | 'fiveYear'，period 如 '2026-07' / '2026' / '2026'
  getPlan(kind, period) {
    const plans = load().plans || {}
    return (plans[kind] && plans[kind][period]) || ''
  },

  setPlan(kind, period, text) {
    db.update((d) => {
      d.plans = d.plans || {}
      d.plans[kind] = d.plans[kind] || {}
      d.plans[kind][period] = text || ''
    })
  },

  getAllPlans(kind) {
    return (load().plans && load().plans[kind]) || {}
  },

  // ---- 月度复盘（key: YYYY-MM）----
  getMonthReview(period) {
    return (load().monthReviews && load().monthReviews[period]) || null
  },

  setMonthReview(period, patch) {
    db.update((d) => {
      d.monthReviews = d.monthReviews || {}
      d.monthReviews[period] = {
        ...(d.monthReviews[period] || {}),
        ...patch,
        updatedAt: Date.now(),
      }
    })
  },

  getAllMonthReviews() {
    return load().monthReviews || {}
  },

  // ---- 年度复盘（key: YYYY）----
  getYearReview(year) {
    return (load().yearReviews && load().yearReviews[year]) || null
  },

  setYearReview(year, patch) {
    db.update((d) => {
      d.yearReviews = d.yearReviews || {}
      d.yearReviews[year] = {
        ...(d.yearReviews[year] || {}),
        ...patch,
        updatedAt: Date.now(),
      }
    })
  },

  // 每年最后一天自动新增（仅首次创建空记录，不覆盖已写内容；走统一安全写边界）
  ensureYearReview(year) {
    const data = load()
    if (data.yearReviews && data.yearReviews[year]) return
    db.update((d) => {
      d.yearReviews = d.yearReviews || {}
      if (!d.yearReviews[year]) {
        d.yearReviews[year] = {
          autoCreated: true,
          summary: '',
          lack: '',
          nextFocus: '',
        }
      }
    })
  },

  getAllYearReviews() {
    return load().yearReviews || {}
  },

  // ---- 自动弹窗「已提示」标记（按周期去重，避免重复打扰）----
  // P1 修正：读函数绝不写数据（此前直接初始化 load() 返回的 cache 引用，属未提交的脏写）
  isPrompted(kind, key) {
    const data = load()
    const bucket = (data.prompts && data.prompts[kind]) || {}
    return !!bucket[key]
  },

  markPrompted(kind, key) {
    db.update((d) => {
      d.prompts = d.prompts || {}
      d.prompts[kind] = d.prompts[kind] || {}
      d.prompts[kind][key] = true
    })
  },

  // ---- 状态（每日健康 + 身体数据）----
  getStatus(date) {
    return (load().status && load().status[date]) || null
  },
  setStatus(date, patch) {
    db.update((d) => {
      d.status = d.status || {}
      d.status[date] = { ...(d.status[date] || {}), ...patch }
    })
  },
  getAllStatus() {
    return load().status || {}
  },

  // ---- 账本 ----
  getLedger() {
    return load().ledger || []
  },
  addLedger(entry) {
    db.update((d) => {
      d.ledger = d.ledger || []
      d.ledger.push({
        id: 'l-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        ...entry,
      })
    })
  },
  deleteLedger(id) {
    db.update((d) => {
      d.ledger = (d.ledger || []).filter((x) => x.id !== id)
    })
  },
  updateLedger(id, patch) {
    db.update((d) => {
      d.ledger = (d.ledger || []).map((x) =>
        x.id === id ? { ...x, ...patch } : x
      )
    })
  },

  // ---- 读书（书架 + 金句）----
  getBooks() {
    return load().books || []
  },
  addBook(title, author) {
    const t = (title || '').trim()
    if (!t) return
    db.update((d) => {
      d.books = d.books || []
      d.books.push({
        id: 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: t,
        author: (author || '').trim(),
        progress: 0,
        star: 0,
      })
    })
  },
  updateBook(id, patch) {
    db.update((d) => {
      const b = (d.books || []).find((x) => x.id === id)
      if (b) Object.assign(b, patch)
    })
  },
  deleteBook(id) {
    db.update((d) => {
      d.books = (d.books || []).filter((x) => x.id !== id)
    })
  },
  getQuotes() {
    return load().quotes || []
  },
  addQuote(text, bookTitle, bookAuthor, category) {
    const t = (text || '').trim()
    if (!t) return
    db.update((d) => {
      d.quotes = d.quotes || []
      d.quotes.unshift({
        id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        text: t,
        bookTitle: (bookTitle || '').trim(),
        bookAuthor: (bookAuthor || '').trim(),
        category: (category || '通用').trim(),
        createdAt: Date.now(),
      })
    })
  },
  deleteQuote(id) {
    db.update((d) => {
      d.quotes = (d.quotes || []).filter((x) => x.id !== id)
    })
  },
  // 微信读书橙色划线同步进金句：按 wereadId 去重替换（先清空旧的 weread 来源，再写入）
  addWereadQuotes(list) {
    const items = (list || []).filter((it) => it && it.text && it.wereadId)
    db.update((d) => {
      d.quotes = (d.quotes || []).filter((q) => q.source !== 'weread')
      items.forEach((it) => {
        d.quotes.push({
          id: 'q-wx-' + it.wereadId,
          text: it.text,
          bookTitle: (it.bookTitle || '').trim(),
          bookAuthor: (it.bookAuthor || '').trim(),
          category: '阅读',
          source: 'weread',
          createdAt: Date.now(),
        })
      })
    })
  },

  // ---- 微信读书点评（同步后持久化）----
  getWereadReviews() {
    return load().wereadReviews || []
  },
  setWereadReviews(list) {
    db.update((d) => {
      d.wereadReviews = Array.isArray(list) ? list : []
    })
  },

  // ---- 微信读书置顶书架 / 统计 / 同步时间（支持自动连接缓存）----
  getWereadBooks() {
    return load().wereadBooks || []
  },
  setWereadBooks(list) {
    db.update((d) => {
      d.wereadBooks = Array.isArray(list) ? list : []
    })
  },
  getWereadStat() {
    return load().wereadStat || { today: 0, week: 0, total: 0, days: 0 }
  },
  setWereadStat(s) {
    db.update((d) => {
      d.wereadStat = s || { today: 0, week: 0, total: 0, days: 0 }
    })
  },
  getWereadSyncAt() {
    return load().wereadSyncAt || 0
  },
  setWereadSyncAt(t) {
    db.update((d) => {
      d.wereadSyncAt = t || 0
    })
  },

  // ---- 学习·收藏（可分类）----
  getFavorites() {
    return load().favorites || []
  },
  addFavorite(fav) {
    const t = (fav.title || '').trim()
    if (!t) return
    db.update((d) => {
      d.favorites = d.favorites || []
      d.favorites.unshift({
        id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: t,
        url: (fav.url || '').trim(),
        category: (fav.category || '未分类').trim(),
        createdAt: Date.now(),
      })
    })
  },
  deleteFavorite(id) {
    db.update((d) => {
      d.favorites = (d.favorites || []).filter((x) => x.id !== id)
    })
  },

  // ---- 学习（4 轨日志）----
  getStudyLogs() {
    return load().studyLogs || []
  },
  addStudyLog(track, date, note) {
    const n = (note || '').trim()
    if (!n) return
    db.update((d) => {
      d.studyLogs = d.studyLogs || []
      d.studyLogs.unshift({
        id: 's-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        track,
        date,
        note: n,
        createdAt: Date.now(),
      })
    })
  },
  deleteStudyLog(id) {
    db.update((d) => {
      d.studyLogs = (d.studyLogs || []).filter((x) => x.id !== id)
    })
  },

  // ---- 过去（周报 / 月报自动生成存储）----
  getPastReports() {
    return load().pastReports || []
  },
  addPastReport(report) {
    db.update((d) => {
      d.pastReports = d.pastReports || []
      d.pastReports.unshift({
        id: 'pr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        ...report,
      })
    })
  },
  deletePastReport(id) {
    db.update((d) => {
      d.pastReports = (d.pastReports || []).filter((x) => x.id !== id)
    })
  },

  // ---- P1 数据安全：导出 / 导入 / 恢复 ----

  // 导出全部数据（含版本与统计信息；data 为完整业务数据，可被旧版/新版共同识别）
  exportData() {
    const data = load()
    // 1.1.0：记录本次导出时间（供「备份提醒」；独立 key，不污染业务数据，导出保持只读）
    try { localStorage.setItem('zion-last-backup-at', String(Date.now())) } catch { /* 记录失败不影响导出 */ }
    return JSON.stringify(
      {
        appVersion: APP_VERSION,
        schemaVersion: schemaVersionOf(data),
        exportTime: new Date().toISOString(),
        statistics: dataStatistics(data),
        data,
      },
      null,
      2
    )
  },

  // 导入数据（可回滚）：
  // 当前数据 -> 自动备份(BACKUP_KEY) -> 解析导入文件 -> validate -> migrate
  //        -> 事务式安全写入 -> 读回验证
  // 任一步失败：自动恢复导入前的数据与内存视图，并抛错（绝不出现「导入失败但原数据也没了」）。
  // 兼容旧格式备份：若导入内容没有 data 包装（旧版纯业务 blob），整体按业务数据处理。
  importData(json) {
    const oldRaw = sync.getRaw()
    let oldCache = null
    try { oldCache = sync.getCache() } catch { oldCache = null }
    // 1. 导入前自动备份当前数据（原始字符串，一字不改）
    try {
      if (oldRaw != null) localStorage.setItem(BACKUP_KEY, oldRaw)
    } catch { /* 备份失败不阻断导入（仍有回滚能力） */ }
    try {
      // 2. 解析
      const parsed = JSON.parse(json)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('格式不正确')
      }
      // 3. 兼容新旧格式：新格式 {data:{...},...}，旧格式即业务 blob 本身
      let biz = parsed
      if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
        biz = parsed.data
      }
      // 4. 校验
      const v = validateData(biz)
      if (!v.ok) throw new Error('数据校验失败：' + v.errors.join('；'))
      // 5. 迁移（当前 v1 空跑）
      biz = migrateData(biz)
      // 6. 事务式安全写入（内部完成 校验->序列化->写入->读回验证）
      sync.commit(biz)
      return { ok: true }
    } catch (e) {
      // 7. 失败回滚：恢复盘上旧值 + 恢复内存 cache
      try {
        if (oldRaw != null) localStorage.setItem('zion-data-v1', oldRaw)
      } catch { /* 回滚盘上失败时保持抛错 */ }
      if (oldCache != null) sync.setMemory(oldCache)
      throw (e instanceof Error ? e : new Error(String(e)))
    }
  },

  // 恢复上一次备份（导入前自动生成的那份，存于 BACKUP_KEY）
  restoreLastBackup() {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) throw new Error('没有可恢复的上一次备份')
    return db.importData(raw)
  },
}

// 双端同步：暴露订阅 / 通知 / 启动（App 挂载时调用 db.startSync()）
db.subscribe = (cb) => sync.subscribe(cb)
db.notify = () => sync.notify()
db.startSync = () => sync.start()

// 注意：ensureSeed 不再在模块加载时自动执行（防止数据损坏时被默认数据覆盖），
// 改由 main.jsx 启动门禁在「数据加载成功」后显式调用。
