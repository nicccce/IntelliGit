# internal/git

此包是 Sidecar 的 Git 能力边界。外部调用方只依赖 `Repository`，不要直接依赖 `goGitBackend`、`gitCliBackend` 或系统 `git` 命令。

## 分层

```text
Repository      # 对 handler 暴露稳定 API，并编排混合策略
goGitBackend    # go-git adapter
gitCliBackend   # Git CLI adapter
gitCliRunner    # 唯一允许 exec.Command("git", ...) 的位置
```

## 规则

- 常规对象模型、状态、提交、分支、结构化 diff 优先放在 `goGitBackend`。
- hunk/patch、raw diff、merge、特殊 log 等需要 Git 原生命令语义的能力放在 `gitCliBackend`。
- 新增 CLI 能力必须复用 `gitCliRunner.run`，不要在业务文件里直接 `exec.Command`。
- 需要 go-git + CLI 串联的流程放在 `Repository`，例如 pull 的 fast-forward 与本地 merge fallback。
- 生产代码不要新增 `GoGitRepo()` 这类底层逃逸口。
