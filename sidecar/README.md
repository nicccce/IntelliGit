# Sidecar - Go 后端

## 概述

Sidecar 负责 IntelliGit 的底层 Git 操作，通过 stdin/stdout JSON 协议与 Electron Main 进程通信。

Git 能力采用混合实现：

- `go-git`：对象模型、状态、提交、分支、远程 fetch/push、结构化 diff 等常规能力。
- Git CLI：hunk/patch 暂存、raw diff、merge 工作流、需要 Git 原生命令语义的历史查询。

`internal/git.Repository` 是 handler 层唯一依赖的稳定 facade。handler 不应该直接关心某个能力走 `go-git` 还是 Git CLI。

## 通信协议

请求格式（stdin，每行一个 JSON）：

```json
{
  "id": "req_1712000000000_1",
  "command": "staging.status",
  "payload": {}
}
```

响应格式（stdout，每行一个 JSON）：

```json
{
  "id": "req_1712000000000_1",
  "success": true,
  "data": []
}
```

通知格式（stdout，每行一个 JSON）：

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

## 目录结构

```text
sidecar/
├── cmd/sidecar/              # 入口，启动 stdin/stdout 循环
├── internal/
│   ├── protocol/             # JSON 协议结构与 codec
│   ├── handler/              # command 路由、payload/result contract、业务域 handler
│   └── git/                  # Repository facade、go-git backend、Git CLI backend
├── go.mod
└── go.sum
```

## Handler 边界

`internal/handler` 按业务域拆分：

```text
commands.go                  # command 常量
contract_*.go                # payload/result DTO
*_handlers.go                # 按业务域实现 handler
registry.go                  # RegisterAll 总入口
router.go                    # command 分发
context.go                   # payload bind、当前 repo 注入
notifier.go                  # progress/event 通知
validation.go                # 通用参数校验
```

新增 Sidecar 命令时必须：

1. 在 `commands.go` 增加 command 常量。
2. 在对应 `contract_*.go` 增加命名 payload/result。
3. 在对应 `*_handlers.go` 实现 handler。
4. 在对应 `register*Handlers` 中注册。
5. 同步更新前端 `src/shared/types/gitCommands.ts`。
6. 运行 `go test ./...`，跨协议变更还要运行项目根目录的 `npm.cmd run build`。

`sidecar.ping` 是不依赖当前仓库的运行时健康检查命令，用于让桌面端确认 Go Sidecar 进程和 stdin/stdout 协议仍可响应。

## Git 实现策略

`internal/git.Repository` 对 handler 暴露稳定 API，内部只负责编排：

```text
Repository
  -> goGitBackend
  -> gitCliBackend
```

能力分工：

```text
goGitBackend
  - open/init/clone
  - status/add/remove/restore
  - commit/log/branch
  - remote fetch/push
  - structured diff

gitCliBackend
  - apply/unstage/discard patch
  - raw diff
  - merge/abort/continue
  - conflict file discovery
  - log --topo-order raw output
```

所有系统 Git CLI 调用必须经过 `cli_runner.go`，以统一：

- `GIT_TERMINAL_PROMPT=0`
- `GCM_INTERACTIVE=never`
- `GIT_MERGE_AUTOEDIT=no`
- stdout/stderr 捕获
- progress writer 转发
- 错误包装

生产代码不要暴露底层 `go-git.Repository`。如果测试确实需要直接操作底层对象，只能在 `_test.go` helper 中提供。

## 构建与验证

```bash
cd sidecar
go test ./...
go build -o ../resources/intelligit-sidecar ./cmd/sidecar
```

项目根目录跨进程验证：

```bash
npm.cmd run build
```
