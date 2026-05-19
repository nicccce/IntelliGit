package git

import (
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/index"
)

// Status 获取仓库中所有文件的状态（类似 git status）
// 会对 marked-as-modified 的文件做内容级二次验证，避免因元数据变化导致的误报
func (r *goGitBackend) Status() ([]FileStatus, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}

	// 预先获取 HEAD tree 和 index，用于内容级二次验证
	headTree, _ := r.headTree()
	idx, _ := r.repo.Storer.Index()

	var result []FileStatus
	for path, s := range status {
		// 对工作区 Modified 的文件进行内容级验证
		if s.Worktree == gogit.Modified {
			// 获取 reference 内容（优先 index，fallback 到 HEAD）
			var refContent string
			if idx != nil {
				for _, entry := range idx.Entries {
					if entry.Name == path {
						if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
							if reader, rErr := blob.Reader(); rErr == nil {
								data, _ := io.ReadAll(reader)
								reader.Close()
								refContent = string(data)
							}
						}
						break
					}
				}
			}
			if refContent == "" && headTree != nil {
				if f, fErr := headTree.File(path); fErr == nil {
					refContent, _ = f.Contents()
				}
			}

			// 获取工作区内容
			var wcContent string
			if wFile, wErr := wt.Filesystem.Open(path); wErr == nil {
				data, _ := io.ReadAll(wFile)
				wFile.Close()
				wcContent = string(data)
			}

			// 规范化换行符后比较
			refNormalized := strings.ReplaceAll(refContent, "\r\n", "\n")
			wcNormalized := strings.ReplaceAll(wcContent, "\r\n", "\n")
			if refNormalized == wcNormalized {
				// 内容完全相同，视为无变更，跳过
				continue
			}
		}

		// 对暂存区 Modified 的文件也做类似验证
		if s.Staging == gogit.Modified {
			// 获取 HEAD 版本内容作为旧版本
			var headContent string
			if headTree != nil {
				if f, fErr := headTree.File(path); fErr == nil {
					headContent, _ = f.Contents()
				}
			}

			// 获取 index 版本内容作为新版本
			var indexContent string
			if idx != nil {
				for _, entry := range idx.Entries {
					if entry.Name == path {
						if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
							if reader, rErr := blob.Reader(); rErr == nil {
								data, _ := io.ReadAll(reader)
								reader.Close()
								indexContent = string(data)
							}
						}
						break
					}
				}
			}

			headNormalized := strings.ReplaceAll(headContent, "\r\n", "\n")
			indexNormalized := strings.ReplaceAll(indexContent, "\r\n", "\n")
			if headNormalized == indexNormalized {
				// 暂存区与 HEAD 内容相同，视为无暂存变更，跳过
				continue
			}
		}

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
