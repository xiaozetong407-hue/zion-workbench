// 实时刷新钩子：订阅 db 同步事件，远程数据变化时长连接组件重读
import { useEffect, useRef, useReducer } from 'react'
import { db } from './db.js'

export function useLive(onChange) {
  const [, force] = useReducer((x) => x + 1, 0)
  const cbRef = useRef(onChange)
  cbRef.current = onChange
  useEffect(() => {
    const handler = () => {
      if (cbRef.current) cbRef.current()
      force()
    }
    return db.subscribe(handler)
  }, [])
}
