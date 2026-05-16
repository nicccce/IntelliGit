# app

应用级装配层，负责主题、Provider、启动加载和全局生命周期 hook。这里不放具体业务视图，也不直接实现仓库、Diff、历史等界面细节。

`src/renderer/src/App.tsx` 是唯一的渲染入口分流文件：它根据 preload 暴露的 `electronAPI.mode` 选择正式 `app/MainApp` 或 `dev/SidecarTestPanel`。不要恢复根目录 `MainApp.tsx` 转发文件，正式主界面的真实落点必须保持在本目录。
