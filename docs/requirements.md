# IntelliGit — 详细功能需求文档

> **项目性质**：本科项目实训  
> **技术栈**：Electron (Node.js) + Go Sidecar (libgit2) + React/TypeScript  
> **文档版本**：v1.0  
> **最后更新**：2026-04-02

---

## 目录

- [1. 核心底座与架构模块 (Core Architecture)](#1-核心底座与架构模块-core-architecture)
- [2. 智能化代码管理模块 (Smart Code Management)](#2-智能化代码管理模块-smart-code-management)
- [3. 风险拦截与冲突管控模块 (Risk Management)](#3-风险拦截与冲突管控模块-risk-management)
- [4. 团队工程文化与知识库模块 (Local RAG)](#4-团队工程文化与知识库模块-local-rag)
- [5. 自动化质量验证模块 (Auto-Validation)](#5-自动化质量验证模块-auto-validation)
- [6. 可视化与自然语言交互模块 (UI/UX)](#6-可视化与自然语言交互模块-uiux)
- [7. 错误处理与日志系统 (Error Handling & Logging)](#7-错误处理与日志系统-error-handling--logging)
- [附录 A：术语表](#附录-a术语表)
- [附录 B：技术选型决策记录](#附录-b技术选型决策记录)

---

## 1. 核心底座与架构模块 (Core Architecture)

本模块定义 IntelliGit 的运行时基座，包括进程模型、进程间通信协议和 Git 操作引擎的混合路由策略。

### 1.1 微内核进程管理

#### 1.1.1 生命周期控制

Node.js 主进程（Electron Main Process）负责 Go Sidecar 进程的完整生命周期管理：

| 阶段 | 行为 | 说明 |
|------|------|------|
| **启动** | 应用启动时自动 Spawn Go Sidecar 子进程 | 按操作系统选择对应的 Sidecar 二进制文件 |
| **保活** | 心跳检测 + 自动重启 | 主进程定时发送 `ping` RPC，若超时无响应则判定 Sidecar 异常并自动重启 |
| **优雅退出** | 应用关闭时发送 `shutdown` 信号 | Sidecar 需在收到信号后完成资源清理（关闭打开的仓库句柄、释放内存索引），再退出进程 |
| **异常重启** | Sidecar 进程非预期退出时自动拉起 | 需设置最大重试次数（建议 3 次），超限后通知用户"引擎不可用" |

#### 1.1.2 全双工通信通道 (JSON-RPC over stdio)

主进程与 Go Sidecar 之间基于 **stdin/stdout** 建立 **JSON-RPC 2.0** 通信协议：

- **请求格式**：标准 JSON-RPC 2.0 Request，通过 Sidecar 的 stdin 写入
- **响应格式**：标准 JSON-RPC 2.0 Response，从 Sidecar 的 stdout 读取
- **消息分帧**：每条 JSON 消息以 `\n` 换行符分隔（NDJSON 格式）
- **错误透传**：Sidecar 内部错误需封装为 JSON-RPC Error 对象，包含 `code`、`message` 和可选的 `data` 字段
- **异步回调**：对于长时间运行的操作（如 clone 大仓库），支持 Sidecar 主动推送进度通知（JSON-RPC Notification）

```jsonc
// 请求示例
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "git/status",
  "params": { "repoPath": "/path/to/repo" }
}

// 响应示例
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "staged": ["src/main.ts"],
    "modified": ["src/utils.ts"],
    "untracked": ["temp.log"]
  }
}

// 进度通知示例（无 id 字段）
{
  "jsonrpc": "2.0",
  "method": "progress",
  "params": { "taskId": "clone-1", "percent": 45, "message": "Receiving objects..." }
}
```

### 1.2 混合 Git 驱动路由 (Hybrid Engine)

系统需自动判断 Git 操作的性质，将其路由至最佳执行引擎：

| 操作类型 | 路由目标 | 典型操作 | 路由理由 |
|---------|---------|---------|---------|
| **只读 / 内存级操作** | Go Sidecar (go-git) | `status`, `diff`, `log`, `blame`, 冲突预判, 分支列表 | 统一通过 Sidecar 读取仓库对象和索引，减少 Renderer/Main 进程对 Git 细节的感知 |
| **写入操作（本地）** | Go Sidecar (go-git) | `add`, `commit`, `branch create/delete`, `checkout`, `reset`, `stash` | go-git 在 Sidecar 内完成本地写入，并由统一错误模型返回给前端 |
| **网络与鉴权操作** | Go Sidecar (go-git + 显式鉴权) | `clone`, `push`, `pull`, `fetch`, `remote add/remove/set-url` | 远程操作统一走 go-git；HTTPS 使用用户名 + Token，SSH 使用密钥路径 + passphrase，避免依赖宿主机 Credential Manager 弹出交互式登录 |
| **复杂工作区操作** | Go Sidecar (go-git 优先) | `merge`, `rebase`, 冲突检测与解决辅助 | 复杂操作在 Sidecar 内显式建模；若 go-git 语义不足，需在需求和实现中单独定义兼容策略，而不是默认落回交互式 Git CLI |

**路由决策流程**：
1. Renderer 进程发起 Git 操作请求
2. Main 进程通过 IPC 将命令和参数转发给 Sidecar
3. Sidecar 通过 JSON-RPC 路由到对应的 go-git 操作封装
4. 远程操作由仓库配置生成鉴权参数：HTTPS 传入 `username` / `password(token)`，SSH 传入 `sshKeyPath` / `sshPassword`
5. Sidecar 返回结构化结果、错误和进度通知；默认不触发宿主机 Git CLI 或系统 Credential Manager 的交互式登录窗口

---

## 2. 智能化代码管理模块 (Smart Code Management)

本模块是 IntelliGit 区别于传统 Git 客户端的核心差异化特性，通过 AST 语义解析和大模型能力提供超越"行级操作"的智能化体验。

### 2.1 多语言 AST 语义解析

#### 2.1.1 解析引擎

采用 **Tree-sitter** 作为统一的增量解析引擎。Tree-sitter 支持增量解析（仅重新解析变更部分），适合与 Git diff 联动。

#### 2.1.2 优先支持的语言

以下语言为第一优先级，需在项目演示中完整展示：

| 优先级 | 语言 | 说明 |
|--------|------|------|
| P0 | **TypeScript / JavaScript** | 项目自身技术栈，展示说服力强 |
| P0 | **Python** | 学术界和工业界通用，老师最易理解 |
| P0 | **Go** | 项目 Sidecar 技术栈，自证能力 |
| P1 | **Java** | 本科教学常用语言 |
| P1 | **C / C++** | 系统编程课程常见 |
| P2 | **Rust** | 可选扩展 |

#### 2.1.3 增量语法树提取

系统需将 Git Diff 产生的代码差异块（Hunks）映射为 AST 节点：

1. 获取文件的 `before` 和 `after` 两个版本的源代码
2. 分别构建两棵语法树
3. 对 Diff Hunks 中涉及的行范围，提取对应的 AST 节点
4. 向上追溯至最近的**逻辑块边界**（函数定义、类定义、接口声明等）

#### 2.1.4 逻辑块感知

能够精准识别代码变更发生在哪个逻辑块内部，并提取完整上下文：

- **函数级**：识别变更所属的函数/方法签名、参数列表、返回类型
- **类级**：识别变更所属的类名、继承关系
- **模块级**：识别变更涉及的 import/export 变化
- **输出格式**：每个变更块需附带结构化元数据

```json
{
  "file": "src/services/auth.ts",
  "hunk_index": 0,
  "logical_block": {
    "type": "function",
    "name": "validateToken",
    "class": "AuthService",
    "start_line": 42,
    "end_line": 78
  },
  "change_summary": {
    "added_lines": 5,
    "removed_lines": 2,
    "modified_identifiers": ["tokenExpiry", "refreshThreshold"]
  }
}
```

### 2.2 语义化智能暂存 (Semantic Add)

#### 2.2.1 意图拆分

当用户在同一个文件中同时进行了不同意图的修改时，系统需自动归类：

**处理流程**：
1. 对文件执行 `git diff`，获取所有 Hunks
2. 对每个 Hunk 进行 AST 映射，提取逻辑块上下文
3. 将 Hunk 列表 + AST 上下文发送给大模型，请求意图分类
4. 大模型返回分组结果，每组代表一个独立的提交意图

**意图分类标签**（参考 Conventional Commits 类型）：
- `feat` — 新功能开发
- `fix` — 缺陷修复
- `refactor` — 代码重构（不改变行为）
- `style` — 代码格式调整（空格、换行等）
- `docs` — 文档变更
- `test` — 测试相关
- `chore` — 构建/工具链变更

#### 2.2.2 细粒度暂存控制

- 用户可在 UI 中看到按意图分组的变更列表
- 支持一键将某一"意图组"的所有 Hunks 送入暂存区
- 支持在意图组内部进一步选择/取消选择单个逻辑块
- 暂存操作的底层实现：通过 libgit2 的 `git_index_add_bypath` 或 patch-level staging 实现 Hunk 级别的细粒度暂存

### 2.3 上下文感知提交生成 (Context-Aware Commit)

#### 2.3.1 规范化生成

根据暂存区的 AST 差异，自动生成符合 **Conventional Commits** 规范的提交信息：

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**：自动推断（feat / fix / refactor / ...）
- **scope**：从 AST 中提取受影响的模块/类名
- **subject**：一行摘要（50 字符内）
- **body**：详细描述变更内容与动机
- **footer**：关联的 Issue 编号（若可检测到）

#### 2.3.2 深度意图解释（Why > What）

生成的 Commit Message 必须解释**为什么**做出这个改动，而非仅仅描述改了什么代码：

| ❌ 差的 Commit Message | ✅ 好的 Commit Message |
|-------------------------|------------------------|
| `修改了 validateToken 函数` | `fix(auth): 修复令牌过期后未自动刷新导致的 401 错误` |
| `添加了新的参数` | `feat(api): 新增 timeout 参数以支持慢速网络环境下的请求重试` |

**实现方式**：
1. 收集暂存区的 AST Diff 结构化数据
2. 通过 RAG 模块检索项目历史中相似变更的 Commit 记录（参见 §4）
3. 将 AST Diff + 历史范例 + 项目上下文组成 Prompt，调用云端大模型 API
4. 返回生成的 Commit Message，用户可编辑后确认

#### 2.3.3 大模型接入

- **接入方式**：云端 API 调用
- **支持的模型提供商**（用户可在设置中配置）：
  - OpenAI (GPT-4o / GPT-4o-mini)
  - Anthropic (Claude)
  - 其他兼容 OpenAI API 格式的服务（如 DeepSeek、Azure OpenAI）
- **配置项**：API Key、Base URL、Model Name、Temperature、Max Tokens
- **降级策略**：若 API 不可用，退化为基于模板的 Commit 生成（`<type>(<scope>): <自动摘要>`）

---

## 3. 风险拦截与冲突管控模块 (Risk Management)

本模块在用户执行高危 Git 操作前提供"预知未来"的能力，将冲突发现时机从"操作后"提前到"操作前"。

### 3.1 影子合并预检 (Shadow Merge Check)

这个没啥用，不做了

#### 3.1.1 内存级静默推演

在用户实际点击 Merge / Rebase 前，系统在后台利用 libgit2 的内存索引（In-memory Index）模拟合并：

**技术实现**：
1. 在 Go Sidecar 内部调用 `git_merge_trees()` 或 `git_merge_commits()`
2. 使用纯内存的 `git_index` 对象接收合并结果
3. 检查结果索引中的冲突条目（`git_index_has_conflicts()`）
4. 对于每个冲突条目，提取 ancestor/ours/theirs 三方的内容

#### 3.1.2 无损保证

> [!CAUTION]
> **核心约束**：影子合并过程**绝对不能**修改用户的物理工作区（Working Directory）、暂存区（Staging Area）或任何引用（Refs）。

- 所有操作在 libgit2 的内存空间中完成
- 不调用任何 `git_checkout` 系列 API
- 推演完成后立即释放内存索引

#### 3.1.3 UI 展示

推演完成后在 UI 上直观展示预检结果：

- **无冲突**：绿色状态标识 ✅，显示"可以安全合并"
- **存在冲突**：红色状态标识 ❌，列出冲突文件清单
  - 每个冲突文件可展开查看具体的冲突区域（行范围）
  - 冲突区域以三栏对比视图展示（ancestor / ours / theirs）
- **自动触发时机**：
  - 用户切换目标分支时自动触发
  - 用户打开 Merge/Rebase 对话框时自动触发
  - 远程分支更新（fetch 后）自动触发

### 3.2 逻辑碰撞检测 (Semantic Conflict Detection)

#### 3.2.1 语义冲突告警

即使 Git 层面没有物理冲突（文本可以成功合并），系统仍需通过 AST 分析识别**逻辑碰撞**：

| 碰撞类型 | 示例场景 | 检测方法 |
|---------|---------|---------|
| **调用-删除冲突** | 分支 A 新增了对 `foo()` 的调用，分支 B 删除了 `foo()` 的定义 | AST 符号引用交叉分析 |
| **签名变更冲突** | 分支 A 基于旧签名调用 `bar(x, y)`，分支 B 将签名改为 `bar(x, y, z)` | 函数签名 diff + 调用点扫描 |
| **语义覆盖冲突** | 分支 A 和 B 都修改了同一个函数的核心逻辑，但修改位于不同行 | AST 函数体 hash 比较 + 大模型辅助判断 |
| **类型不兼容冲突** | 分支 A 修改了接口定义，分支 B 的实现类未同步更新 | 接口-实现关系图分析 |

#### 3.2.2 告警分级

- **🔴 高风险**：合并后必定导致编译/运行时错误（如调用-删除冲突）
- **🟡 中风险**：合并后可能导致逻辑错误（如语义覆盖冲突）
- **🔵 低风险**：建议人工审查（如较大范围的并行修改）

### 3.3 AI 辅助修复引导

#### 3.3.1 修复策略生成

当发生冲突时，系统不仅展示冲突标记，还需利用大模型分析冲突双方的代码意图：

**处理流程**：
1. 提取冲突区域的 ours/theirs/ancestor 三方代码
2. 通过 AST 获取冲突区域的逻辑上下文（所在函数、类等）
3. 组装 Prompt：包含三方代码 + 上下文 + 项目历史中的类似冲突解决案例（来自 RAG）
4. 大模型返回：
   - **推荐合并策略**（如"保留 ours 并补充 theirs 的新增逻辑"）
   - **自动生成的合并代码**（用户可直接采纳或手动调整）
   - **解释说明**（为什么推荐此策略）

#### 3.3.2 用户交互

- 冲突编辑器中以"AI 建议"面板展示推荐策略
- 用户可一键应用建议，或手动编辑后确认
- 支持对 AI 建议进行追问（如"为什么不保留 theirs 的版本？"）

---

## 4. 团队工程文化与知识库模块 (Local RAG)

本模块通过本地向量化存储与检索增强生成（RAG），使 AI 产出内容贴合项目专有术语和团队规范。

### 4.1 本地向量化记忆池

#### 4.1.1 历史轨迹向量化

系统在初始化仓库时，自动提取并向量化以下项目历史数据：

| 数据源 | 提取内容 | 用途 |
|--------|---------|------|
| **Commit 历史** | Commit Message + 对应的 Diff 摘要 | 为 Commit 生成提供风格参考 |
| **代码演变** | 关键文件的版本变更轨迹 | 理解项目架构演进 |
| **README / 文档** | 项目说明、API 文档 | 理解业务术语和领域知识 |

#### 4.1.2 Embedding 模型

- **运行方式**：本地运行，不依赖网络
- **候选模型**（待最终选型）：
  - `all-MiniLM-L6-v2`（轻量，适合桌面端）
  - `nomic-embed-text`（精度较高）
  - `bge-small-zh-v1.5`（中文优化，若需中文场景）
- **选型标准**：模型大小 ≤ 100MB，推理速度可接受（< 50ms / 条文本）

#### 4.1.3 向量数据库

- **候选方案**（待最终选型）：

| 方案 | 优势 | 劣势 |
|------|------|------|
| **SQLite + sqlite-vss** | 单文件存储，零依赖，易于随项目仓库分发 | 向量查询性能一般 |
| **LanceDB** | 性能好，支持嵌入式运行，原生支持向量搜索 | 需要引入额外依赖 |
| **Chroma** | 功能丰富，API 友好 | 需要单独运行服务进程 |

- **推荐方案**：**LanceDB**（嵌入式运行，无需额外服务，性能良好）

#### 4.1.4 团队共享策略

为降低实现复杂度，采用以下策略实现团队间向量库的共享：

1. **向量库随仓库存储**：将向量数据库文件存放在项目根目录的 `.intelligit/vectors/` 目录下
2. **通过 Git 同步**：该目录纳入版本控制，团队成员通过 `pull` 获取最新的向量库
3. **增量更新**：每次 Commit 后，仅对新增的 Commit 数据进行增量向量化，追加到向量库中
4. **冲突处理**：向量库文件标记为二进制文件（在 `.gitattributes` 中配置），冲突时以最新版为准并触发全量重建

> [!NOTE]
> 此方案在小型团队（< 10 人）和中小型仓库（< 10000 commits）场景下可行。对于超大规模仓库，可考虑后续引入中心化的向量库服务。

### 4.2 离线检索增强 (RAG Pipeline)

所有 AI 驱动的功能（Commit 生成、冲突修复建议、NLP 命令解释）均通过 RAG 管线增强：

**RAG 流程**：
1. **Query 构建**：将用户请求或当前 Diff 上下文转化为检索 Query
2. **向量检索**：在本地向量库中执行 Top-K 相似度搜索（K=5）
3. **上下文拼装**：将检索结果与原始请求拼装为增强后的 Prompt
4. **大模型调用**：将增强 Prompt 发送给云端大模型 API
5. **结果返回**：将大模型响应展示给用户

---

## 5. 自动化质量验证模块 (Auto-Validation)

本模块为**可选高级特性**，需要用户本地已安装 Docker 环境。若 Docker 不可用，系统应优雅降级并提示用户。

### 5.1 动态测试沙箱 (Sandbox)

#### 5.1.1 前置条件检查

- 系统启动时检测用户环境中是否存在可用的 Docker 引擎
- 若不可用：在设置页面标记该功能为"不可用"，并提供 Docker 安装引导链接
- 若可用：在设置页面展示"沙箱测试"开关，默认**关闭**，用户手动开启

#### 5.1.2 提交前置拦截

当用户开启沙箱功能后，在执行关键操作（Commit / Push）前触发验证：

**执行流程**：
1. 用户点击 Commit / Push
2. 系统弹出"正在运行沙箱验证..."的进度提示
3. 通过 Docker Engine API（或 `docker` CLI）：
   - 基于用户配置的测试镜像创建容器
   - 将当前工作区代码挂载到容器内
   - 在容器内执行预定义的测试命令（如 `npm test`、`go test ./...`、`pytest`）
4. 收集测试输出与退出码
5. **测试通过**：继续执行 Commit / Push
6. **测试失败**：阻断操作，在 UI 中展示失败的测试用例及错误输出，用户可选择"强制提交"或"返回修复"

#### 5.1.3 沙箱配置

用户需在项目根目录创建 `.intelligit/sandbox.json` 配置文件：

```json
{
  "enabled": true,
  "image": "node:20-slim",
  "workdir": "/app",
  "install_command": "npm ci",
  "test_command": "npm test",
  "timeout_seconds": 120,
  "trigger_on": ["commit", "push"]
}
```

### 5.2 AI 差异化性能监测

#### 5.2.1 基准对比分析

- 结合外部性能采集工具（如 `hyperfine`、语言内置 benchmark 工具），获取代码变更前后的性能数据
- 对比维度：执行时间、CPU 消耗峰值、内存消耗峰值

#### 5.2.2 劣化定位

- 若检测到性能劣化（指标回归超过阈值），利用大模型分析代码差异
- 在代码视图中以内联标注（Inline Annotation）的形式标记可能导致性能问题的代码行
- 提供优化建议（如大 O 复杂度分析、循环优化建议等）

---

## 6. 可视化与自然语言交互模块 (UI/UX)

### 6.1 自然语言 Git 助手 (NLP Command)

#### 6.1.1 意图转译

提供全局命令输入框，将用户的口语化需求翻译为底层 Git 指令并执行：

| 用户输入 | 转译结果 |
|---------|---------|
| "把刚才的提交撤销，但我不想丢掉修改的代码" | `git reset --soft HEAD~1` |
| "我想看看最近三天谁改了这个文件" | `git log --since="3 days ago" -- <file>` |
| "创建一个新分支叫 feature-login 并切换过去" | `git checkout -b feature-login` |
| "把 dev 分支的内容合并过来" | `git merge dev` |
| "帮我把最新的代码推到远程" | `git push origin <current-branch>` |

**实现方式**：
1. 用户输入自然语言
2. 通过大模型 API 解析意图，输出结构化的 Git 指令
3. 在执行前向用户展示将要执行的具体命令，请求确认
4. 用户确认后执行，展示执行结果

#### 6.1.2 安全边界

> [!WARNING]
> 自然语言转译必须设置安全防线，防止误操作造成不可逆的数据损失。

可以加入回滚机制

**高危操作防护机制**：

| 危险等级 | 操作类型 | 防护措施 |
|---------|---------|---------|
| **🔴 极高危** | `git push --force`、`git reset --hard`、`git clean -fd` | 默认禁止执行；需用户在设置中显式解锁 + 二次确认弹窗 + 操作提示"此操作不可逆" |
| **🟡 高危** | `git reset`（非 soft）、`git rebase`、`git branch -D` | 二次确认弹窗，展示操作影响范围 |
| **🟢 安全** | `git status`、`git log`、`git diff`、`git branch -a` | 直接执行 |

**额外安全规则**：
- NLP 助手生成的命令若包含通配符（`*`）或递归操作，必须人工确认
- 所有通过 NLP 执行的操作记入审计日志（参见 §7）

### 6.2 动态分支拓扑图

#### 6.2.1 复杂历史可视化

实现 Git 历史记录的图形化渲染，展示多分支的派生、合并及演变轨迹：

- **渲染技术**：基于 Canvas 或 SVG 绘制（推荐使用 Canvas 以支持大量节点的流畅渲染）
- **布局算法**：分支拓扑排列需符合直觉，避免交叉线过多
- **交互能力**：
  - 缩放与平移
  - 点击节点查看 Commit 详情
  - 悬浮预览（Hover Preview）：显示 Commit Message、作者、时间
  - 搜索与过滤（按作者、日期范围、关键词）

#### 6.2.2 热力状态叠加

在拓扑图的分支节点上叠加显示风险状态信息：

- **影子合并预检结果**：
  - 🟢 绿色光晕：该分支与当前分支可安全合并
  - 🔴 红色光晕：该分支与当前分支存在物理冲突
  - 🟡 黄色光晕：该分支与当前分支存在逻辑碰撞风险
- **分支活跃度热力**：
  - 基于最近 Commit 频率和时间衰减，用颜色深浅表示分支活跃度
  - 长期未活动的分支以灰色/虚线展示

---

## 7. 错误处理与日志系统 (Error Handling & Logging)

### 7.1 统一错误分类体系

所有系统错误按以下类别分类：

| 错误码范围 | 类别 | 示例 |
|-----------|------|------|
| `1xxx` | **引擎错误** | Sidecar 进程崩溃、libgit2 操作失败 |
| `2xxx` | **Git 操作错误** | 合并冲突、推送拒绝、认证失败 |
| `3xxx` | **AI 服务错误** | API 调用失败、Token 超限、模型不可用 |
| `4xxx` | **沙箱错误** | Docker 不可用、容器启动失败、测试超时 |
| `5xxx` | **用户输入错误** | 无效的 NLP 指令、不存在的分支名 |
| `9xxx` | **未知错误** | 兜底分类 |

### 7.2 用户端错误展示

- **友好提示**：所有错误在 UI 上展示为人类可读的提示信息，而非原始错误栈
- **操作引导**：每个错误提示需附带"建议操作"（如"请检查网络连接"、"请确认 SSH Key 配置"）
- **详情展开**：用户可展开查看底层错误详情（用于反馈和调试）

### 7.3 日志收集

- **日志存储位置**：`~/.intelligit/logs/`
- **日志级别**：`DEBUG` / `INFO` / `WARN` / `ERROR`
- **日志轮转**：单个日志文件上限 10MB，保留最近 5 个文件
- **日志内容**：
  - 所有 JSON-RPC 通信记录（DEBUG 级别）
  - Git 操作执行记录（INFO 级别）
  - NLP 操作审计记录（INFO 级别）
  - 错误与异常记录（ERROR 级别）

---

## 附录 A：术语表

| 术语 | 含义 |
|------|------|
| **Sidecar** | 以子进程形式伴随主进程运行的辅助服务（此项目中为 Go 编写的 Git 引擎） |
| **libgit2** | Git 的纯 C 实现库，提供可嵌入应用程序的 Git 功能 API |
| **AST** | Abstract Syntax Tree，抽象语法树，代码经语法分析后生成的树形结构 |
| **Hunk** | Git Diff 中一个连续变更区域，包含上下文行和增删行 |
| **RAG** | Retrieval-Augmented Generation，检索增强生成，通过检索外部知识库增强大模型输出 |
| **Embedding** | 将文本转化为高维向量表示的过程，用于语义相似度搜索 |
| **Tree-sitter** | 一个增量解析框架，可为源代码生成语法树并在编辑时高效更新 |
| **影子合并** | 在内存中模拟合并操作以预测冲突，不修改实际文件系统 |
| **逻辑碰撞** | Git 物理层面无冲突，但代码语义层面存在矛盾的情况 |
| **Conventional Commits** | 一种标准化的 Commit Message 格式规范 |
| **JSON-RPC** | 基于 JSON 的远程过程调用协议 |
| **NDJSON** | Newline Delimited JSON，以换行符分隔的 JSON 流格式 |

---

## 附录 B：技术选型决策记录

| 决策项 | 选型 | 状态 | 备注 |
|--------|------|------|------|
| 桌面框架 | Electron | ✅ 已确定 | — |
| 前端框架 | React + TypeScript | ✅ 已确定 | — |
| 状态管理 | Zustand | ✅ 已确定 | — |
| Sidecar 语言 | Go | ✅ 已确定 | — |
| Git 内核 | libgit2 (git2go) | ✅ 已确定 | — |
| AST 解析器 | Tree-sitter | ✅ 已确定 | — |
| 大模型接入 | 云端 API (OpenAI / Anthropic / 兼容接口) | ✅ 已确定 | 用户自行配置 API Key |
| Embedding 模型 | 本地运行 (具体模型待定) | 🟡 待定 | 候选：all-MiniLM-L6-v2 / nomic-embed-text |
| 向量数据库 | 本地嵌入式 (具体方案待定) | 🟡 待定 | 候选：LanceDB / SQLite-vss |
| IPC 协议 | JSON-RPC 2.0 over stdin/stdout | ✅ 已确定 | — |
| Docker 沙箱 | 可选特性 | ✅ 已确定 | 依赖用户本地 Docker 环境 |
