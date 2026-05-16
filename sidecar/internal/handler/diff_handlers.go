package handler

func registerDiffHandlers(r *Router) {
	r.Register(CommandDiffCommits, handleDiffCommits)
	r.Register(CommandDiffWithParent, handleDiffWithParent)
	r.Register(CommandDiffCommitPatch, handleGetCommitPatch)
	r.Register(CommandDiffFileContent, handleFileContentAtCommit)
	r.Register(CommandDiffListFiles, handleListFilesAtCommit)
	r.Register(CommandDiffWorkdir, handleDiffWorkdir)
	r.Register(CommandDiffStaged, handleDiffStaged)
	r.Register(CommandDiffWorkdirRaw, handleDiffWorkdirRaw)
	r.Register(CommandDiffStagedRaw, handleDiffStagedRaw)
}

func handleDiffCommits(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffCommitsPayload](ctx)
	if err != nil {
		return nil, err
	}
	if payload.HashA == "" || payload.HashB == "" {
		return nil, errMissingParam("hashA / hashB")
	}
	return repo.DiffCommits(payload.HashA, payload.HashB)
}

func handleDiffWithParent(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffHashPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	return repo.DiffWithParent(payload.Hash)
}

func handleGetCommitPatch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffHashPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	return repo.GetCommitPatch(payload.Hash)
}

func handleFileContentAtCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffFileContentPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}

	content, err := repo.FileContentAtCommit(payload.Hash, payload.Path)
	if err != nil {
		return nil, err
	}
	return diffFileContentResult{Content: content}, nil
}

func handleListFilesAtCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffHashPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	return repo.ListFilesAtCommit(payload.Hash)
}

func handleDiffWorkdir(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	return repo.DiffWorkdir(payload.Path)
}

func handleDiffStaged(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	return repo.DiffStaged(payload.Path)
}

func handleDiffWorkdirRaw(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	raw, err := repo.DiffWorkdirRaw(payload.Path)
	if err != nil {
		return nil, err
	}
	return diffRawResult{Diff: raw}, nil
}

func handleDiffStagedRaw(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[diffPathPayload](ctx)
	if err != nil {
		return nil, err
	}
	raw, err := repo.DiffStagedRaw(payload.Path)
	if err != nil {
		return nil, err
	}
	return diffRawResult{Diff: raw}, nil
}
