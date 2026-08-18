// P2 需求 6 边界测试：getReviewGamePeriod(reviewDate, now)
// 覆盖：周一 00:01 / 周一白天 / 周一 23:59 / 周二 00:01 / 周日 / 月初 / 月末 / 年初 / 年末
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getReviewGamePeriod } from '../src/utils/gamePeriod.js'

// 断言周期 + label
function expect(dateStr, start, end, labelPart) {
  const r = getReviewGamePeriod(dateStr, new Date(dateStr + 'T12:00:00'))
  assert.equal(r.periodStart, start)
  assert.equal(r.periodEnd, end)
  assert.ok(r.label.includes(labelPart), `label 应包含「${labelPart}」，实际：${r.label}`)
}

test('周一 00:01：显示上一周（上周一~上周日）', () => {
  const r = getReviewGamePeriod('2026-08-17', new Date('2026-08-17T00:01:00'))
  assert.equal(r.periodStart, '2026-08-10')
  assert.equal(r.periodEnd, '2026-08-16')
  assert.equal(r.label, '08-10 ~ 08-16（上周一至上周日）')
})

test('周一白天：仍显示上一周', () => {
  const r = getReviewGamePeriod('2026-08-17', new Date('2026-08-17T12:00:00'))
  assert.equal(r.periodStart, '2026-08-10')
  assert.equal(r.periodEnd, '2026-08-16')
})

test('周一 23:59：仍显示上一周（当天不切换）', () => {
  const r = getReviewGamePeriod('2026-08-17', new Date('2026-08-17T23:59:00'))
  assert.equal(r.periodStart, '2026-08-10')
  assert.equal(r.periodEnd, '2026-08-16')
})

test('周二 00:01：切换为本周（本周一~本周日）', () => {
  const r = getReviewGamePeriod('2026-08-18', new Date('2026-08-18T00:01:00'))
  assert.equal(r.periodStart, '2026-08-17')
  assert.equal(r.periodEnd, '2026-08-23')
  assert.equal(r.label, '08-17 ~ 08-23（本周一至本周日）')
})

test('周日：本周（周一~周日完整周）', () => {
  const r = getReviewGamePeriod('2026-08-23', new Date('2026-08-23T20:00:00'))
  assert.equal(r.periodStart, '2026-08-17')
  assert.equal(r.periodEnd, '2026-08-23')
})

test('月初：9-1（周二）本周 = 8-31 ~ 9-6，跨月正确', () => {
  const r = getReviewGamePeriod('2026-09-01', new Date('2026-09-01T09:00:00'))
  assert.equal(r.periodStart, '2026-08-31')
  assert.equal(r.periodEnd, '2026-09-06')
})

test('月末：8-31 恰是周一 -> 上一周 8-24 ~ 8-30', () => {
  const r = getReviewGamePeriod('2026-08-31', new Date('2026-08-31T22:00:00'))
  assert.equal(r.periodStart, '2026-08-24')
  assert.equal(r.periodEnd, '2026-08-30')
})

test('年初：1-1（周四）本周 = 12-29 ~ 1-4，跨年正确', () => {
  const r = getReviewGamePeriod('2026-01-01', new Date('2026-01-01T08:00:00'))
  assert.equal(r.periodStart, '2025-12-29')
  assert.equal(r.periodEnd, '2026-01-04')
})

test('年末：12-31（周四）本周 = 12-28 ~ 1-3，跨年正确', () => {
  const r = getReviewGamePeriod('2026-12-31', new Date('2026-12-31T18:00:00'))
  assert.equal(r.periodStart, '2026-12-28')
  assert.equal(r.periodEnd, '2027-01-03')
})

test('周期只由复盘日期决定，now 不参与判定（稳定）', () => {
  // 同为周一复盘，不同 now 结果一致
  const a = getReviewGamePeriod('2026-08-17', new Date('2026-08-17T00:01:00'))
  const b = getReviewGamePeriod('2026-08-17', new Date('2026-08-17T23:59:59'))
  assert.deepEqual(a, b)
  // 周二起，now 无论几点都显示本周
  const c = getReviewGamePeriod('2026-08-18', new Date('2026-08-18T00:01:00'))
  const d = getReviewGamePeriod('2026-08-18', new Date('2026-08-18T23:59:00'))
  assert.deepEqual(c, d)
  assert.equal(c.periodStart, '2026-08-17')
})

test('reviewDate 缺省：取 now 的日期（默认今天）', () => {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  const r = getReviewGamePeriod(undefined, today)
  assert.ok(r.periodStart.startsWith(y + '-'))
  assert.ok(r.periodStart.slice(5, 7) === m || r.periodStart.slice(5, 7) === (m === '01' ? '12' : String(Number(m) - 1).padStart(2, '0')))
  assert.ok(r.periodEnd >= r.periodStart)
  // 周跨月边界时 start 可能在上一月（如今天是月初周一），只校验区间有效
  assert.equal(r.periodEnd > r.periodStart, true)
  assert.equal(Number(r.periodEnd.slice(0, 4)) >= Number(r.periodStart.slice(0, 4)), true)
})

// 简单断言一组已知组合（增强可读性）
test('回归：一组已知周组合', () => {
  expect('2026-08-17', '2026-08-10', '2026-08-16', '上周一至上周日')
  expect('2026-08-16', '2026-08-10', '2026-08-16', '本周一至本周日')
  expect('2026-08-24', '2026-08-17', '2026-08-23', '上周一至上周日')
  expect('2026-08-30', '2026-08-24', '2026-08-30', '本周一至本周日')
  expect('2026-09-06', '2026-08-31', '2026-09-06', '本周一至本周日')
})
