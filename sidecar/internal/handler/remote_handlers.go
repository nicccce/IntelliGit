package handler

import (
	"errors"

	"intelligit-sidecar/internal/git"
)

func registerRemoteHandlers(r *Router) {
	r.Register(CommandRemoteList, handleRemotes)
	r.Register(CommandRemoteAdd, handleAddRemote)
	r.Register(CommandRemoteSetURL, handleSetRemoteURL)
	r.Register(CommandRemoteRemove, handleRemoveRemote)
	r.Register(CommandRemoteFetch, handleFetch)
	r.Register(CommandRemotePull, handlePull)
	r.Register(CommandRemotePush, handlePush)
}

func (p *remoteAuthPayload) authMethod() *git.AuthMethod {
	if p.Username == "" && p.Password == "" && p.SSHKeyPath == "" {
		return nil
	}
	return &git.AuthMethod{
		Username:    p.Username,
		Password:    p.Password,
		SSHKeyPath:  p.SSHKeyPath,
		SSHPassword: p.SSHPassword,
	}
}

func (p *remoteAuthPayload) remoteName() string {
	if p.Remote == "" {
		return "origin"
	}
	return p.Remote
}

func handleRemotes(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Remotes()
}

func handleAddRemote(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteAddPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("name", payload.Name); err != nil {
		return nil, err
	}
	if err := requireParam("url", payload.URL); err != nil {
		return nil, err
	}
	return nil, repo.AddRemote(payload.Name, payload.URL)
}

func handleSetRemoteURL(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteSetURLPayload](ctx)
	if err != nil {
		return nil, err
	}
	if payload.Name == "" {
		payload.Name = "origin"
	}
	if err := requireParam("url", payload.URL); err != nil {
		return nil, err
	}
	return nil, repo.SetRemoteURL(payload.Name, payload.URL)
}

func handleRemoveRemote(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteRemovePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("name", payload.Name); err != nil {
		return nil, err
	}
	return nil, repo.RemoveRemote(payload.Name)
}

func handleFetch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteAuthPayload](ctx)
	if err != nil {
		return nil, err
	}
	return nil, repo.Fetch(payload.remoteName(), payload.authMethod(), NewProgressWriter(ctx.Notifier, ctx.RequestID))
}

func handlePull(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteAuthPayload](ctx)
	if err != nil {
		return nil, err
	}

	err = repo.Pull(payload.remoteName(), payload.authMethod(), NewProgressWriter(ctx.Notifier, ctx.RequestID))
	if err == nil {
		return nil, nil
	}

	var conflictErr *git.MergeConflictError
	if errors.As(err, &conflictErr) {
		return conflictErr.Info, err
	}
	return nil, err
}

func handlePush(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[remoteAuthPayload](ctx)
	if err != nil {
		return nil, err
	}
	return nil, repo.Push(payload.remoteName(), payload.authMethod(), NewProgressWriter(ctx.Notifier, ctx.RequestID))
}
