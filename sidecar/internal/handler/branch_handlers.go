package handler

func registerBranchHandlers(r *Router) {
	r.Register(CommandBranchList, handleBranches)
	r.Register(CommandBranchListRemote, handleRemoteBranches)
	r.Register(CommandBranchCurrent, handleCurrentBranch)
	r.Register(CommandBranchAheadBehind, handleAheadBehind)
	r.Register(CommandBranchCreate, handleCreateBranch)
	r.Register(CommandBranchDelete, handleDeleteBranch)
	r.Register(CommandBranchCheckout, handleCheckout)
	r.Register(CommandBranchCheckoutNew, handleCheckoutNew)
}

func handleBranches(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Branches()
}

func handleRemoteBranches(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.RemoteBranches()
}

func handleCurrentBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	branch, err := repo.CurrentBranch()
	if err != nil {
		return nil, err
	}
	return branchCurrentResult{Branch: branch}, nil
}

func handleAheadBehind(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[branchAheadBehindPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("branch", payload.Branch); err != nil {
		return nil, err
	}

	ahead, behind, err := repo.AheadBehind(payload.Branch)
	if err != nil {
		return nil, err
	}
	return branchAheadBehindResult{Ahead: ahead, Behind: behind}, nil
}

func handleCreateBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[branchNamePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("name", payload.Name); err != nil {
		return nil, err
	}
	return nil, repo.CreateBranch(payload.Name)
}

func handleDeleteBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[branchNamePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("name", payload.Name); err != nil {
		return nil, err
	}
	return nil, repo.DeleteBranch(payload.Name)
}

func handleCheckout(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[branchCheckoutPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("branch", payload.Branch); err != nil {
		return nil, err
	}
	return nil, repo.Checkout(payload.Branch)
}

func handleCheckoutNew(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[branchCheckoutNewPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("branch", payload.Branch); err != nil {
		return nil, err
	}
	return nil, repo.CheckoutNewBranch(payload.Branch, payload.StartFrom)
}
