// 纯本地版：不集成任何云端同步，数据存于本机浏览器。
export default function SyncBar() {
  return (
    <div className="syncbar syncbar--local">
      <span className="syncbar__dot" />
      <span>数据存于本机</span>
    </div>
  )
}
