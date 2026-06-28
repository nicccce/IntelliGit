# IntelliGit

IntelliGit 是一个面向开发者的桌面 Git 客户端，目标是在常规 Git 操作之外，提供更强的变更理解、智能提交、冲突辅助和自然语言 Git 助手能力。

项目当前采用 **Electron + React + TypeScript + Zustand + Go Sidecar** 架构：桌面壳和 IPC 由 Electron Main/Preload 负责，界面由 React Renderer 负责，底层 Git 能力由独立 Go Sidecar 进程通过 stdin/stdout JSON 协议提供。

## 功能概览

### 已落地能力

- 仓库管理：打开本地仓库、初始化仓库、克隆仓库、保存最近使用仓库配置。
- 工作区视图：查看 staged / unstaged / untracked 文件状态，查看工作区和暂存区 diff。
- 暂存操作：按文件暂存、全部暂存、移除、还原、应用 patch、取消 hunk 暂存。
- 提交能力：创建 commit，支持自定义提交作者名称和邮箱。
- 智能提交：基于 staged diff 生成 Conventional Commits 风格提交信息；未配置 AI 时降级为本地模板。
- 变更意图分组：对工作区变更按提交意图分组，支持按分组暂存并生成提交信息。
- AST 语义分析：对 TypeScript / JavaScript / TSX / JSX 使用 Babel，对 Python / Go / Java / C / C++ 使用 Tree-sitter WASM，提取变更符号、hunk 所属上下文和语义风险。
- 历史视图：查看 commit log、分支列表、commit graph、提交详情、提交 diff。
- 分支操作：列出本地/远程分支，切换分支，新建分支，删除分支，checkout commit，reset commit。
- 远程操作：配置 HTTP(S) 或 SSH 远程地址，fetch、pull、push，显示 ahead / behind 状态。
- 合并与冲突：启动 merge、查看 merge 状态、取消 merge、继续 merge、读取三方冲突内容、写入解决结果。
- 冲突辅助：基于 ancestor / ours / theirs 生成规则化或 AI 建议，支持语义风险地图、二进制冲突选择 ours/theirs。
- 自然语言 Git 助手：将自然语言解析为 Git 操作计划，执行安全操作，高风险操作二次确认，极高风险操作默认拦截。
- AI 服务配置：支持 OpenAI 兼容接口和 Anthropic，支持自定义 Base URL、模型名、temperature、max tokens，并可测试连接。
- Sidecar 健康检查：通过 `sidecar.ping` 检查 Go Sidecar 进程与协议可用性。
- 开发调试模式：`ELECTRON_MODE=test` 时进入 Sidecar 调试面板。

### 安全边界

- Renderer 不能直接访问 Node/Electron 私有能力，只能通过 Preload 暴露的 `window.electronAPI` 调用受控 API。
- 正式 UI 不直接调用 `window.electronAPI.invokeGit(...)`，统一通过 `src/renderer/src/api/gitClient.ts` 和 service 层编排。
- 自然语言 Git 助手会对 `push --force`、`reset --hard`、`clean -f`、删除保护分支等操作做风险分级。
- 极高风险操作默认阻止；全局设置中可放宽部分策略，但仍会进入高风险确认流程。
- Sidecar 的 Git CLI 调用统一走 Go 侧封装，避免交互式凭据窗口和不可控命令行为扩散。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面运行时 | Electron 39、electron-vite |
| 前端 | React 19、TypeScript、Ant Design、CSS Modules |
| 状态管理 | Zustand |
| AI 接入 | Vercel AI SDK、OpenAI 兼容接口、Anthropic |
| 代码语义分析 | Babel parser/traverse、web-tree-sitter、Tree-sitter WASM |
| Git 后端 | Go Sidecar、go-git、Git CLI |
| 构建打包 | electron-builder、TypeScript、ESLint、Prettier |

## 架构

```text
┌────────────────────────────────────────────────────────────┐
│ Renderer: React UI                                          │
│ views / layout / components / viewModels / store / services │
└───────────────────────────┬────────────────────────────────┘
                            │ Preload exposes window.electronAPI
┌───────────────────────────▼────────────────────────────────┐
│ Electron Main                                                │
│ IPC handlers / config / LLM proxy / Git exec / SidecarManager│
└───────────────────────────┬────────────────────────────────┘
                            │ stdin/stdout NDJSON
┌───────────────────────────▼────────────────────────────────┐
│ Go Sidecar                                                   │
│ handler router / repository facade / go-git / git CLI        │
└────────────────────────────────────────────────────────────┘
```

### 进程职责

- **Renderer**：只负责用户界面、视图状态、业务流程编排和可视化展示。
- **Preload**：通过 `contextBridge` 暴露最小 API 面，隔离 Renderer 与 Node/Electron 能力。
- **Main**：创建窗口、管理应用生命周期、注册 IPC、读写应用配置、启动和监控 Sidecar。
- **Sidecar**：维护当前 Git 仓库上下文，执行 Git 领域命令，并通过 JSON 行协议返回结构化结果。

### Git 能力分工

Go Sidecar 内部以 `internal/git.Repository` 作为 handler 唯一依赖的 facade。底层能力按语义选择 `go-git` 或 Git CLI：

- `go-git`：仓库打开/初始化/克隆、状态、add/remove/restore、提交、分支、远程 fetch/push、结构化 diff 等。
- Git CLI：patch/hunk 暂存、raw diff、merge/abort/continue、冲突文件发现、需要原生 Git 语义的历史查询等。

## 目录结构

```text
.
├── src/
│   ├── main/                 # Electron Main：窗口、IPC、Sidecar 生命周期、Agent 运行时
│   │   ├── agent/            # Main 侧 AI SDK 调用、LLM 连通性检测、Git tool
│   │   ├── core/             # SidecarManager
│   │   ├── features/         # Main 侧功能说明与边界文档
│   │   └── ipc/              # Git、配置、LLM、NLP、Agent IPC handlers
│   ├── preload/              # contextBridge API
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── app/          # 应用装配、Provider、主题、生命周期 hook
│   │       ├── layout/       # AppShell、工具栏、侧栏、状态栏、全局面板
│   │       ├── views/        # ChangesView、HistoryView、SettingsView、NlpView
│   │       ├── components/   # 可复用 UI：DiffView、RepoAvatar、状态徽标等
│   │       ├── viewModels/   # UI 订阅适配层，只给组件暴露稳定模型
│   │       ├── store/        # Zustand 状态域和 selectors
│   │       ├── services/     # 跨 store / API 的业务流程编排
│   │       ├── api/          # 对 preload API 的类型化封装
│   │       ├── agent/        # Renderer 侧 prompt、解析、降级逻辑
│   │       ├── utils/        # AST 分析、diff selection、commit graph 等纯函数
│   │       ├── hooks/        # 通用 React hooks
│   │       ├── dev/          # 开发调试面板
│   │       └── assets/       # 全局样式、主题 token、Ant Design 覆盖
│   └── shared/types/         # Main / Preload / Renderer / Sidecar 共享类型
├── sidecar/                  # Go Sidecar
│   ├── cmd/sidecar/          # Sidecar 入口
│   └── internal/
│       ├── protocol/         # stdin/stdout JSON 协议 codec
│       ├── handler/          # command router、payload/result contracts、handlers
│       └── git/              # Repository facade、go-git backend、Git CLI backend
├── resources/                # 应用资源与 Sidecar 二进制输出位置
├── scripts/                  # 构建脚本和架构边界检查脚本
├── docs/                     # 需求、规则、重构记录、阶段文档
├── build/                    # electron-builder 资源
└── out/ / dist/              # 构建输出
```

## 快速开始

### 环境要求

- Node.js 和 npm。
- Git。
- Go：推荐安装与 `sidecar/go.mod` 匹配的版本。没有 Go 时，如果 `resources/` 中已有当前平台的 Sidecar 预编译二进制，项目仍可运行。
- Windows 开发建议使用 PowerShell，命令可优先使用 `npm.cmd`。

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
# 正式主界面开发模式
npm run dev:main

# Sidecar 调试面板模式
npm run dev:test

# 默认开发模式
npm run dev
```

以上命令都会先执行 `npm run build:sidecar`，确保 `resources/intelligit-sidecar(.exe)` 存在。

### 生产预览

```bash
npm run start
```

`start` 使用 `electron-vite preview`，通常需要先完成构建。

## 构建

```bash
# 完整构建：Sidecar + TypeScript typecheck + electron-vite build
npm run build

# Windows：构建未打包目录，便于本地检查
npm run build:unpack

# Windows：构建安装包
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Windows 打包命令已在 `package.json` 中关闭证书自动发现和可执行文件签名编辑，便于本地无证书环境构建。

### Sidecar 构建行为

`scripts/build-sidecar.mjs` 会按以下规则处理：

1. 如果设置 `INTELLIGIT_SKIP_SIDECAR_BUILD=1`，且 `resources/` 中已有对应二进制，则直接复用。
2. 如果本机可执行 `go version`，则在 `sidecar/` 下运行 `go build`，输出到 `resources/intelligit-sidecar(.exe)`。
3. 如果本机没有 Go，但 `resources/` 中已有对应二进制，则复用已有文件。
4. 如果本机没有 Go，且 `resources/` 中没有对应二进制，则构建失败。

手动构建：

```bash
# Windows
cd sidecar
go build -o ../resources/intelligit-sidecar.exe ./cmd/sidecar

# macOS / Linux
cd sidecar
go build -o ../resources/intelligit-sidecar ./cmd/sidecar
```

## 常用开发命令

```bash
# 格式化
npm run format

# ESLint + Renderer 边界检查 + 样式边界检查
npm run lint

# TypeScript 检查
npm run typecheck

# 只检查 Main/Preload/Node 侧 TS
npm run typecheck:node

# 只检查 Renderer 侧 TS
npm run typecheck:web

# 单独构建 Go Sidecar
npm run build:sidecar

# Go 侧测试
cd sidecar
go test ./...
```

`npm run lint` 会额外执行：

- `scripts/check-renderer-boundaries.mjs`：检查 Renderer 分层 import 边界。
- `scripts/check-renderer-styles.mjs`：检查 Renderer 样式边界。

## 应用配置

应用配置由 Main 进程读写，保存到 Electron `app.getPath('userData')` 下的：

```text
intelligit-config.json
```

配置内容包括：

- 已添加仓库列表。
- 当前仓库路径。
- 每个仓库的远程配置、提交作者、HTTP(S)/SSH 认证信息。
- LLM Provider 配置。
- NLP 高风险操作安全策略。

> 注意：当前配置中可能包含 API Key、Token、SSH 密钥密码等敏感信息。不要把用户数据目录中的配置文件提交到仓库或公开分享。

## AI 与自然语言能力

### LLM Provider

全局设置面板支持两类 Provider：

- `openai`：OpenAI 兼容接口，适用于 OpenAI、DeepSeek、通义千问、本地兼容服务等，可配置 Base URL。
- `anthropic`：Anthropic Claude API。

可配置字段：

- API Key
- Base URL
- Model Name
- Temperature
- Max Tokens

### AI 使用位置

- 智能生成提交信息。
- 变更意图分组。
- 冲突解决建议。
- 自然语言 Git 操作解析。
- Git 输出解释与对话式辅助。

所有关键 AI 功能都有降级路径：未配置或调用失败时，提交信息和冲突建议会尽量回退到本地模板或规则化建议。

### 自然语言 Git 助手风险策略

自然语言助手会把用户输入解析为结构化 Git 操作计划，再执行风险检查：

| 风险等级 | 行为 |
| --- | --- |
| safe | 可自动执行 |
| high | 展示确认弹窗，用户确认后执行 |
| extreme | 默认拦截并记录历史 |

全局设置中的安全策略可以允许部分极高风险操作降级为高风险确认，例如 `force push` 或 `reset --hard`。

## Sidecar 协议

Electron Main 与 Go Sidecar 通过 stdin/stdout 传输一行一个 JSON 的消息。

请求：

```json
{
  "id": "req_1712000000000_1",
  "command": "staging.status",
  "payload": {}
}
```

响应：

```json
{
  "id": "req_1712000000000_1",
  "success": true,
  "data": []
}
```

通知：

```json
{
  "type": "notification",
  "event": "progress",
  "data": {
    "requestId": "req_1712000000000_1",
    "message": "Counting objects: 50%"
  }
}
```

已声明的 Git command 类型位于 `src/shared/types/gitCommands.ts`，Go 侧命令常量位于 `sidecar/internal/handler/commands.go`。新增跨进程命令时，需要同步更新两边。

## 当前 Sidecar 命令域

- `sidecar.*`：健康检查。
- `repo.*`：打开、初始化、克隆、HEAD、clean 状态。
- `staging.*`：状态、暂存、取消暂存、还原、patch/hunk 操作。
- `commit.*`：创建提交、日志、读取提交、reset、checkout commit。
- `branch.*`：本地/远程分支、当前分支、ahead/behind、创建、删除、切换。
- `remote.*`：远程列表、添加、设置 URL、移除、fetch、pull、push。
- `merge.*`：merge 状态、abort、continue、shadow merge、读取三方内容。
- `conflict.*`：写入冲突解决结果。
- `diff.*`：提交间 diff、提交 patch、文件内容、工作区/暂存区 diff。

## Renderer 分层约定

项目对前端分层比较严格，新增代码时优先沿用现有边界：

- `views/`：页面级业务视图，只组合 view model 和局部 UI。
- `layout/`：跨页面骨架、工具栏、侧栏、状态栏、全局面板。
- `components/`：低业务耦合的可复用 UI。
- `viewModels/`：组件订阅入口，负责从 store selectors 派生 UI 所需数据和动作。
- `store/`：Zustand 状态域，只保存状态和局部 mutation。
- `services/`：跨 store、跨 API 的业务流程，例如刷新、提交、远程同步、仓库切换。
- `api/`：对 `window.electronAPI` 的类型化封装。
- `utils/`：不依赖 React/Zustand 的纯函数。

正式 UI 不应直接 import store 并写 inline selector；应先补 selector，再补 view model，让组件消费 view model。

## 新增 Git 能力流程

新增一个 Sidecar-backed Git 能力时，通常需要改这些位置：

1. `sidecar/internal/handler/commands.go`：增加命令常量。
2. `sidecar/internal/handler/contract_*.go`：定义 payload/result DTO。
3. `sidecar/internal/handler/*_handlers.go`：实现 handler。
4. `sidecar/internal/handler/registry.go`：注册 handler。
5. `sidecar/internal/git/`：按需扩展 Repository facade 和 backend。
6. `src/shared/types/gitCommands.ts`：同步 TypeScript command map。
7. `src/renderer/src/api/gitClient.ts`：通过类型化客户端暴露。
8. `src/renderer/src/services/`：编排业务流程。
9. `src/renderer/src/viewModels/` 和 `views/` / `layout/`：接入 UI。
10. 按影响范围运行 `go test ./...`、`npm run typecheck`、`npm run lint` 或 `npm run build`。

## Tree-sitter WASM

Renderer 侧语义分析会从 public 或 assets 路径加载 Tree-sitter WASM：

- `tree-sitter-python.wasm`
- `tree-sitter-go.wasm`
- `tree-sitter-java.wasm`
- `tree-sitter-c.wasm`
- `tree-sitter-cpp.wasm`

根目录同时保留对应 `.tgz` 源包和 WASM 文件，`src/renderer/public/tree-sitter/` 中也有运行时资源副本。若更新语法支持，需要确认 WASM 文件能被 Vite/Electron 正常打包并在 Renderer 中通过 `fetch` 读取。

## 打包说明

`electron-builder.yml` 中通过 `extraResources` 把 `resources/intelligit-sidecar*` 放入应用资源目录。生产环境下 `SidecarManager` 会从 `process.resourcesPath` 查找二进制；开发环境下从项目根目录的 `resources/` 查找。

Windows 产物：

- 可执行文件名：`intelligit`
- NSIS 安装包：`${name}-${version}-setup.${ext}`

Linux 目标：

- AppImage
- snap
- deb

macOS 当前配置关闭 notarize。

## 故障排查

### 启动后 Sidecar 不可用

先确认当前平台二进制是否存在：

```bash
ls resources
```

然后尝试重建：

```bash
npm run build:sidecar
```

如果没有安装 Go，确认 `resources/intelligit-sidecar.exe` 或 `resources/intelligit-sidecar` 是否已经存在。

### AI 功能不可用

- 在全局设置中确认 API Key、Base URL、模型名是否已保存。
- 使用连接测试按钮检查 `/models` 端点是否可访问。
- OpenAI 兼容接口通常需要 Base URL 指向服务根地址，代码会自动规范化 `/v1`。
- DeepSeek、通义等兼容服务走 OpenAI Chat Completions 兼容路径。

### 自然语言助手没有执行

- 先选择或打开一个 Git 仓库。
- 确认 LLM 配置可用。
- 检查操作是否被风险策略拦截。
- 在 NLP 历史记录中查看解析计划、执行结果和 blocked 状态。

### Git 报 dubious ownership

如果本地 Git 因仓库所有者不一致拒绝操作，可以按 Git 提示添加 safe directory：

```bash
git config --global --add safe.directory E:/IntelliGit
```

这属于本机 Git 信任设置，不建议在项目脚本中自动修改。

## 推荐 IDE

- Visual Studio Code
- ESLint 插件
- Prettier 插件

## 相关文档

- `docs/project-rules.md`：项目结构和边界规则。
- `sidecar/README.md`：Go Sidecar 设计和扩展规则。
- `src/renderer/src/*/README.md`：Renderer 各目录职责说明。
- `docs/lxy/blog/`：阶段性重构、功能设计和问题修复记录。
