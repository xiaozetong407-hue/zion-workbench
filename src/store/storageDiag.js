// 持久化存储诊断（只读，无副作用，绝不修改任何数据）
// 唯一的非纯读取调用是 navigator.storage.persist()，它只是向浏览器「请求」持久化保护，
// 不会改变 localStorage 中的任何业务数据，也不会删除/覆盖站点数据。
// 用途：在手机端一键确认当前 Zion Origin 是否已获得 Persistent Storage 保护。
export async function runStorageDiagnostic() {
  const out = { api: {}, env: {}, sw: null, persist: null, estimate: null, summary: '', lines: [] }

  const s = navigator.storage
  out.api.storage = typeof s
  out.api.persist = typeof (s && s.persist)
  out.api.persisted = typeof (s && s.persisted)
  out.api.estimate = typeof (s && s.estimate)

  out.env.origin = location.origin
  out.env.href = location.href
  try {
    out.env.displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches
  } catch (e) {
    out.env.displayModeStandalone = 'err:' + e.message
  }
  out.env.navigatorStandalone = window.navigator.standalone

  // Service Worker（只读，不注销、不修改）
  if (navigator.serviceWorker) {
    try {
      const ctrl = navigator.serviceWorker.controller
      const regs = await navigator.serviceWorker.getRegistrations()
      out.sw = { controller: !!ctrl, count: regs.length, scope: regs[0] ? regs[0].scope : null }
    } catch (e) {
      out.sw = { error: e.message }
    }
  } else {
    out.sw = 'no-api'
  }

  // persisted() 调用前后 + persist() 请求
  if (s && typeof s.persisted === 'function') {
    const before = await s.persisted()
    let result = null
    let error = null
    try {
      result = await s.persist()
    } catch (e) {
      error = e && e.message
    }
    const after = await s.persisted()
    out.persist = { before, result, error, after, changed: before !== after }
  } else {
    out.persist = 'unsupported'
  }

  // 存储用量（只读）
  if (s && typeof s.estimate === 'function') {
    try {
      const est = await s.estimate()
      out.estimate = { usage: est.usage, quota: est.quota, usageDetails: est.usageDetails || null }
    } catch (e) {
      out.estimate = { error: e.message }
    }
  } else {
    out.estimate = 'unsupported'
  }

  // 结论
  if (out.persist && out.persist.after === true) {
    out.summary = '已获得持久化保护 ✅'
  } else if (out.persist === 'unsupported') {
    out.summary = '当前环境不支持 Storage API'
  } else {
    out.summary = '未获得持久化保护 ⚠️（普通标签页 / 未安装 PWA 时常见）'
  }

  // 可读行
  const L = []
  L.push(['Persistent Storage API', out.api.persist === 'function' && out.api.persisted === 'function' ? '支持' : '不支持'])
  L.push(['persist()', out.persist === 'unsupported' ? '不支持' : String(out.persist.result)])
  L.push(['persisted()', out.persist === 'unsupported' ? '不支持' : String(out.persist.after)])
  L.push(['location.origin', out.env.origin])
  L.push(['当前 URL', out.env.href])
  L.push(['display-mode standalone', String(out.env.displayModeStandalone)])
  L.push(['navigator.standalone', String(out.env.navigatorStandalone)])
  const sw = out.sw
  L.push(['ServiceWorker', typeof sw === 'string' ? sw : `controller=${sw.controller}；注册数=${sw.count}${sw.scope ? '；scope=' + sw.scope : ''}`])
  if (out.estimate && out.estimate.usage != null) {
    L.push(['usage', out.estimate.usage + ' 字节（≈' + (out.estimate.usage / 1048576).toFixed(2) + ' MB）'])
    L.push(['quota', out.estimate.quota + ' 字节（≈' + (out.estimate.quota / 1073741824).toFixed(2) + ' GB）'])
  }
  L.push(['结论', out.summary])
  out.lines = L

  return out
}
