package handler

// ┌──────────────────────────────────────────────────────────────────────────────┐
// │                          接口注册中心                                        │
// │                                                                              │
// │  这里是 Sidecar 所有对外暴露的命令列表。                                      │
// │  命令名称使用 "模块.方法" 的格式，如 "repo.open"、"staging.status"。          │
// │                                                                              │
// │  ╔═══════════════════════════════════════════════════════════════════════╗    │
// │  ║                     如何新增一个接口                                  ║    │
// │  ╠═══════════════════════════════════════════════════════════════════════╣    │
// │  ║                                                                     ║    │
// │  ║  1. 在 handlers.go 中编写 handler 函数:                              ║    │
// │  ║                                                                     ║    │
// │  ║     func handleMyFeature(ctx *Context) (any, error) {               ║    │
// │  ║         var params struct {                                          ║    │
// │  ║             Foo string `json:"foo"`                                  ║    │
// │  ║         }                                                           ║    │
// │  ║         if err := ctx.Bind(&params); err != nil {                    ║    │
// │  ║             return nil, err                                          ║    │
// │  ║         }                                                           ║    │
// │  ║         repo, err := ctx.Repo()                                     ║    │
// │  ║         if err != nil {                                              ║    │
// │  ║             return nil, err                                          ║    │
// │  ║         }                                                           ║    │
// │  ║         return repo.MyFeature(params.Foo)                            ║    │
// │  ║     }                                                               ║    │
// │  ║                                                                     ║    │
// │  ║  2. 在本文件（registry.go）中注册命令映射:                            ║    │
// │  ║                                                                     ║    │
// │  ║     r.Register("myModule.myFeature", handleMyFeature)               ║    │
// │  ║                                                                     ║    │
// │  ║  3.（可选）到 Node 端 shared/types/sidecar.ts 中添加 TS 类型定义    ║    │
// │  ║                                                                     ║    │
// │  ║  就这样，新接口自动对接 stdin/stdout 协议，Node 侧通过               ║    │
// │  ║  sidecarManager.send("myModule.myFeature", { foo: "bar" })          ║    │
// │  ║  即可调用。                                                          ║    │
// │  ╚═══════════════════════════════════════════════════════════════════════╝    │
// └──────────────────────────────────────────────────────────────────────────────┘

// RegisterAll 注册所有命令处理函数。
func RegisterAll(r *Router) {

	// ── 仓库管理 ────────────────────────────────────────────────────────────
	r.Register("repo.open", handleRepoOpen)       // 打开已有仓库
	r.Register("repo.init", handleRepoInit)       // 初始化新仓库
	r.Register("repo.clone", handleClone)         // 克隆远程仓库（支持进度推送）
	r.Register("repo.head", handleHead)           // 获取 HEAD 信息
	r.Register("repo.isClean", handleIsClean)     // 检查工作区是否干净

	// ── 暂存区 ──────────────────────────────────────────────────────────────
	r.Register("staging.status", handleStatus)     // 获取文件状态
	r.Register("staging.add", handleAdd)           // 添加文件到暂存区
	r.Register("staging.addAll", handleAddAll)     // 添加所有文件
	r.Register("staging.remove", handleRemove)     // 从暂存区移除
	r.Register("staging.restore", handleRestore)   // 恢复文件到 HEAD 版本

	// ── 提交 ────────────────────────────────────────────────────────────────
	r.Register("commit.create", handleCommit)      // 创建提交
	r.Register("commit.log", handleLog)            // 获取提交历史
	r.Register("commit.get", handleGetCommit)      // 获取单条提交详情

	// ── 分支 ────────────────────────────────────────────────────────────────
	r.Register("branch.list", handleBranches)             // 列出本地分支
	r.Register("branch.listRemote", handleRemoteBranches) // 列出远程分支
	r.Register("branch.current", handleCurrentBranch)     // 获取当前分支
	r.Register("branch.create", handleCreateBranch)       // 创建分支
	r.Register("branch.delete", handleDeleteBranch)       // 删除分支
	r.Register("branch.checkout", handleCheckout)         // 切换分支
	r.Register("branch.checkoutNew", handleCheckoutNew)   // 创建并切换分支

	// ── 远程操作（均支持进度推送） ──────────────────────────────────────────
	r.Register("remote.list", handleRemotes)         // 列出远程仓库
	r.Register("remote.add", handleAddRemote)        // 添加远程仓库
	r.Register("remote.remove", handleRemoveRemote)  // 删除远程仓库
	r.Register("remote.fetch", handleFetch)          // Fetch（带进度）
	r.Register("remote.pull", handlePull)            // Pull（带进度）
	r.Register("remote.push", handlePush)            // Push（带进度）

	// ── Diff ────────────────────────────────────────────────────────────────
	r.Register("diff.commits", handleDiffCommits)             // 两个 commit 之间的差异
	r.Register("diff.withParent", handleDiffWithParent)       // commit 与父 commit 的差异
	r.Register("diff.commitPatch", handleGetCommitPatch)      // 获取完整的 patch 详情
	r.Register("diff.fileContent", handleFileContentAtCommit) // 读取某 commit 中的文件内容
	r.Register("diff.listFiles", handleListFilesAtCommit)     // 列出某 commit 中的所有文件
}
