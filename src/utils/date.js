// 日期工具：统一用 YYYY-MM-DD 字符串作为数据主键
// 农历使用 lunar-javascript 库（准确覆盖 1900–2100+），替换旧的手写简算

import { Solar } from 'lunar-javascript'

// ---- 基础 ----

export function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return todayStr(d)
}

// 任务 / 状态的「当日」主键：以凌晨 6 点为界，6 点前算前一天。
// 用于实现「每天 6 点自动保存当日、清空待办 / 状态输入框」的滚动语义。
export function appDay(d = new Date()) {
  const x = new Date(d)
  if (x.getHours() < 6) x.setDate(x.getDate() - 1)
  return todayStr(x)
}

export function formatDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function getWeekCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

export function mmdd(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- 农历（基于 lunar-javascript 库，准确）----
// 注意：必须用 Solar.fromYmd(公历).getLunar()，不能用 Lunar.fromYmd(会把入参当农历)

// 返回示例：丙午马 六月十六
export function getLunarString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const lunar = Solar.fromYmd(y, m, d).getLunar()
  const ganZhi = lunar.getYearInGanZhi()
  const zodiac = lunar.getYearShengXiao()
  const month = lunar.getMonthInChinese()
  const day = lunar.getDayInChinese()
  return `${ganZhi}${zodiac} ${month}月${day}`
}

// 短日期格式：26-7-28（YY-M-D，不补零）
export function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const yy = String(d.getFullYear()).slice(-2)
  return `${yy}-${d.getMonth() + 1}-${d.getDate()}`
}

// ---- 剩余时间计算（含已度过比例，用于进度条）----

export function getRemaining(birthDateStr, lifeExpectancy = 80) {
  const now = new Date()
  const birth = new Date(birthDateStr + 'T00:00:00')

  // 人生
  const deathDate = new Date(birth.getFullYear() + lifeExpectancy, birth.getMonth(), birth.getDate())
  const lifeMs = deathDate - now
  const lifeDays = Math.max(0, Math.ceil(lifeMs / 86400000))
  const totalLifeDays = lifeExpectancy * 365.25
  const lifeElapsed = Math.min(1, Math.max(0, 1 - lifeDays / totalLifeDays))

  // 今年
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59)
  const yearMs = yearEnd - now
  const yearDays = Math.max(0, Math.ceil(yearMs / 86400000))
  const yearElapsed = Math.min(1, Math.max(0, (now - yearStart) / (yearEnd - yearStart)))

  // 本月
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const monthMs = monthEnd - now
  const monthDays = Math.max(0, Math.ceil(monthMs / 86400000))
  const monthElapsed = Math.min(1, Math.max(0, (now - monthStart) / (monthEnd - monthStart)))

  // 今日
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
  const todayMs = todayEnd - now
  const todayHours = Math.max(0, todayMs / 3600000)
  const todayElapsed = Math.min(1, Math.max(0, (now - todayStart) / (todayEnd - todayStart)))

  return {
    life: { value: lifeDays, unit: '天', elapsed: lifeElapsed },
    year: { value: yearDays, unit: '天', elapsed: yearElapsed },
    month: { value: monthDays, unit: '天', elapsed: monthElapsed },
    today: { value: todayHours.toFixed(1), unit: '时', elapsed: todayElapsed },
  }
}

// ---- 周期判定与周期键（用于「按周期存储」的计划 / 复盘）----

// 是否为当月最后一天
export function isLastDayOfMonth(dateStr = todayStr()) {
  const d = new Date(dateStr + 'T00:00:00')
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return d.getDate() === last.getDate()
}

// 是否为当年最后一天（12-31）
export function isLastDayOfYear(dateStr = todayStr()) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getMonth() === 11 && d.getDate() === 31
}

// YYYY-MM（月周期键）
export function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7)
}

// YYYY（年周期键）
export function yearKey(dateStr = todayStr()) {
  return String(new Date(dateStr + 'T00:00:00').getFullYear())
}

// YYYY-Www（周周期键，ISO 周数）
export function weekKey(dateStr = todayStr()) {
  const d = new Date(dateStr + 'T00:00:00')
  const jan1 = new Date(d.getFullYear(), 0, 1)
  // 找到该年的第一个周四，确定 ISO 周一
  const firstDay = jan1.getDay() || 7
  const firstThu = new Date(jan1)
  firstThu.setDate(jan1.getDate() + ((4 - firstDay + 7) % 7))
  const diffMs = d.getTime() - firstThu.getTime()
  const weekNum = Math.ceil((diffMs / 86400000 + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// 最近 n 个月（含当月），返回 YYYY-MM 数组，由新到旧
export function getMonthsBack(n = 12) {
  const out = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// 最近 n 年（含今年），返回 YYYY 数组，由新到旧
export function getYearsBack(n = 6) {
  const y = new Date().getFullYear()
  const out = []
  for (let i = 0; i < n; i++) out.push(String(y - i))
  return out
}
