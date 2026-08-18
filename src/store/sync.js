// 双端同步层（浏览器端）
// 设计：OneDrive 文件（/zion-workbench/zion-data.json）持有整个 zion-data-v1 blob 的「唯一真值」。
//  - 本地写入：事务式安全写（validate -> serialize -> write -> read-back -> validate，失败回滚+抛错）
//  - 定时/切回前台：拉取 OneDrive 文件，与本地合并后通知订阅者刷新 UI
//  - 合并策略：带 id 的数组按 id 并集（双端同时新增不丢）；对象型(map)按子键并集、冲突时云端优先
//  - 乐观并发：推送带 OneDrive etag，若被另一设备抢先(412) -> 拉取合并后重试一次
//
// 未登录 OneDrive 时退化为纯本地（仍可正常使用），登录后自动开始同步。
//
// 本文件是 Storage Adapter（唯一接触 zion-data-v1 的层）。未来迁移 IndexedDB 只改这里。
// 安全边界（P1 硬性约束 A）：
//   - 读取：JSON 解析失败 / 结构校验失败 -> 抛错（不再静默返回 {}），由上层进入 Recovery Mode
//   - 写入：commit(obj) 事务式——校验->序列化->写->读回->再校验，任一步失败回滚旧值并抛错，
//     且不替换内存 cache；成功后才把 cache 提交为新数据

import onedrive from './onedrive.js'
import { validateData } from '../utils/dataValidate.js'

const KEY = 'zion-data-v1'
const PULL_INTERVAL = 5000
// 仅 To Do 模式：关闭 OneDrive 文件同步（用户未要求整库同步），避免无谓写盘/报错。
// 微软 To Do 走 todo.js 独立用 token，不受此开关影响。
const FILE_SYNC = false

const subscribers = new Set()
let cache = null
let etag = null // OneDrive 文件 etag（乐观并发用）
let pushTimer = null
let started = false
let status = 'local' // 'local' | 'signedout' | 'syncing' | 'synced' | 'error'

// 读取原始字符串（不解析）。数据损坏时此值仍可用（供 Recovery Mode 原样导出）。
function readRaw() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// 安全加载：parse + validate。无数据（首次使用）返回 {}；损坏则抛错，绝不静默吞掉。
function loadFromStorage() {
  const raw = readRaw()
  if (raw == null) return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error('数据损坏：JSON 解析失败（' + (e && e.message ? e.message : e) + '）')
  }
  const v = validateData(parsed)
  if (!v.ok) throw new Error('数据校验失败：' + v.errors.join('；'))
  return parsed
}

// 事务式安全写。obj 必须已通过校验的完整业务对象。
function commitToStorage(obj) {
  const oldRaw = readRaw() // 写入前旧值（回滚用）
  const v = validateData(obj)
  if (!v.ok) throw new Error('提交数据校验失败：' + v.errors.join('；'))
  let json
  try {
    json = JSON.stringify(obj)
    JSON.parse(json) // 序列化结果必须可反序列化
  } catch (e) {
    throw new Error('序列化失败：' + (e && e.message ? e.message : e))
  }
  try {
    localStorage.setItem(KEY, json)
  } catch (e) {
    throw new Error('写入失败：' + (e && e.message ? e.message : e))
  }
  // 读回验证：失败则回滚旧值（不得让「写坏」的数据留在盘上）
  try {
    const backRaw = localStorage.getItem(KEY)
    const back = JSON.parse(backRaw)
    const v2 = validateData(back)
    if (!v2.ok) throw new Error('读回验证失败：' + v2.errors.join('；'))
  } catch (e) {
    try {
      if (oldRaw != null) localStorage.setItem(KEY, oldRaw)
    } catch { /* 回滚失败时保持抛错 */ }
    throw e
  }
  return true
}

const ID_ARRAYS = [
  'tasks', 'ledger', 'quotes', 'books', 'favorites',
  'studyLogs', 'pastReports', 'wereadReviews', 'wereadBooks',
]
const MAP_KEYS = [
  'checkIns', 'status', 'reviews', 'plans',
  'monthReviews', 'yearReviews', 'prompts', 'settings',
]

// 合并：remote 为服务器真值；本地独有的项/子键一律保留，冲突时服务器优先
function mergeBlobs(local, remote) {
  const out = { ...remote }
  for (const key of MAP_KEYS) {
    const l = local[key] && typeof local[key] === 'object' ? local[key] : {}
    const r = remote[key] && typeof remote[key] === 'object' ? remote[key] : {}
    const merged = { ...l }
    for (const k of Object.keys(r)) merged[k] = r[k]
    out[key] = merged
  }
  for (const key of ID_ARRAYS) {
    const l = Array.isArray(local[key]) ? local[key] : []
    const r = Array.isArray(remote[key]) ? remote[key] : []
    const map = new Map()
    r.forEach((it) => { if (it && it.id) map.set(it.id, it) })
    l.forEach((it) => { if (it && it.id && !map.has(it.id)) map.set(it.id, it) })
    out[key] = Array.from(map.values())
  }
  for (const k of Object.keys(local)) {
    if (!(k in out)) out[k] = local[k]
  }
  return out
}

export const sync = {
  getCache() {
    if (cache == null) cache = loadFromStorage()
    return cache
  },
  getRev() {
    return etag
  },

  getStatus() {
    return status
  },

  subscribe(cb) {
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  },
  notify() {
    subscribers.forEach((cb) => {
      try { cb() } catch (e) { /* 单个订阅者异常不影响其他 */ }
    })
  },

  // 事务式提交新数据（P1 安全边界核心）：
  // 校验->序列化->写入->读回验证，全部成功后才把内存 cache 替换为新数据并通知订阅者。
  // 任一步失败：抛错、回滚旧值、不替换 cache、不静默恢复 {}。
  commit(obj) {
    commitToStorage(obj)
    cache = obj
    this.notify()
    this.schedulePush()
  },

  // 仅替换内存 cache（不落盘）。供 importData 失败回滚恢复内存视图用。
  setMemory(obj) {
    cache = obj
  },

  // 读取原始字符串（不解析、不校验），供 Recovery Mode「导出原始数据」使用
  getRaw() {
    return readRaw()
  },

  // 仅测试用：重置内存态
  resetForTest() {
    cache = null
    etag = null
    status = 'local'
  },

  // 旧接口兼容：db.save() 曾调用。现内部转为事务提交（仅当 cache 已加载时才有意义）
  setCache() {
    if (cache == null) cache = loadFromStorage()
    this.commit(cache)
  },

  schedulePush() {
    if (!FILE_SYNC) return
    if (pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      this.push()
    }, 250)
  },

  async push() {
    if (cache == null) return
    if (!onedrive.isSignedIn()) {
      status = 'signedout'
      this.notify()
      return
    }
    try {
      status = 'syncing'
      this.notify()
      const r = await onedrive.upload(cache, etag)
      if (r.conflict) {
        await this.pull(true)
        await this.pushOnce()
        return
      }
      if (r.ok) {
        etag = r.etag
        status = 'synced'
      } else {
        status = 'error'
      }
    } catch {
      status = 'error'
    }
    this.notify()
  },

  async pushOnce() {
    if (!onedrive.isSignedIn()) return
    try {
      const r = await onedrive.upload(cache, etag)
      if (r.ok) {
        etag = r.etag
        status = 'synced'
      } else if (!r.conflict) {
        status = 'error'
      }
    } catch {
      status = 'error'
    }
    this.notify()
  },

  async pull(isRetry = false) {
    if (!onedrive.isSignedIn()) {
      status = 'signedout'
      this.notify()
      return
    }
    try {
      const d = await onedrive.download()
      if (!d) {
        status = 'signedout'
        this.notify()
        return
      }
      const remoteEtag = d.etag
      // 首次 / 远端变更 / 冲突重试：合并后落盘并刷新
      if (!etag || remoteEtag !== etag || isRetry) {
        const merged = mergeBlobs(cache || {}, d.blob)
        commitToStorage(merged) // 事务式写入；失败抛错由外层 catch 捕获（不替换 cache）
        cache = merged
        etag = remoteEtag
        this.notify()
      }
      status = 'synced'
    } catch {
      status = 'error'
    }
    this.notify()
  },

  start() {
    if (started) return
    started = true
    if (!FILE_SYNC) {
      // 仅 To Do 模式：不拉取/推送 OneDrive 文件，只标记已连接
      status = 'synced'
      this.notify()
      return
    }
    cache = loadFromStorage()
    if (onedrive.isSignedIn()) {
      this.pull().then(() => this.push())
    } else {
      status = 'signedout'
      this.notify()
    }
    setInterval(() => {
      if (onedrive.isSignedIn()) this.pull()
    }, PULL_INTERVAL)
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && onedrive.isSignedIn()) {
        this.pull()
      }
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisible)
  },

  // ---- 登录态（由 UI 调用）----
  isConfigured() {
    return onedrive.isConfigured()
  },
  isSignedIn() {
    return onedrive.isSignedIn()
  },
  connect() {
    return onedrive.signIn()
  },
  signOut() {
    onedrive.signOut()
    status = 'signedout'
    this.notify()
  },
  async handleAuth() {
    const ok = await onedrive.handleRedirect()
    if (ok) {
      status = 'syncing'
      this.notify()
      this.pull().then(() => this.push())
    }
    this.notify()
    return ok
  },
}

export default sync
