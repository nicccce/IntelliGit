package handler

// RegisterAll 注册所有命令处理函数。
func RegisterAll(r *Router) {
	registerRepoHandlers(r)
	registerStagingHandlers(r)
	registerCommitHandlers(r)
	registerBranchHandlers(r)
	registerRemoteHandlers(r)
	registerMergeHandlers(r)
	registerDiffHandlers(r)
}
