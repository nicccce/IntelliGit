package git

import (
	"fmt"

	gogit "github.com/go-git/go-git/v5"
)

type goGitBackend struct {
	repo *gogit.Repository
}

func newGoGitBackend(repo *gogit.Repository) *goGitBackend {
	return &goGitBackend{repo: repo}
}

func (r *goGitBackend) Head() (hash string, branch string, err error) {
	ref, err := r.repo.Head()
	if err != nil {
		return "", "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	return ref.Hash().String(), ref.Name().Short(), nil
}

func (r *goGitBackend) IsClean() (bool, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return false, fmt.Errorf("获取 worktree 失败: %w", err)
	}
	status, err := wt.Status()
	if err != nil {
		return false, fmt.Errorf("获取 status 失败: %w", err)
	}
	return status.IsClean(), nil
}
