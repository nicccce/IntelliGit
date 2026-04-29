# Pull 凭据弹窗阻塞修复与 Merge 工作流预留 (2026-04-29)

## 1. 目标概述

本次工作的核心目标是修复 4-25 版本中 Pull 操作引入的两个严重问题，并为后续 merge 冲突解决功能预留完整的扩展接口。

**修复的问题**：
1. **架构违规**：Pull 改用系统 Git CLI (`exec.Command("git", "pull", ...)`) 调用，违背了"通过 go-git 完成所有操作"的设计路线。
2. **凭据弹窗阻塞**：仓库未鉴权、Token 失效、或私有仓库没有可用凭据时，Windows Git Credential Manager 弹出 "Connect to GitHub" 对话框。该弹窗阻塞了 `git pull` 进程，Sidecar 迟迟不返回，主进程 30 秒后在 `SidecarManager.ts` 报 `请求超时 (command=remote.pull)`。

**预留的能力**：
1. 结构化的 merge 冲突错误类型（`MergeConflictError`），方便前端展示冲突文件列表。
2. 完整的 merge 工作流 API：`merge.status`、`merge.abort`、`merge.continue`。

## 2. 问题根因分析

### 2.1 为什么 4-25 版本要改用 CLI？

因为 go-git 的 `Worktree.Pull()` **只支持 fast-forward 合并**。当本地和远程历史分叉（diverged）时，go-git 返回 `ErrNonFastForwardUpdate`，无法完成真正的 three-way merge。为了支持 merge 语义，4-25 版本将整个 Pull 操作替换为 `exec.Command("git", "pull", "--no-rebase", "--no-edit", ...)`。

### 2.2 CLI Pull 带来的问题

系统 Git CLI 的认证链路与 IntelliGit 的 app 管理的认证体系完全独立：

```
IntelliGit 认证流:  前端设置页 → Zustand → IPC → Sidecar → go-git resolveAuth()
系统 Git CLI 认证流: git pull → Git Credential Manager → 弹窗 / 系统凭据存储
```

当 CLI pull 无法从系统凭据存储中找到匹配的凭据时，Git Credential Manager (GCM) 会弹出交互式对话框。由于 Sidecar 是作为无头子进程 (`spawn`) 启动的，没有 GUI 上下文，这个弹窗实际上阻塞了整个进程：

```
前端点击 Pull → IPC → Sidecar handlePull() → exec.Command("git pull")
                                                    │
                                                    ▼
                                          GCM 弹出 "Connect to GitHub"
                                          （等待用户交互，但用户看不到弹窗）
                                                    │
                                                    ▼ 30 秒后
                                          SidecarManager: 请求超时
```

### 2.3 关键洞察

**`git merge` 是纯本地操作，完全不需要网络访问。** 凭据弹窗只会发生在 fetch/push 等需要网络通信的阶段。因此，只要将 Pull 拆解为"go-git fetch（使用 app auth）+ 本地 git merge"，就能同时解决认证问题和 merge 支持问题。

## 3. 设计方案：分层 Pull 策略

核心思路：**优先用 go-git 完成 fast-forward pull；仅在 non-fast-forward 场景下降级到本地 CLI merge。**

### 3.1 架构总览

```
Pull 请求 (带 auth 信息从前端设置页传入)
    │
    ▼
┌─────────────────────────────────────┐
│  第一层：go-git wt.Pull()           │  ← 纯 go-git, 使用 app 管理的 auth
│  (fast-forward only)                │     认证失败时立即返回友好错误
└───────┬─────────────────────────────┘
        │
        ├─ 成功 → 返回 OK
        ├─ ErrAlreadyUpToDate → 返回 OK
        │
        ▼ ErrNonFastForwardUpdate
┌─────────────────────────────────────┐
│  第二层：本地 git merge              │  ← 纯本地操作，不涉及网络
│  (go-git pull 内部已完成 fetch)      │     不可能触发 Credential Manager
│  + GIT_TERMINAL_PROMPT=0 兜底        │
└───────┬─────────────────────────────┘
        │
        ├─ 成功 → 返回 OK
        ├─ 冲突 → 返回 MergeConflictError（含冲突文件列表）
        │
        ▼ 其他错误
┌─────────────────────────────────────┐
│  返回明确的错误信息                   │
└─────────────────────────────────────┘
```

### 3.2 各操作的认证方式对比

| 操作 | 方式 | 认证来源 | 是否可能弹窗 |
|------|------|---------|:----------:|
| **Fetch** | go-git | app auth (设置页凭据) | ❌ |
| **Push** | go-git | app auth (设置页凭据) | ❌ |
| **Pull (ff)** | go-git `wt.Pull()` | app auth (设置页凭据) | ❌ |
| **Pull (merge)** | go-git fetch + CLI `git merge` | 无需认证 (本地操作) | ❌ |
| **旧版 Pull** | CLI `git pull` | 系统 GCM | ⚠️ **会弹窗** |

## 4. 详细实现步骤

### 4.1 新增 Merge 冲突相关类型

**文件**：`sidecar/internal/git/types.go`

为后续 merge 功能预留了三个核心类型：

- **`MergeConflictInfo`**：描述一次 merge 冲突的详细信息，包含冲突文件路径列表 (`conflictedFiles`)、merge 命令的原始输出 (`message`)、以及正在合并的分支引用名 (`mergingBranch`)。
- **`MergeConflictError`**：实现 `error` 接口的结构化错误类型。前端或 handler 层可通过 `errors.As(err, &conflictErr)` 提取冲突信息，而非依赖错误字符串的文本匹配。
- **`MergeStatusResult`**：merge 状态查询结果，包含是否正在 merge (`merging`)、冲突文件列表、以及 `MERGE_HEAD` 的 commit hash。

```go
type MergeConflictInfo struct {
    ConflictedFiles []string `json:"conflictedFiles"`
    Message         string   `json:"message"`
    MergingBranch   string   `json:"mergingBranch"`
}

type MergeConflictError struct {
    Info MergeConflictInfo
}

func (e *MergeConflictError) Error() string {
    return "合并冲突，请手动解决后提交: " + e.Info.Message
}

type MergeStatusResult struct {
    Merging         bool     `json:"merging"`
    ConflictedFiles []string `json:"conflictedFiles,omitempty"`
    MergeHead       string   `json:"mergeHead,omitempty"`
}
```

### 4.2 重写 Pull 方法为分层策略

**文件**：`sidecar/internal/git/remote.go`

将原来的单行 CLI 调用：
```go
// 旧实现 — 直接调用系统 git pull，会触发 GCM 弹窗
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
    branchRef, err := r.currentBranchReferenceName()
    if err != nil { return err }
    return r.runGitCommand(progress, "pull", "--no-rebase", "--no-edit", remoteName, branchRef.Short())
}
```

重写为分层策略：

```go
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
    branchRef, err := r.currentBranchReferenceName()
    if err != nil { return err }

    // ── 第一层：go-git Pull (fast-forward) ──
    wt, err := r.repo.Worktree()
    if err != nil { return fmt.Errorf("获取 worktree 失败: %w", err) }

    pullOpts := &gogit.PullOptions{
        RemoteName:    remoteName,
        ReferenceName: branchRef,
        Auth:          resolveAuth(auth),   // 使用 app 管理的凭据
        Progress:      progress,
    }

    err = wt.Pull(pullOpts)
    if err == nil || err == gogit.NoErrAlreadyUpToDate {
        return nil  // fast-forward 成功或已是最新
    }

    // 非 non-fast-forward 错误 → 包装为友好提示（认证失败等）
    if !errors.Is(err, gogit.ErrNonFastForwardUpdate) {
        return wrapAuthError(fmt.Errorf("pull 失败 (%s): %w", remoteName, err))
    }

    // ── 第二层：本地 git merge（pull 内部已 fetch，远程引用已更新） ──
    remoteRef := fmt.Sprintf("%s/%s", remoteName, branchRef.Short())
    return r.runLocalMerge(progress, remoteRef)
}
```

### 4.3 实现非交互式本地 Merge

**文件**：`sidecar/internal/git/remote.go`

`runLocalMerge()` 替代了原来的通用 `runGitCommand()`，专门用于本地 merge 操作，有三个关键改进：

1. **非交互环境变量**：通过 `nonInteractiveEnv()` 统一设置 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`GIT_MERGE_AUTOEDIT=no`，确保即便在极端情况下也不会挂起。
2. **结构化冲突返回**：检测到冲突时返回 `*MergeConflictError` 而非纯文本错误，携带通过 `parseConflictedFiles()` 解析出的冲突文件列表。
3. **冲突文件解析**：`parseConflictedFiles()` 从 `git merge` 的输出中解析 `CONFLICT (content): Merge conflict in path/to/file.go` 格式的行，提取文件路径。

```go
func (r *Repository) runLocalMerge(progress io.Writer, ref string) error {
    cmd := exec.Command("git", "-C", r.path, "merge", "--no-edit", ref)
    cmd.Env = nonInteractiveEnv()
    // ...
    if strings.Contains(message, "CONFLICT") || strings.Contains(message, "Automatic merge failed") {
        return &MergeConflictError{
            Info: MergeConflictInfo{
                ConflictedFiles: parseConflictedFiles(message),
                Message:         message,
                MergingBranch:   ref,
            },
        }
    }
}
```

### 4.4 认证错误友好化

**文件**：`sidecar/internal/git/remote.go`

新增 `wrapAuthError()` 函数，将 go-git 底层的认证错误包装为用户可操作的提示。同时为 `Fetch()` 也增加了相同的包装，确保无论是 fetch 还是 pull 的认证失败都能给出清晰提示。

```go
func wrapAuthError(err error) error {
    if errors.Is(err, transport.ErrAuthenticationRequired) ||
        errors.Is(err, transport.ErrAuthorizationFailed) {
        return fmt.Errorf("认证失败，请在设置页检查凭据配置: %w", err)
    }
    // 还通过字符串匹配兜底 "authentication", "401", "403" 等
    // ...
}
```

**改进前后对比**：
- **改进前**：认证失败 → GCM 弹窗 → 30 秒超时 → `请求超时 (command=remote.pull)`
- **改进后**：认证失败 → go-git 立即返回错误 → `认证失败，请在设置页检查凭据配置`

### 4.5 预留 Merge 工作流 API

**文件**：`sidecar/internal/git/remote.go`

为后续 merge 冲突解决 UI 预留了三个核心方法：

#### `MergeStatus()` — 检查 merge 中间状态
通过检测 `.git/MERGE_HEAD` 文件是否存在判断当前仓库是否处于 merge 未完成状态。如果存在，进一步通过 `git diff --name-only --diff-filter=U` 获取仍有冲突的文件列表。

```go
func (r *Repository) MergeStatus() (*MergeStatusResult, error) {
    mergeHeadPath := filepath.Join(r.path, ".git", "MERGE_HEAD")
    data, err := os.ReadFile(mergeHeadPath)
    if os.IsNotExist(err) { return &MergeStatusResult{}, nil }
    // 读取 MERGE_HEAD hash + 冲突文件列表
}
```

#### `MergeAbort()` — 放弃 merge
执行 `git merge --abort`，回退到 merge 之前的状态。前端可在用户不想解决冲突时调用。

#### `MergeContinue(message)` — 完成 merge 提交
在用户解决完冲突并 `staging.add` 后，执行 `git commit --no-edit`（或带自定义 message 的 `git commit -m`）完成 merge commit。

### 4.6 注册 Handler 与扩展 handlePull

**文件**：`sidecar/internal/handler/handlers.go` 和 `sidecar/internal/handler/registry.go`

1. **增强 `handlePull`**：检测 `MergeConflictError`，将冲突信息作为 response 的 `data` 字段返回。前端收到的响应结构为：
   ```json
   {
     "success": false,
     "data": {
       "conflictedFiles": ["path/to/file1.go", "path/to/file2.go"],
       "message": "CONFLICT (content): Merge conflict in ...",
       "mergingBranch": "origin/main"
     },
     "error": "合并冲突，请手动解决后提交: ..."
   }
   ```

2. **新增三个 handler**：`handleMergeStatus`、`handleMergeAbort`、`handleMergeContinue`。

3. **注册命令**：
   ```go
   r.Register("merge.status", handleMergeStatus)     // 检查是否处于 merge 中间状态
   r.Register("merge.abort", handleMergeAbort)       // 放弃当前 merge
   r.Register("merge.continue", handleMergeContinue) // 解决冲突后完成 merge 提交
   ```

### 4.7 修复前端 TypeScript 编译错误

**文件**：`src/renderer/src/store/useAppStore.ts`

修复 TS6133 编译错误：`detectAndSyncRemote` 函数的 `path` 参数声明后未使用，将其重命名为 `_path` 以表示有意不使用。

## 5. 后续开发指引：Merge 冲突解决 UI

为后续前端开发预留的完整冲突处理工作流：

```
用户点击 Pull
    │
    ▼ handlePull 返回
    ├─ success: true → 正常刷新（已有逻辑）
    │
    ▼ success: false, data 含 conflictedFiles
前端检测到冲突响应
    │
    ├─ 切换到「冲突解决」视图
    │    ├─ 显示冲突文件列表（从 response.data.conflictedFiles 获取）
    │    ├─ 可调用 merge.status 刷新最新冲突状态
    │    └─ 为每个冲突文件提供编辑/查看入口
    │
    ├─ 用户解决冲突后
    │    ├─ 调用 staging.add { path: "file.go" }  → 标记单个文件已解决
    │    ├─ 调用 merge.status                      → 检查剩余冲突
    │    └─ 所有冲突解决后
    │         └─ 调用 merge.continue { message?: "..." } → 完成 merge commit
    │
    └─ 用户放弃解决
         └─ 调用 merge.abort → 回退到 pull 之前的状态
```

**前端需要新增的 IPC 调用**（Sidecar 侧已全部就绪）：

| IPC 命令 | 参数 | 返回值 | 说明 |
|----------|------|--------|------|
| `merge.status` | 无 | `{ merging, conflictedFiles, mergeHead }` | 查询 merge 状态 |
| `merge.abort` | 无 | 无 | 放弃 merge |
| `merge.continue` | `{ message?: string }` | 无 | 完成 merge commit |

## 6. 涉及文件汇总

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `sidecar/internal/git/remote.go` | 修改 | 重写 Pull 为分层策略；新增 merge 工作流方法 |
| `sidecar/internal/git/types.go` | 修改 | 新增 MergeConflictError 等 merge 相关类型 |
| `sidecar/internal/handler/handlers.go` | 修改 | 增强 handlePull；新增 merge handler |
| `sidecar/internal/handler/registry.go` | 修改 | 注册 merge.status/abort/continue |
| `src/renderer/src/store/useAppStore.ts` | 修改 | 修复 TS6133 编译错误 |

## 7. 验证结果

- ✅ **Go 编译**：`go build ./cmd/sidecar` — 成功
- ✅ **Go 测试**：`go test ./internal/git/... -v` — 10/10 通过
  - `TestPullUsesCurrentBranchWithoutTrackingConfig` — 验证正常 pull 路径
  - `TestPullMergesDivergedCurrentBranch` — 验证 diverged history 下的 merge 降级路径
- ✅ **全量构建**：`npm run build:unpack` — 成功（含 TypeScript 类型检查、Vite 构建、Electron 打包）
