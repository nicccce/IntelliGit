package handler

func registerCommitHandlers(r *Router) {
	r.Register(CommandCommitCreate, handleCommit)
	r.Register(CommandCommitLog, handleLog)
	r.Register(CommandCommitGet, handleGetCommit)
	r.Register(CommandCommitReset, handleResetToCommit)
	r.Register(CommandCommitCheckoutCommit, handleCheckoutCommit)
	r.Register(CommandCommitLogAll, handleLogAll)
}

func handleCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitCreatePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("message", payload.Message); err != nil {
		return nil, err
	}

	hash, err := repo.Commit(payload.Message, payload.AuthorName, payload.AuthorEmail)
	if err != nil {
		return nil, err
	}
	return commitHashResult{Hash: hash}, nil
}

func handleLog(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitLogPayload](ctx)
	if err != nil {
		return nil, err
	}
	if payload.From != "" {
		return repo.LogFrom(payload.From, payload.Max)
	}
	return repo.Log(payload.Max)
}

func handleGetCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitHashPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	return repo.GetCommit(payload.Hash)
}

func handleResetToCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitResetPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	if payload.Mode == "" {
		payload.Mode = "mixed"
	}
	return nil, repo.ResetToCommit(payload.Hash, payload.Mode)
}

func handleCheckoutCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitHashPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("hash", payload.Hash); err != nil {
		return nil, err
	}
	return nil, repo.CheckoutCommit(payload.Hash)
}

func handleLogAll(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[commitLogAllPayload](ctx)
	if err != nil {
		return nil, err
	}
	return repo.LogAll(payload.Max)
}
