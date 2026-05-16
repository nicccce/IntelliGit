package git

import (
	"errors"
	"fmt"
	"io"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
)

// Remotes 列出所有远程仓库信息。
func (r *goGitBackend) Remotes() ([]RemoteInfo, error) {
	remotes, err := r.repo.Remotes()
	if err != nil {
		return nil, fmt.Errorf("获取远程仓库列表失败: %w", err)
	}

	var result []RemoteInfo
	for _, remote := range remotes {
		cfg := remote.Config()
		info := RemoteInfo{
			Name:     cfg.Name,
			PushURLs: cfg.URLs,
		}
		if len(cfg.URLs) > 0 {
			info.FetchURL = cfg.URLs[0]
		}
		result = append(result, info)
	}
	return result, nil
}

// AddRemote 添加一个远程仓库。
func (r *goGitBackend) AddRemote(name, url string) error {
	_, err := r.repo.CreateRemote(&config.RemoteConfig{
		Name: name,
		URLs: []string{url},
	})
	if err != nil {
		return fmt.Errorf("添加远程仓库失败 (%s): %w", name, err)
	}
	return nil
}

// SetRemoteURL 修改远程仓库地址。
func (r *goGitBackend) SetRemoteURL(name, url string) error {
	remote, err := r.repo.Remote(name)
	if err != nil {
		return r.AddRemote(name, url)
	}
	_ = remote.Config()

	if err := r.repo.DeleteRemote(name); err != nil {
		return fmt.Errorf("修改远程仓库地址失败 (删除旧配置): %w", err)
	}

	_, err = r.repo.CreateRemote(&config.RemoteConfig{
		Name:  name,
		URLs:  []string{url},
		Fetch: nil,
	})
	if err != nil {
		return fmt.Errorf("修改远程仓库地址失败 (添加新配置): %w", err)
	}
	return nil
}

// RemoveRemote 删除一个远程仓库。
func (r *goGitBackend) RemoveRemote(name string) error {
	if err := r.repo.DeleteRemote(name); err != nil {
		return fmt.Errorf("删除远程仓库失败 (%s): %w", name, err)
	}
	return nil
}

// Fetch 从远程仓库拉取最新引用。
func (r *goGitBackend) Fetch(remoteName string, auth *AuthMethod, progress io.Writer) error {
	err := r.repo.Fetch(&gogit.FetchOptions{
		RemoteName: remoteName,
		Auth:       resolveAuth(auth),
		Progress:   progress,
	})
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return wrapAuthError(fmt.Errorf("fetch 失败 (%s): %w", remoteName, err))
	}
	return nil
}

// PullFastForward 只执行 go-git fast-forward pull。
// 如果需要 non-fast-forward merge，Repository facade 会切换到 CLI backend。
func (r *goGitBackend) PullFastForward(remoteName string, auth *AuthMethod, progress io.Writer) (plumbing.ReferenceName, error) {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return "", err
	}

	wt, err := r.repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("获取 worktree 失败: %w", err)
	}

	err = wt.Pull(&gogit.PullOptions{
		RemoteName:    remoteName,
		ReferenceName: branchRef,
		Auth:          resolveAuth(auth),
		Progress:      progress,
	})
	if err == nil || err == gogit.NoErrAlreadyUpToDate {
		return branchRef, nil
	}
	if !errors.Is(err, gogit.ErrNonFastForwardUpdate) {
		return "", wrapAuthError(fmt.Errorf("pull 失败 (%s): %w", remoteName, err))
	}
	return branchRef, err
}

// Push 推送本地提交到远程仓库。
func (r *goGitBackend) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return err
	}

	err = r.repo.Push(&gogit.PushOptions{
		RemoteName: remoteName,
		RefSpecs: []config.RefSpec{
			config.RefSpec(fmt.Sprintf("%s:%s", branchRef, branchRef)),
		},
		Auth:     resolveAuth(auth),
		Progress: progress,
	})
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("push 失败 (%s): %w", remoteName, err)
	}
	if err := r.updateCurrentRemoteTrackingRef(remoteName); err != nil {
		return fmt.Errorf("push succeeded but failed to update local remote-tracking ref (%s): %w", remoteName, err)
	}
	return nil
}

func (r *goGitBackend) updateCurrentRemoteTrackingRef(remoteName string) error {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return err
	}

	headRef, err := r.repo.Reference(branchRef, true)
	if err != nil {
		return err
	}
	remoteRefName := plumbing.NewRemoteReferenceName(remoteName, branchRef.Short())
	remoteRef := plumbing.NewHashReference(remoteRefName, headRef.Hash())
	return r.repo.Storer.SetReference(remoteRef)
}

func (r *goGitBackend) currentBranchReferenceName() (plumbing.ReferenceName, error) {
	headRef, err := r.repo.Head()
	if err != nil {
		return "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	if !headRef.Name().IsBranch() {
		return "", fmt.Errorf("当前处于 detached HEAD 状态 (%s)", headRef.Hash().String()[:8])
	}
	return headRef.Name(), nil
}
