# IntelliGit Go-Git API 完整说明

> 所有函数都在 `sidecar/internal/git/` 包中，测试统一运行方式：
> ```powershell
> cd e:\IntelliGit\sidecar
> go test -v -run "测试函数名" ./internal/git/
> ```

---

## 1️⃣ 数据类型 — [types.go](file:///e:/IntelliGit/sidecar/internal/git/types.go)

这个文件不包含函数，定义了所有操作返回的 DTO 结构体，都带 `json` tag，方便后续序列化传给前端。

| 类型 | 用途 | 关键字段 |
|------|------|----------|
| `CommitInfo` | 一条提交记录的摘要 | `Hash`, `ShortHash`, `Author`, `AuthorEmail`, `Date`, `Message`, `ParentHashes` |
| `FileStatus` | 单个文件的状态 | `Path`, `Staging`(暂存区状态), `Worktree`(工作区状态) |
| `StatusCode` | 状态码枚举 | `" "` 未修改, `"M"` 修改, `"A"` 新增, `"D"` 删除, `"?"` 未追踪 等 |
| `BranchInfo` | 一个分支的信息 | `Name`, `IsRemote`, `IsHead`(是否当前分支), `Hash` |
| `DiffEntry` | 两次提交间的文件变更 | `Action`(insert/delete/modify), `From`, `To` |
| `RemoteInfo` | 远程仓库信息 | `Name`, `FetchURL`, `PushURLs` |

---

## 2️⃣ 核心结构体与构造函数 — [repository.go](file:///e:/IntelliGit/sidecar/internal/git/repository.go)

### `Repository` 结构体

```go
type Repository struct {
    repo *gogit.Repository  // 底层 go-git 对象
    path string             // 仓库根目录路径
}
```

所有操作都是 `Repository` 的成员方法。后续可以在这个结构体上扩展缓存、配置等字段。

### 构造函数

| 函数 | 说明 | 用法 |
|------|------|------|
| `Open(path)` | **打开已有仓库** — 这就是你问的"指定目录获取仓库对象" | `repo, err := git.Open("E:/some/repo")` |
| `Init(path, bare)` | **初始化新仓库** — 相当于 `git init` | `repo, err := git.Init("/tmp/myrepo", false)` |
| `Clone(url, path, opts)` | **克隆远程仓库** — 支持浅克隆、指定分支 | `repo, err := git.Clone("https://...", "/tmp/clone", &git.CloneOptions{Depth: 1})` |

### 基础方法

| 方法 | 说明 | 返回 |
|------|------|------|
| `repo.Path()` | 获取仓库根目录路径 | `string` |
| `repo.GoGitRepo()` | 获取底层 go-git 原始对象（不够用时直接操作） | `*gogit.Repository` |
| `repo.Head()` | 获取当前 HEAD 的 hash 和分支名 | `hash, branch, err` |
| `repo.IsClean()` | 工作区是否干净（无未提交修改） | `bool, err` |

### 测试

```powershell
go test -v -run "TestInitAndOpen" ./internal/git/
```

测试流程：`Init` 创建临时仓库 → `Open` 重新打开 → 验证路径一致。

---

## 3️⃣ 暂存区操作 — [staging.go](file:///e:/IntelliGit/sidecar/internal/git/staging.go)

| 方法 | 对应 Git 命令 | 说明 |
|------|--------------|------|
| `repo.Status()` | `git status` | 返回 `[]FileStatus`，每个文件的暂存区/工作区状态 |
| `repo.Add(path)` | `git add <file>` | 将指定文件添加到暂存区 |
| `repo.AddAll()` | `git add -A` | 将所有变更添加到暂存区 |
| `repo.AddGlob(pattern)` | `git add *.go` | 通过 glob 模式批量添加 |
| `repo.Remove(path)` | `git rm <file>` | 从暂存区和工作区移除文件 |
| `repo.Restore(path)` | `git restore <file>` | 丢弃工作区修改，恢复到 HEAD 版本 |

### 测试

```powershell
go test -v -run "TestStatusAndAdd" ./internal/git/
```

测试流程：新建仓库 → 验证 `IsClean()=true` → 写入文件 → `Status()` 看到 untracked → `Add()` → `Status()` 确认暂存区显示 `A`。

---

## 4️⃣ 提交与日志 — [commit.go](file:///e:/IntelliGit/sidecar/internal/git/commit.go)

| 方法 | 对应 Git 命令 | 说明 |
|------|--------------|------|
| `repo.Commit(msg, name, email)` | `git commit -m "msg"` | 提交暂存区内容，返回 commit hash |
| `repo.Log(max)` | `git log -n max` | 获取最近 N 条提交记录，返回 `[]CommitInfo` |
| `repo.LogFrom(hash, max)` | `git log hash -n max` | 从指定 commit 开始获取日志 |
| `repo.GetCommit(hash)` | — | 通过 hash 获取单个 commit 详情 |

### 测试

```powershell
go test -v -run "TestCommitAndLog" ./internal/git/
```

测试流程：两次 commit → `Log(10)` 验证返回 2 条且时间倒序 → `GetCommit(hash)` 验证提交信息匹配。

---

## 5️⃣ 分支操作 — [branch.go](file:///e:/IntelliGit/sidecar/internal/git/branch.go)

| 方法 | 对应 Git 命令 | 说明 |
|------|--------------|------|
| `repo.Branches()` | `git branch` | 列出所有本地分支，返回 `[]BranchInfo` |
| `repo.RemoteBranches()` | `git branch -r` | 列出所有远程追踪分支 |
| `repo.CurrentBranch()` | — | 返回当前分支名（detached HEAD 会报错） |
| `repo.CreateBranch(name)` | `git branch <name>` | 在当前 HEAD 上创建新分支 |
| `repo.DeleteBranch(name)` | `git branch -d <name>` | 删除本地分支（不能删当前分支） |
| `repo.Checkout(branch)` | `git checkout <branch>` | 切换到已有分支 |
| `repo.CheckoutNewBranch(branch)` | `git checkout -b <branch>` | 创建并切换到新分支 |

### 测试

```powershell
go test -v -run "TestBranch" ./internal/git/
```

测试流程：commit 一次（否则没有 HEAD）→ `CurrentBranch()` → `CreateBranch("dev")` → `Branches()` 验证 2 个 → `Checkout("dev")` → 确认切换成功 → 切回 → `DeleteBranch("dev")` → `CheckoutNewBranch("feature-x")` 一步到位。

---

## 6️⃣ Diff 与文件查看 — [diff.go](file:///e:/IntelliGit/sidecar/internal/git/diff.go)

| 方法 | 说明 | 返回 |
|------|------|------|
| `repo.DiffCommits(hashA, hashB)` | 对比两个 commit 之间的文件变更 | `[]DiffEntry` |
| `repo.DiffWithParent(hash)` | 对比某个 commit 与其父 commit（初始提交会列出所有新增文件） | `[]DiffEntry` |
| `repo.FileContentAtCommit(hash, path)` | 读取指定 commit 中某个文件的完整内容 | `string` |
| `repo.ListFilesAtCommit(hash)` | 列出指定 commit 中的所有文件路径 | `[]string` |

> `DiffEntry.Action` 的值：`"insert"`(新增), `"delete"`(删除), `"modify"`(修改)

### 测试

```powershell
# Diff 测试
go test -v -run "TestDiff" ./internal/git/

# 文件读取测试
go test -v -run "TestFileContent" ./internal/git/
```

**TestDiff 流程**：commit "a.txt" → 修改 a.txt + 新增 b.txt 再 commit → `DiffCommits` 验证 2 个变更 → `DiffWithParent` 验证与前者一致 → 初始 commit 的 `DiffWithParent` 验证全是 insert。

**TestFileContent 流程**：commit 一个文件 → `FileContentAtCommit` 读回来验证内容一致 → `ListFilesAtCommit` 验证文件列表。

---

## 7️⃣ 远程仓库操作 — [remote.go](file:///e:/IntelliGit/sidecar/internal/git/remote.go)

| 方法 | 对应 Git 命令 | 说明 |
|------|--------------|------|
| `repo.Remotes()` | `git remote -v` | 列出所有远程仓库 |
| `repo.AddRemote(name, url)` | `git remote add` | 添加远程仓库 |
| `repo.RemoveRemote(name)` | `git remote remove` | 删除远程仓库 |
| `repo.Fetch(remote, auth)` | `git fetch` | 拉取远程引用 |
| `repo.Pull(remote, auth)` | `git pull` | 拉取并合并 |
| `repo.Push(remote, auth)` | `git push` | 推送到远程 |

### 认证方式 (`AuthMethod`)

```go
// HTTPS 认证（Token 方式）
auth := &git.AuthMethod{
    Username: "your-username",
    Password: "ghp_xxxxxxxxxxxx", // GitHub Personal Access Token
}

// SSH 认证
auth := &git.AuthMethod{
    SSHKeyPath:  "~/.ssh/id_rsa",
    SSHPassword: "passphrase",    // 没密码则留空
}

// 无需认证（公开仓库）
repo.Fetch("origin", nil)
```

### 测试

```powershell
go test -v -run "TestRemotes" ./internal/git/
```

测试流程：验证初始无 remote → `AddRemote("origin", url)` → `Remotes()` 验证 1 个 → `RemoveRemote` → 验证回到 0 个。

> [!NOTE]
> Fetch/Pull/Push 没有在自动测试中跑（需要真实远程仓库和网络），但 API 已经封装好了。

---

## 8️⃣ 打开 IntelliGit 项目本身

```powershell
go test -v -run "TestOpenExistingProject" ./internal/git/
```

这个测试会打开你当前 IntelliGit 项目的 `.git` 仓库，然后：
- 打印 HEAD hash 和当前分支名
- 显示最近 5 条提交的简短 hash、作者、提交信息
- 列出所有本地分支

---

## 一键跑全部测试

```powershell
cd e:\IntelliGit\sidecar
go test -v -count=1 ./internal/git/
```

全部 8 个测试函数都会执行，约 1-2 秒完成。
