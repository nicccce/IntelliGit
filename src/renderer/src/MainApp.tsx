/**
 * @file MainApp.tsx — IntelliGit 正式前端界面
 * @description 项目的正式用户界面，提供 Git 仓库管理功能。
 */

import React from 'react'

function MainApp(): React.JSX.Element {
  return (
    <div className="main-app-container">
      <header className="main-header">
        <h1>IntelliGit</h1>
        <p>智能 Git 版本控制工具</p>
      </header>
      <main className="main-content">
        <div className="repo-status">
          <h2>仓库状态</h2>
          <p>这里将显示当前 Git 仓库的状态信息。</p>
          {/* TODO: 集成 Git 状态显示组件 */}
        </div>
        <div className="features">
          <h2>功能</h2>
          <ul>
            <li>智能提交</li>
            <li>影子合并</li>
            <li>智能添加</li>
          </ul>
        </div>
      </main>
    </div>
  )
}

export default MainApp