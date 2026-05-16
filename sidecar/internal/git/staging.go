package git

import (
	"errors"
	"fmt"
	"sort"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/index"
)

// Status 获取仓库中所有文件的状态（类似 git status）
func (r *goGitBackend) Status() ([]FileStatus, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}

	var result []FileStatus
	for path, s := range status {
		result = append(result, FileStatus{
			Path:     path,
			Staging:  toStatusCode(s.Staging),
			Worktree: toStatusCode(s.Worktree),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Path < result[j].Path
	})
	return result, nil
}

// Add 将指定文件添加到暂存区（git add <path>）
func (r *goGitBackend) Add(path string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}
	if _, err := wt.Add(path); err != nil {
		return fmt.Errorf("git add 失败 (%s): %w", path, err)
	}
	return nil
}

// AddAll 将所有变更文件添加到暂存区（git add -A）
func (r *goGitBackend) AddAll() error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}
	if err := wt.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
		return fmt.Errorf("git add -A 失败: %w", err)
	}
	return nil
}

// AddGlob 通过 glob 模式添加文件到暂存区（git add <pattern>）
func (r *goGitBackend) AddGlob(pattern string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}
	if err := wt.AddGlob(pattern); err != nil {
		return fmt.Errorf("git add %s 失败: %w", pattern, err)
	}
	return nil
}

// Remove 将文件从暂存区移除，并保留工作区内容（git restore --staged <path>）
func (r *goGitBackend) Remove(path string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}
	if err := wt.Restore(&gogit.RestoreOptions{
		Staged: true,
		Files:  []string{path},
	}); err != nil {
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			if removeErr := r.removeFromIndex(path); removeErr != nil {
				return fmt.Errorf("取消暂存失败 (%s): %w", path, removeErr)
			}
			return nil
		}
		return fmt.Errorf("取消暂存失败 (%s): %w", path, err)
	}
	return nil
}

// Restore 丢弃工作区指定文件的修改，恢复到 HEAD 版本（git restore <path>）
func (r *goGitBackend) Restore(path string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}
	if err := wt.Restore(&gogit.RestoreOptions{
		Staged:   true,
		Worktree: true,
		Files:    []string{path},
	}); err != nil {
		return fmt.Errorf("恢复文件失败 (%s): %w", path, err)
	}
	return nil
}

func (r *goGitBackend) removeFromIndex(path string) error {
	idx, err := r.repo.Storer.Index()
	if err != nil {
		return err
	}
	if _, err := idx.Remove(path); err != nil && !errors.Is(err, index.ErrEntryNotFound) {
		return err
	}
	return r.repo.Storer.SetIndex(idx)
}

// toStatusCode 将 go-git 的 StatusCode 转换为自定义 StatusCode
func toStatusCode(code gogit.StatusCode) StatusCode {
	switch code {
	case gogit.Unmodified:
		return StatusUnmodified
	case gogit.Modified:
		return StatusModified
	case gogit.Added:
		return StatusAdded
	case gogit.Deleted:
		return StatusDeleted
	case gogit.Renamed:
		return StatusRenamed
	case gogit.Copied:
		return StatusCopied
	case gogit.Untracked:
		return StatusUntracked
	default:
		return StatusCode(string(code))
	}
}
