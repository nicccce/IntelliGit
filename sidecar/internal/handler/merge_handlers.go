package handler

func registerMergeHandlers(r *Router) {
	r.Register(CommandMergeStatus, handleMergeStatus)
	r.Register(CommandMergeAbort, handleMergeAbort)
	r.Register(CommandMergeContinue, handleMergeContinue)
}

func handleMergeStatus(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.MergeStatus()
}

func handleMergeAbort(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return nil, repo.MergeAbort()
}

func handleMergeContinue(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[mergeContinuePayload](ctx)
	if err != nil {
		return nil, err
	}
	return nil, repo.MergeContinue(payload.Message)
}
