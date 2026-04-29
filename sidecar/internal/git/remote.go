package git

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
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
	SSHKeyPath  string
	SSHPassword string // SSH key passphrase
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

// SetRemoteURL 修改远程仓库地址（先删除再添加）
func (r *Repository) SetRemoteURL(name, url string) error {
	// Get the existing remote config for reference
	remote, err := r.repo.Remote(name)
	if err != nil {
		// Remote doesn't exist, create it
		return r.AddRemote(name, url)
	}

	// Get fetch refspecs from existing remote
	_ = remote.Config() // Keep refspecs reference

	// Delete old remote
	if err := r.repo.DeleteRemote(name); err != nil {
		return fmt.Errorf("修改远程仓库地址失败 (删除旧配置): %w", err)
	}

	// Create new remote with the new URL
	_, err = r.repo.CreateRemote(&config.RemoteConfig{
		Name:  name,
		URLs:  []string{url},
		Fetch: nil, // Use default fetch refspecs
	})
	if err != nil {
		return fmt.Errorf("修改远程仓库地址失败 (添加新配置): %w", err)
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
		return wrapAuthError(fmt.Errorf("fetch 失败 (%s): %w", remoteName, err))
	}
	return nil
}

// Pull 拉取并合并远程分支（分层策略）
// 第一层：尝试 go-git fast-forward pull（通过 app 管理的凭据认证）
// 第二层：若 non-fast-forward，则用 go-git fetch + 本地 git merge（纯本地操作，不触发凭据弹窗）
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return err
	}

	// ── 第一层：go-git Pull (fast-forward) ──────────────────────────────
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	pullOpts := &gogit.PullOptions{
		RemoteName:    remoteName,
		ReferenceName: branchRef,
		Auth:          resolveAuth(auth),
		Progress:      progress,
	}

	err = wt.Pull(pullOpts)
	if err == nil || err == gogit.NoErrAlreadyUpToDate {
		return nil // fast-forward 成功或已是最新
	}

	// 非 non-fast-forward 错误（认证、网络等），直接返回友好提示
	if !errors.Is(err, gogit.ErrNonFastForwardUpdate) {
		return wrapAuthError(fmt.Errorf("pull 失败 (%s): %w", remoteName, err))
	}

	// ── 第二层：go-git Fetch + 本地 git merge ────────────────────────────
	// 第一层的 pull 内部已执行 fetch，远程引用已更新。
	// 这里直接执行本地 merge，不涉及网络，不会触发 Git Credential Manager 弹窗。
	remoteRef := fmt.Sprintf("%s/%s", remoteName, branchRef.Short())
	return r.runLocalMerge(progress, remoteRef)
}

// Push 推送本地提交到远程仓库（git push）
func (r *Repository) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return err
	}
	pushOpts := &gogit.PushOptions{
		RemoteName: remoteName,
		RefSpecs: []config.RefSpec{
			config.RefSpec(fmt.Sprintf("%s:%s", branchRef, branchRef)),
		},
		Auth:     resolveAuth(auth),
		Progress: progress,
	}

	err = r.repo.Push(pushOpts)
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("push 失败 (%s): %w", remoteName, err)
	}
	if err := r.updateCurrentRemoteTrackingRef(remoteName); err != nil {
		return fmt.Errorf("push succeeded but failed to update local remote-tracking ref (%s): %w", remoteName, err)
	}
	return nil
}

func (r *Repository) updateCurrentRemoteTrackingRef(remoteName string) error {
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

func (r *Repository) currentBranchReferenceName() (plumbing.ReferenceName, error) {
	headRef, err := r.repo.Head()
	if err != nil {
		return "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	if !headRef.Name().IsBranch() {
		return "", fmt.Errorf("当前处于 detached HEAD 状态 (%s)", headRef.Hash().String()[:8])
	}
	return headRef.Name(), nil
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Merge 操作（为后续 merge 功能预留完整工作流）
// ═══════════════════════════════════════════════════════════════════════════════

// runLocalMerge 执行本地 git merge（纯本地操作，不涉及网络，不会触发凭据弹窗）。
// ref 为要合并的引用，如 "origin/main"。
// 当发生冲突时返回 *MergeConflictError，前端可通过 errors.As 提取冲突文件列表。
func (r *Repository) runLocalMerge(progress io.Writer, ref string) error {
	cmd := exec.Command("git", "-C", r.path, "merge", "--no-edit", ref)
	cmd.Env = nonInteractiveEnv()

	var output bytes.Buffer
	writer := io.Writer(&output)
	if progress != nil {
		writer = io.MultiWriter(&output, progress)
	}
	cmd.Stdout = writer
	cmd.Stderr = writer

	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(output.String())
		if message == "" {
			message = err.Error()
		}
		// 检测合并冲突 → 返回结构化 MergeConflictError
		if strings.Contains(message, "CONFLICT") || strings.Contains(message, "Automatic merge failed") {
			return &MergeConflictError{
				Info: MergeConflictInfo{
					ConflictedFiles: parseConflictedFiles(message),
					Message:         message,
					MergingBranch:   ref,
				},
			}
		}
		return fmt.Errorf("merge 失败: %s", message)
	}
	return nil
}

// MergeStatus 检查当前仓库是否处于 merge 中间状态。
// 通过检测 .git/MERGE_HEAD 文件是否存在来判断。
// 后续可扩展返回冲突文件列表、MERGE_MSG 等信息。
func (r *Repository) MergeStatus() (*MergeStatusResult, error) {
	result := &MergeStatusResult{}

	// 检查 MERGE_HEAD 是否存在
	mergeHeadPath := filepath.Join(r.path, ".git", "MERGE_HEAD")
	data, err := os.ReadFile(mergeHeadPath)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil // 没有正在进行的 merge
		}
		return nil, fmt.Errorf("检查 merge 状态失败: %w", err)
	}

	result.Merging = true
	result.MergeHead = strings.TrimSpace(string(data))

	// 获取冲突文件列表（通过 git diff --name-only --diff-filter=U）
	cmd := exec.Command("git", "-C", r.path, "diff", "--name-only", "--diff-filter=U")
	cmd.Env = nonInteractiveEnv()
	out, err := cmd.Output()
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				result.ConflictedFiles = append(result.ConflictedFiles, line)
			}
		}
	}

	return result, nil
}

// MergeAbort 放弃当前正在进行的 merge（git merge --abort）。
// 前端可在用户不想解决冲突时调用此方法回退到 merge 之前的状态。
func (r *Repository) MergeAbort() error {
	cmd := exec.Command("git", "-C", r.path, "merge", "--abort")
	cmd.Env = nonInteractiveEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("merge abort 失败: %s", message)
	}
	return nil
}

// MergeContinue 在用户解决完冲突并 add 后，完成 merge 提交。
// 等价于用户手动执行 git commit（merge 场景下 Git 会自动生成 merge commit message）。
// 后续可扩展支持自定义 commit message。
func (r *Repository) MergeContinue(message string) error {
	args := []string{"-C", r.path, "commit", "--no-edit"}
	if message != "" {
		args = []string{"-C", r.path, "commit", "-m", message}
	}
	cmd := exec.Command("git", args...)
	cmd.Env = nonInteractiveEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := strings.TrimSpace(string(out))
		if errMsg == "" {
			errMsg = err.Error()
		}
		return fmt.Errorf("merge continue 失败: %s", errMsg)
	}
	return nil
}

// nonInteractiveEnv 返回一组确保 Git 不会弹出任何交互式提示的环境变量。
// 所有调用系统 git CLI 的方法都应使用此 env，防止 Credential Manager 弹窗阻塞进程。
func nonInteractiveEnv() []string {
	return append(os.Environ(),
		"GIT_MERGE_AUTOEDIT=no",
		"GIT_TERMINAL_PROMPT=0",  // 禁止终端提示
		"GCM_INTERACTIVE=never", // 禁止 Git Credential Manager 交互
	)
}

// parseConflictedFiles 从 git merge 输出中解析冲突文件列表。
// 格式示例: "CONFLICT (content): Merge conflict in path/to/file.go"
func parseConflictedFiles(output string) []string {
	var files []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "CONFLICT") && strings.Contains(line, "Merge conflict in ") {
			idx := strings.Index(line, "Merge conflict in ")
			if idx >= 0 {
				file := strings.TrimSpace(line[idx+len("Merge conflict in "):])
				if file != "" {
					files = append(files, file)
				}
			}
		}
	}
	return files
}

// wrapAuthError 将 go-git 的认证错误包装为用户友好的提示
func wrapAuthError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, transport.ErrAuthenticationRequired) ||
		errors.Is(err, transport.ErrAuthorizationFailed) {
		return fmt.Errorf("认证失败，请在设置页检查凭据配置: %w", err)
	}
	errMsg := err.Error()
	if strings.Contains(errMsg, "authentication") ||
		strings.Contains(errMsg, "Authorization") ||
		strings.Contains(errMsg, "401") ||
		strings.Contains(errMsg, "403") {
		return fmt.Errorf("认证失败，请在设置页检查凭据配置: %w", err)
	}
	return err
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
