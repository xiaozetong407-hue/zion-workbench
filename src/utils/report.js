// 报告生成（从 Past.jsx 抽取为纯函数，供 UI 与自动生成共用）
import { db } from '../store/db.js'
import { addDays, todayStr } from './date.js'

// 枚举 [from, to] 闭区间内的所有日期（含两端，安全上限 400 天）
export function enumerateDates(from, to) {
  const out = []
  let d = from
  for (let i = 0; i < 400; i++) {
    out.push(d)
    if (d >= to) break
    d = addDays(d, 1)
  }
  return out
}

export async function buildReport(kind, from, to) {
  const dates = enumerateDates(from, to)
  const n = dates.length
  const datesSet = new Set(dates)

  const checkIns = db.getAllCheckIns()
  const tasksAll = db.getAllTasks()
  const reviews = db.get().reviews || {}
  const statusAll = db.getAllStatus()
  const ledger = db.getLedger()

  // 打卡完成率
  const ciDates = dates.filter((d) => checkIns[d])
  const totalItems = db.CHECKIN_ITEMS.length
  const ciDone = ciDates.reduce(
    (s, d) => s + db.CHECKIN_ITEMS.filter((it) => checkIns[d][it.key]).length,
    0,
  )
  const ciTotal = ciDates.length * totalItems
  const ciRate = ciTotal ? Math.round((ciDone / ciTotal) * 100) : 0

  // 各项完成天数（具体 6 项分别统计）
  const ciItems = db.CHECKIN_ITEMS.map((it) => ({
    key: it.key,
    label: it.label,
    done: dates.filter((d) => checkIns[d] && checkIns[d][it.key]).length,
  }))

  // 每日打卡明细（6 项逐日）
  const dailyCI = dates.map((d) => {
    const ci = checkIns[d] || {}
    return {
      date: d,
      items: db.CHECKIN_ITEMS.map((it) => ({ key: it.key, short: it.short, done: !!ci[it.key] })),
    }
  })

  // 任务完成率
  const tasks = tasksAll.filter((t) => datesSet.has(t.date))
  const tDone = tasks.filter((t) => t.done).length
  const tTotal = tasks.length
  const tRate = tTotal ? Math.round((tDone / tTotal) * 100) : 0

  // 睡眠 / 步数 / 卡路里平均
  const st = dates.map((d) => statusAll[d]).filter(Boolean)
  const avgSleep = st.length ? (st.reduce((s, x) => s + Number(x.sleepHours || 0), 0) / st.length).toFixed(1) : '—'
  const avgSteps = st.length ? Math.round(st.reduce((s, x) => s + Number(x.steps || 0), 0) / st.length) : '—'
  const avgCal = st.length ? Math.round(st.reduce((s, x) => s + Number(x.calories || 0), 0) / st.length) : '—'

  // 账本
  const led = ledger.filter((l) => datesSet.has(l.date))
  const exp = led.filter((l) => l.type === 'exp').reduce((s, l) => s + l.amount, 0)
  const inc = led.filter((l) => l.type === 'inc').reduce((s, l) => s + l.amount, 0)
  const balance = inc - exp

  // 复盘（仅累计游戏时长入统计，不展示复盘天数）
  const revDates = dates.filter((d) => reviews[d])
  const topThings = revDates.map((d) => reviews[d].tomorrow).filter(Boolean)
  const gameMin = revDates.reduce((s, d) => s + Number(reviews[d].gameMinutes || 0), 0)

  return {
    kind,
    title: kind === 'week' ? '周报' : kind === 'month' ? '月报' : '自定义报告',
    period: `${from} ~ ${to}`,
    createdAt: Date.now(),
    metrics: {
      ciRate, ciDone, ciTotal,
      ciItems,
      tRate, tDone, tTotal,
      avgSleep, avgSteps, avgCal,
      exp, inc, balance,
      gameMin,
      days: n,
    },
    dailyCI,
    highlights: topThings.slice(0, 3),
  }
}

// ---- 自动生成门禁：某天「任务复盘 + 状态」是否都已保存 ----
// 日复盘保存即要求 4 字段齐全（closer / pleasure / gameMinutes / tomorrow）；
// 状态「进行了保存」判定为当天存在状态记录（已点过「保存状态」）。
export function dayFullyRecorded(date) {
  const rev = db.getReview(date)
  const revOk = !!(
    rev &&
    (rev.closer || '').trim() &&
    (rev.pleasure || '').trim() &&
    rev.gameMinutes != null &&
    rev.gameMinutes !== '' &&
    (rev.tomorrow || '').trim()
  )
  const st = db.getStatus(date)
  const stOk = !!st
  return revOk && stOk
}

function reportExists(kind, period) {
  return db.getPastReports().some((r) => r.kind === kind && r.period === period)
}

// ---- 自动生成周报 / 月报 ----
// 周报：最近的、已过去的周日（今天严格晚于该周日）-> 覆盖 [周日-6, 周日]；
//       仅当该周日 dayFullyRecorded 为真，且尚无同区间周报时生成。
// 月报：最近的已完成月份（今天所在月的上一个月）的最后一天 -> 覆盖整月；
//       仅当该月最后一天 dayFullyRecorded 为真，且尚无同区间月报时生成。
// 幂等：靠 reportExists 去重，重复调用不会重复生成。
export async function autoGenerateReports() {
  const today = todayStr()
  const t = new Date(today + 'T00:00:00')
  const dow = t.getDay() // 0=周日

  // 最近的已过去周日：周一~周六 = today-dow；周日 = today-7（当周周日尚未「进入下一天」）
  const daysSinceSunday = dow === 0 ? 7 : dow
  const sunday = addDays(today, -daysSinceSunday)
  const weekPeriod = `${addDays(sunday, -6)} ~ ${sunday}`
  if (!reportExists('week', weekPeriod) && dayFullyRecorded(sunday)) {
    const rep = await buildReport('week', addDays(sunday, -6), sunday)
    db.addPastReport(rep)
  }

  // 最近的已完成月份：今天所在月第一天 -1 天 = 上个月最后一天
  const firstOfThisMonth = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`
  const lastOfPrevMonth = addDays(firstOfThisMonth, -1)
  const monthPeriod = `${lastOfPrevMonth.slice(0, 7)}-01 ~ ${lastOfPrevMonth}`
  if (!reportExists('month', monthPeriod) && dayFullyRecorded(lastOfPrevMonth)) {
    const rep = await buildReport('month', `${lastOfPrevMonth.slice(0, 7)}-01`, lastOfPrevMonth)
    db.addPastReport(rep)
  }
}
