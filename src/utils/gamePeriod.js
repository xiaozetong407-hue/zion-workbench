// 游戏时长周周期（P2 需求 6）：纯函数，零依赖，Node/浏览器均可直接使用与测试。
//
// 业务语义（明确「复盘日期 / 统计周期 / 当前时间」三者关系）：
//   - 复盘日期 reviewDate：用户在复盘界面准备回顾的那一天（YYYY-MM-DD）
//   - 统计周期：以 reviewDate 所在自然周（周一~周日）为基准
//   - 规则：复盘日期是周一（00:00~23:59 全天）→ 统计「上一完整周」（上周一~上周日），
//           因为周一刚过 0 点、用户尚未入睡，此刻要复盘的是「周一之前的那段时间」；
//           周二起 → 统计「本周」（本周一~本周日）。
//   - 当前时间 now：仅用于显式传参/测试，不参与周期判定（周期只由复盘日期决定），
//     避免「简单减一天/加一天」带来的边界错误。

// YYYY-MM-DD -> 星期（0=周日 .. 6=周六）
function dayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay()
}

// YYYY-MM-DD + n 天（纯字符串运算，正确处理跨月/跨年）
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 取 dateStr 所在周的周一
function mondayOf(dateStr) {
  const day = dayOfWeek(dateStr)
  const offset = day === 0 ? -6 : -(day - 1) // 周日 -> 回退 6 天，其余回退 (day-1)
  return addDaysStr(dateStr, offset)
}

// 复盘日期 -> 游戏时长统计周期
// 返回：{ periodStart, periodEnd, label }
export function getReviewGamePeriod(reviewDate, now) {
  const dateStr = reviewDate || todayStrOf(now)
  const monday = mondayOf(dateStr)
  const isMonday = dayOfWeek(dateStr) === 1
  const periodStart = isMonday ? addDaysStr(monday, -7) : monday
  const periodEnd = isMonday ? addDaysStr(monday, -1) : addDaysStr(monday, 6)
  return {
    periodStart,
    periodEnd,
    label: `${periodStart.slice(5)} ~ ${periodEnd.slice(5)}（${isMonday ? '上周一至上周日' : '本周一至本周日'}）`,
  }
}

// Date -> YYYY-MM-DD（无参时取今天）
function todayStrOf(d) {
  const x = d instanceof Date ? d : new Date()
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
