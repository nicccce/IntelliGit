package git

import (
	"fmt"
	"io"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
)

// AuthMethod 封装认证信息，支持 HTTP(S) 和 SSH
type AuthMethod struct {
	// HTTP(S) 认证
	Username string
	Password string // 或 Personal Access Token

	// SSH 认证
	SSHKeyPath   string
	SSHPassword  string // SSH key passphrase
}

// Remotes 列出所有远程仓库信息
func (r *Repository) Remotes() ([]RemoteInfo, error) {
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

// AddRemote 添加一个远程仓库
func (r *Repository) AddRemote(name, url string) error {
	_, err := r.repo.CreateRemote(&config.RemoteConfig{
		Name: name,
		URLs: []string{url},
	})
	if err != nil {
		return fmt.Errorf("添加远程仓库失败 (%s): %w", name, err)
	}
	return nil
}

// RemoveRemote 删除一个远程仓库
func (r *Repository) RemoveRemote(name string) error {
	if err := r.repo.DeleteRemote(name); err != nil {
		return fmt.Errorf("删除远程仓库失败 (%s): %w", name, err)
	}
	return nil
}

// Fetch 从远程仓库拉取最新引用（git fetch）
func (r *Repository) Fetch(remoteName string, auth *AuthMethod, progress io.Writer) error {
	fetchOpts := &gogit.FetchOptions{
		RemoteName: remoteName,
		Auth:       resolveAuth(auth),
		Progress:   progress,
	}

	err := r.repo.Fetch(fetchOpts)
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("fetch 失败 (%s): %w", remoteName, err)
	}
	return nil
}

// Pull 拉取并合并远程分支（git pull）
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	pullOpts := &gogit.PullOptions{
		RemoteName: remoteName,
		Auth:       resolveAuth(auth),
		Progress:   progress,
	}

	err = wt.Pull(pullOpts)
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("pull 失败 (%s): %w", remoteName, err)
	}
	return nil
}

// Push 推送本地提交到远程仓库（git push）
func (r *Repository) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
	pushOpts := &gogit.PushOptions{
		RemoteName: remoteName,
		Auth:       resolveAuth(auth),
		Progress:   progress,
	}

	err := r.repo.Push(pushOpts)
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("push 失败 (%s): %w", remoteName, err)
	}
	return nil
}

// resolveAuth 将 AuthMethod 转换为 go-git 的 transport.AuthMethod
func resolveAuth(auth *AuthMethod) transport.AuthMethod {
	if auth == nil {
		return nil
	}

	// SSH 认证优先
	if auth.SSHKeyPath != "" {
		keys, err := gitssh.NewPublicKeysFromFile("git", auth.SSHKeyPath, auth.SSHPassword)
		if err == nil {
			return keys
		}
	}

	// HTTP(S) 认证
	if auth.Username != "" || auth.Password != "" {
		return &http.BasicAuth{
			Username: auth.Username,
			Password: auth.Password,
		}
	}

	return nil
}
