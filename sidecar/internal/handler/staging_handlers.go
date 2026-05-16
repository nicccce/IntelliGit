package handler

func registerStagingHandlers(r *Router) {
	r.Register(CommandStagingStatus, handleStatus)
	r.Register(CommandStagingAdd, handleAdd)
	r.Register(CommandStagingAddAll, handleAddAll)
	r.Register(CommandStagingRemove, handleRemove)
	r.Register(CommandStagingRestore, handleRestore)
	r.Register(CommandStagingApplyPatch, handleApplyPatch)
	r.Register(CommandStagingUnstageHunk, handleUnstageHunk)
}

func handleStatus(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Status()
}

func handleAdd(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stagingPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}
	return nil, repo.Add(payload.Path)
}

func handleAddAll(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return nil, repo.AddAll()
}

func handleRemove(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stagingPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}
	return nil, repo.Remove(payload.Path)
}

func handleRestore(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stagingPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}
	return nil, repo.Restore(payload.Path)
}

func handleApplyPatch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stagingPatchPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("patch", payload.Patch); err != nil {
		return nil, err
	}
	return nil, repo.ApplyPatch(payload.Patch)
}

func handleUnstageHunk(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stagingPatchPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("patch", payload.Patch); err != nil {
		return nil, err
	}
	return nil, repo.UnstageHunk(payload.Patch)
}
