# 前端基础界面实现 (2026-04-25)

## 1. 目标概述
本次工作的核心目标是为 IntelliGit 实现一个简易但功能完整的前端验证界面。在不依赖外部 React 组件库（如 Ant Design 或 MUI）的前提下，基于我们先前建立的 Electron-Vite-React 架构，手动编写 CSS 与组件，实现了一个类似 GitHub Desktop 风格的客户端 UI。

核心要验证的功能包括：
1. **持久化存储配置**：保存添加的仓库列表、当前选择的仓库等信息。
2. **多仓库管理**：选择添加本地仓库目录，切换当前活跃的仓库。
3. **仓库鉴权配置**：为每个仓库单独设置 HTTP(S) 或 SSH 的鉴权凭证（Username, Password/Token, SSH Key）。
4. **Git 核心操作的 UI 映射**：
   - 查看工作区/暂存区变更状态。
   - 文件级别 Add / Add All / Remove (取消暂存)。
   - 提交 (Commit)。
   - 远程同步：Push 与 Pull。
   - 分支切换。
   - 提交历史记录查看 (Log timeline)。

## 2. 架构与依赖关系

我们在现有的双向 IPC (Inter-Process Communication) 通道基础上，新增了**配置管理**与**原生对话框**相关的 IPC 通道。

**数据流向**：
`UI 组件 (MainApp.tsx)` <--> `Zustand 状态管理 (useAppStore.ts)` <--> `Preload API (electronAPI)` <--> `Electron Main (ipcMain)` <--> `系统文件 (userData / 原生对话框) 或 Go Sidecar (Git 操作)`

## 3. 详细实现步骤

### 3.1 扩展 IPC 通道与类型定义
**文件**：`src/shared/types/sidecar.ts`
- 增加了 `RepoConfig` 接口，用于表示单个仓库的路径、名称以及相关的鉴权信息。
- 增加了 `AppConfig` 接口，包含已添加的仓库列表 `repos` 和当前活跃的仓库路径 `currentRepoPath`。
- 新增 IPC 通道常量：
  - `CONFIG_LOAD` (`config:load`)
  - `CONFIG_SAVE` (`config:save`)
  - `DIALOG_OPEN_FOLDER` (`dialog:openFolder`)
- 扩展了暴露给前端的 `ElectronAPI` 接口，加入了 `loadConfig`, `saveConfig`, `openFolderDialog` 和 `mode`。

### 3.2 实现配置管理器与对话框服务 (Main 进程)
**文件**：`src/main/ipc/configHandlers.ts` 和 `src/main/ipc/index.ts`
- 编写了 `registerConfigHandlers`，处理配置相关的 IPC 请求。
- **配置文件位置**：通过 `app.getPath('userData')` 获取用户数据目录，将配置存储在 `intelligit-config.json` 中。
- **配置持久化**：使用 Node.js 的 `fs` 模块同步读写 JSON 文件。
- **文件夹选择**：调用 Electron 的 `dialog.showOpenDialog` 打开原生目录选择器。

### 3.3 更新 Preload 脚本
**文件**：`src/preload/index.ts`
- 将新增的 IPC 通道绑定到 `window.electronAPI`，供渲染进程安全调用。
- 通过 `process.env.ELECTRON_MODE` 暴露当前的运行模式（用于区分 `test` 测试面板和 `main` 正式界面）。

### 3.4 构建全局状态管理 (Zustand)
**文件**：`src/renderer/src/store/useAppStore.ts`
- 利用 `zustand` 构建了统一的状态库 `useAppStore`。
- **状态划分**：
  - **配置状态**：`repos`, `currentRepo`, `configLoaded`。
  - **Git 状态**：`fileStatuses`, `commitHistory`, `currentBranch`, `branches`。
  - **UI 状态**：`loading`, `operationLoading` (针对特定耗时操作如 push/pull/commit 的精准 loading)，`error`, `successMessage`, `activeView`。
- **行为封装**：
  - 封装了针对 `addRepo`, `switchRepo`, `removeRepo`，并在这些操作中自动调用 `persistConfig` 来同步底层 JSON 文件。
  - 封装了 `refreshAll` 方法，统一获取状态、历史和分支列表。
  - 封装了 `push` / `pull` 等远程操作，并自动从当前选中仓库的状态中取出鉴权配置（Username / Token / SSHKey）传递给 Go Sidecar。

### 3.5 构建 Github Desktop 风格 UI
**文件**：`src/renderer/src/MainApp.tsx`
整个主界面被划分为三个主要区域：
1. **左侧仓库侧边栏 (`RepoSidebar`)**：
   - 顶部提供 “添加仓库” 按钮。
   - 列表展示所有持久化的仓库，支持点击切换和悬浮显示移除按钮。
2. **顶部工具栏 (`Toolbar`)**：
   - 显示当前仓库名称。
   - 提供分支切换下拉菜单 (`branch picker`)。
   - 中间提供三个核心视图的切换 Tab（📝 变更、📜 历史、⚙ 设置）。
   - 右侧固定放置 Pull、Push、Refresh 全局操作按钮。
3. **右侧工作区 (`ig-content`)**：
   - **变更视图 (`ChangesView`)**：区分 “已暂存” (staged) 和 “未暂存” (unstaged) 列表，支持单个文件的 Add/Remove 以及全局的 Add All。底部固定一个提交输入面板 (`CommitPanel`)。
   - **历史视图 (`HistoryView`)**：仿造时间线（Timeline）的样式展示最近的 50 条提交记录，包括哈希、作者、时间等元数据。
   - **设置视图 (`SettingsView`)**：展示仓库的基本信息，并提供 HTTP(S) 和 SSH 两种鉴权信息的表单，信息点击保存后会通过 Zustand 更新并持久化。

此外，还实现了一个**全局通知横幅 (`NotificationBar`)**，用于浮层显示成功（绿色）或失败（红色）的操作反馈。

### 3.6 UI 美化与 CSS 编写
**文件**：`src/renderer/src/assets/main.css`
- **设计语言**：采用了暗色主题 (`dark mode`) 搭配局部的玻璃拟态 (`glassmorphism`) 背景（如 `backdrop-filter: blur`）。
- **色彩规范**：制定了全局的 CSS Variables，例如 `bg-primary`, `bg-secondary`, `accent-blue`, 以及渐变色 `gradient-brand`。
- **动画反馈**：
  - 为按钮交互添加了平滑的 `transition` 效果。
  - 为全局加载条 (`ig-loading-bar-inner`) 添加了跑马灯式的位移动画。
  - 为弹出的下拉框与通知横幅加入了 `slideIn` 进场动画。
- **排版与间距**：充分利用 Flexbox 进行灵活布局，并为自定义的滚动条编写了 webkit 样式以保持视觉的统一性。

## 4. 后续开发建议
1. **差异对比 (Diff View)**：目前 “变更视图” 仅展示了文件列表。后续可以利用侧边栏右侧的空白区域，展示选中文件的详细代码 Diff。
2. **分支管理**：现有的分支下拉框主要用于 `checkout`，后续需要加入创建新分支和删除分支的 UI 交互。
3. **全局配置与账号管理**：目前的鉴权是 “单仓库配置” 的形式，后续可以引入全局的凭据管理器，减少重复输入。
4. **异常处理增强**：由于各种操作依赖本地文件系统的权限或网络状况，前端可针对特定的错误码（例如 401 鉴权失败或远程冲突）给予更友好的本地化指引。
