package handler

import "intelligit-sidecar/internal/git"

func registerRepoHandlers(r *Router) {
	r.Register(CommandRepoOpen, handleRepoOpen)
	r.Register(CommandRepoInit, handleRepoInit)
	r.Register(CommandRepoClone, handleClone)
	r.Register(CommandRepoHead, handleHead)
	r.Register(CommandRepoIsClean, handleIsClean)
}

func handleRepoOpen(ctx *Context) (any, error) {
	payload, err := bindPayload[repoOpenPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}

	repo, err := git.Open(payload.Path)
	if err != nil {
		return nil, err
	}
	ctx.setRepoCallback(repo)
	return repoPathResult{Path: repo.Path()}, nil
}

func handleRepoInit(ctx *Context) (any, error) {
	payload, err := bindPayload[repoInitPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}

	repo, err := git.Init(payload.Path, payload.Bare)
	if err != nil {
		return nil, err
	}
	ctx.setRepoCallback(repo)
	return repoPathResult{Path: repo.Path()}, nil
}

func handleClone(ctx *Context) (any, error) {
	payload, err := bindPayload[repoClonePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("url", payload.URL); err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}

	repo, err := git.Clone(payload.URL, payload.Path, &git.CloneOptions{
		Depth:    payload.Depth,
		Branch:   payload.Branch,
		Progress: NewProgressWriter(ctx.Notifier, ctx.RequestID),
	})
	if err != nil {
		return nil, err
	}
	ctx.setRepoCallback(repo)
	return repoPathResult{Path: repo.Path()}, nil
}

func handleHead(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	hash, branch, err := repo.Head()
	if err != nil {
		return nil, err
	}
	return repoHeadResult{Hash: hash, Branch: branch}, nil
}

func handleIsClean(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	clean, err := repo.IsClean()
	if err != nil {
		return nil, err
	}
	return repoCleanResult{Clean: clean}, nil
}
