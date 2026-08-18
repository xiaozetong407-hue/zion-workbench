import React from 'react'

// 通用遮罩弹窗：点击遮罩或关闭按钮关闭；内容区通过 children 注入
export default function Modal({ title, onClose, children }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <span className="modal__title">{title}</span>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}
