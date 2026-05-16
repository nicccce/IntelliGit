# IntelliGit 问题 8、9 整改记录：Sidecar Handler 与 Git Backend 边界重构

本文记录 `walkthrough-2026-5-15.md` 中问题 8、问题 9 的整改设计和实际落地结果。

整改状态：

```text
已完成
```

完成日期：

```text
2026-05-16
```

本次整改范围集中在 Go Sidecar 后端：

```text
sidecar/internal/handler/
sidecar/internal/git/
sidecar/README.md
```

整改目标不是简单把大文件切开，而是建立清楚的后端业务边界：

```text
handler
  -> 只处理 IPC command、payload/result contract、参数校验、调用 Repository

Repository
  -> 对 handler 暴露稳定 Git API
  -> 编排 go-git 与 Git CLI 的混合策略

goGitBackend
  -> 负责 go-git 能稳定覆盖的 Git 能力

gitCliBackend
  -> 负责必须依赖系统 Git CLI 的能力

gitCliRunner
  -> 唯一允许直接 exec git 的位置
```

---

## 0. 完成内容总览

本次实际完成的重构范围：

```text
拆分 handler 大文件
建立 command 常量
建立 payload/result contract 文件
按业务域拆分 handler
新增 handler 注册完整性测试
将 Repository 改为稳定 facade
引入 goGitBackend
引入 gitCliBackend
集中 Git CLI runner
集中认证错误处理
集中 merge conflict 解析
移除生产代码中的底层 go-git 逃逸口
补充 Sidecar / handler / git README
```

验证结果：

```text
cd sidecar && go test ./...
npm.cmd run build
```

均已通过。

---

## 1. 问题 8：Go handler 层是后端版“大文件”

原问题：

```text
sidecar/internal/handler/handlers.go
```

原 `handlers.go` 同时承载 repo、staging、commit、branch、remote、merge、diff 等所有命令实现，文件超过 800 行。

该文件的问题不只是行数过长，还包括：

```text
匿名 payload struct 到处散落
返回结构用临时 map 拼装
命令名直接写字符串
参数校验重复
repo 获取、payload bind、progress writer 组装混在业务函数里
registry 虽然集中，但具体实现没有业务域边界
```

### 整改后结构

删除：

```text
sidecar/internal/handler/handlers.go
```

新增和调整：

```text
sidecar/internal/handler/
  commands.go
  context.go
  notifier.go
  router.go
  registry.go
  validation.go
  repo_handlers.go
  staging_handlers.go
  commit_handlers.go
  branch_handlers.go
  remote_handlers.go
  merge_handlers.go
  diff_handlers.go
  contract_repo.go
  contract_staging.go
  contract_commit.go
  contract_branch.go
  contract_remote.go
  contract_merge.go
  contract_diff.go
  registry_test.go
  README.md
```

新的职责边界：

```text
commands.go
  -> 所有 Sidecar command 常量

contract_*.go
  -> 各业务域 payload / result DTO

*_handlers.go
  -> 各业务域 handler 实现

registry.go
  -> RegisterAll 总入口，只组合各业务域注册函数

context.go
  -> payload bind、当前 repo 注入

notifier.go
  -> progress / event 通知

validation.go
  -> 通用参数校验
```

`registry.go` 现在只保留总装配：

```go
func RegisterAll(r *Router) {
	registerRepoHandlers(r)
	registerStagingHandlers(r)
	registerCommitHandlers(r)
	registerBranchHandlers(r)
	registerRemoteHandlers(r)
	registerMergeHandlers(r)
	registerDiffHandlers(r)
}
```

这样新增命令时不再进入一个超大文件，而是按业务域落点：

```text
新增命令常量
新增 payload/result contract
实现对应 handler
注册到对应 register*Handlers
同步前端 Git command map
补注册测试
```

### 新增测试

新增：

```text
sidecar/internal/handler/registry_test.go
```

用于确保 `RegisterAll` 注册了所有已知 command，防止后续新增 command 常量后忘记注册。

---

## 2. 问题 9：Git 实现策略混杂

原问题涉及：

```text
sidecar/internal/git/remote.go
sidecar/internal/git/staging_hunk.go
sidecar/internal/git/operations.go
```

原结构中 `Repository` 同时承担：

```text
对 handler 暴露 API
直接操作 go-git
直接 exec 系统 git
处理 CLI 环境变量
解析 CLI 输出
包装认证错误
解析 merge conflict
实现 pull 的混合策略
```

导致后续排查 Git 行为时，很难判断某个功能到底走 go-git 还是系统 Git CLI。

### 整改后结构

新增和调整：

```text
sidecar/internal/git/
  repository.go
  gogit_backend.go
  cli_backend.go
  cli_runner.go
  auth.go
  conflicts.go
  merge.go
  history_cli.go
  README.md
```

`Repository` 现在是稳定 facade：

```go
type Repository struct {
	path  string
	goGit *goGitBackend
	cli   *gitCliBackend
}
```

handler 层仍然调用稳定方法：

```text
repo.Status()
repo.Commit()
repo.Pull()
repo.ApplyPatch()
repo.MergeStatus()
repo.DiffWorkdirRaw()
```

但具体实现策略收敛到 Repository 内部。

### goGitBackend

`goGitBackend` 负责 go-git 能稳定覆盖的能力：

```text
Head / IsClean
Status / Add / Remove / Restore
Commit / Log / GetCommit
Branch list / create / delete / checkout
Remote list / add / set-url / remove
Fetch / Push
Structured diff
Reset / CheckoutCommit / LogAll
```

原来的 `branch.go`、`commit.go`、`diff.go`、`operations.go`、`staging.go` 等文件不再直接挂在 `Repository` 上，而是挂在 `goGitBackend` 上。

### gitCliBackend

`gitCliBackend` 负责必须依赖系统 Git CLI 的能力：

```text
ApplyPatch
UnstageHunk
DiscardHunk
DiffWorkdirRaw
DiffStagedRaw
MergeStatus
MergeAbort
MergeContinue
RunLocalMerge
LogAllRaw
```

这些能力要么依赖 Git 原生命令语义，要么是 go-git 当前不适合承接的场景。

### gitCliRunner

所有系统 Git CLI 调用集中到：

```text
sidecar/internal/git/cli_runner.go
```

统一处理：

```text
exec.Command
cmd.Dir
stdin
stdout / stderr 捕获
progress writer 转发
错误包装
非交互式 Git 环境变量
```

统一设置：

```text
GIT_MERGE_AUTOEDIT=no
GIT_TERMINAL_PROMPT=0
GCM_INTERACTIVE=never
```

整改后生产代码里只有 `cli_runner.go` 允许直接 `exec.Command`。

### Pull 混合策略

`Pull` 仍然保留原来的混合策略，但边界更清楚：

```text
Repository.Pull
  -> goGitBackend.PullFastForward
  -> 如果遇到 non-fast-forward
  -> gitCliBackend.RunLocalMerge
```

也就是说，混合策略只出现在 `Repository` facade 中，不再散落在具体 backend 实现里。

### 底层 go-git 逃逸口

生产代码中的：

```go
GoGitRepo()
```

已经移除。

测试中如果确实需要直接操作底层 go-git 对象，只通过 `_test.go` helper 提供：

```text
sidecar/internal/git/repository_test_helpers_test.go
```

这避免生产代码绕过 `Repository` facade 直接依赖底层实现。

---

## 3. 新增测试

本次新增测试：

```text
sidecar/internal/handler/registry_test.go
sidecar/internal/git/cli_runner_test.go
sidecar/internal/git/conflicts_test.go
```

覆盖点：

```text
所有 command 必须被 RegisterAll 注册
Git CLI runner 必须设置非交互式环境变量
merge conflict 输出解析保持稳定
```

这些测试的目标不是覆盖所有 Git 行为，而是守住本次重构建立起来的结构边界。

---

## 4. 文档更新

更新：

```text
sidecar/README.md
```

修正了旧文档中不准确的 `libgit2 + CLI` 表述，改为当前真实结构：

```text
go-git + Git CLI
```

新增：

```text
sidecar/internal/handler/README.md
sidecar/internal/git/README.md
```

分别记录 handler 和 git 包的职责边界、新增命令流程、CLI runner 使用规则。

---

## 5. 整改后的维护规则

后续新增 Sidecar 命令时，必须遵守：

```text
1. 在 sidecar/internal/handler/commands.go 增加 command 常量
2. 在对应 contract_*.go 定义 payload/result
3. 在对应 *_handlers.go 实现 handler
4. 在 register*Handlers 中注册
5. 更新 registry_test.go
6. 同步更新 src/shared/types/gitCommands.ts
7. 运行 go test ./...
8. 跨协议变更运行 npm.cmd run build
```

后续新增 Git CLI 能力时，必须遵守：

```text
1. 不直接在业务文件中 exec.Command
2. 统一通过 gitCliRunner.run
3. 能力落在 gitCliBackend
4. 如果涉及 go-git + CLI 编排，编排逻辑放在 Repository
5. 补充对应边界测试
```

---

## 6. 验证记录

基线测试：

```text
cd sidecar && go test ./...
```

整改后测试：

```text
cd sidecar && go test ./...
```

结果：

```text
通过
```

项目构建：

```text
npm.cmd run build
```

结果：

```text
通过
```

构建内容包含：

```text
build:sidecar
typecheck:node
typecheck:web
electron-vite build
```

---

## 7. 后续注意

本次重构重点解决的是问题 8 和问题 9。

它没有改变前端协议命令名，也没有新增 Sidecar command，因此本次没有调整：

```text
src/shared/types/gitCommands.ts
src/renderer/src/api/gitClient.ts
```

后续如果继续处理问题 6、问题 7，需要进一步考虑：

```text
前后端 Git command map 的自动同步或代码生成
Sidecar 多仓库 repo session / 显式 repoPath
handler contract 与 TypeScript 类型之间的长期一致性机制
```
