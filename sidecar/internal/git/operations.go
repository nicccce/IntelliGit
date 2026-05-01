package git

import (
	"fmt"
	"os/exec"
	"sort"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// ResetToCommit 将当前分支重置到指定 commit
// mode 支持: "soft"、"mixed"（默认）、"hard"
func (r *Repository) ResetToCommit(hashStr string, mode string) error {
	hash := plumbing.NewHash(hashStr)

	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	var resetMode gogit.ResetMode
	switch mode {
	case "soft":
		resetMode = gogit.SoftReset
	case "hard":
		resetMode = gogit.HardReset
	default:
		resetMode = gogit.MixedReset
	}

	if err := wt.Reset(&gogit.ResetOptions{
		Commit: hash,
		Mode:   resetMode,
	}); err != nil {
		return fmt.Errorf("reset 失败 (%s --%s): %w", hashStr[:8], mode, err)
	}
	return nil
}

// CheckoutCommit 将工作区切换到指定 commit（detached HEAD）
func (r *Repository) CheckoutCommit(hashStr string) error {
	hash := plumbing.NewHash(hashStr)

	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	if err := wt.Checkout(&gogit.CheckoutOptions{
		Hash: hash,
	}); err != nil {
		return fmt.Errorf("checkout commit 失败 (%s): %w", hashStr[:8], err)
	}
	return nil
}

// LogAll 获取所有分支的 commit 历史（等价于 git log --all）
// 返回按时间排序的 commit 列表，每个 commit 附带关联的分支引用
func (r *Repository) LogAll(max int) ([]CommitInfo, error) {
	if max <= 0 {
		max = 200
	}

	// 收集所有分支引用对应的 commit hash → ref name 映射
	refMap := make(map[plumbing.Hash][]string)

	// 本地分支
	localBranches, _ := r.repo.Branches()
	if localBranches != nil {
		_ = localBranches.ForEach(func(ref *plumbing.Reference) error {
			refMap[ref.Hash()] = append(refMap[ref.Hash()], ref.Name().Short())
			return nil
		})
	}

	// 远程分支
	remoteRefs, _ := r.repo.References()
	if remoteRefs != nil {
		_ = remoteRefs.ForEach(func(ref *plumbing.Reference) error {
			if ref.Name().IsRemote() {
				refMap[ref.Hash()] = append(refMap[ref.Hash()], ref.Name().Short())
			}
			return nil
		})
	}

	// tags
	tags, _ := r.repo.Tags()
	if tags != nil {
		_ = tags.ForEach(func(ref *plumbing.Reference) error {
			refMap[ref.Hash()] = append(refMap[ref.Hash()], ref.Name().Short())
			return nil
		})
	}

	// 收集所有分支的 HEAD commit
	var startPoints []plumbing.Hash
	allRefs, _ := r.repo.References()
	if allRefs != nil {
		seen := make(map[plumbing.Hash]bool)
		_ = allRefs.ForEach(func(ref *plumbing.Reference) error {
			if ref.Type() == plumbing.SymbolicReference {
				return nil
			}
			h := ref.Hash()
			if !seen[h] {
				seen[h] = true
				startPoints = append(startPoints, h)
			}
			return nil
		})
	}

	// 从所有起点收集 commit，使用 map 去重
	commitMap := make(map[plumbing.Hash]*object.Commit)
	for _, sp := range startPoints {
		iter, err := r.repo.Log(&gogit.LogOptions{
			From:  sp,
			Order: gogit.LogOrderCommitterTime,
		})
		if err != nil {
			continue
		}
		_ = iter.ForEach(func(c *object.Commit) error {
			if len(commitMap) >= max {
				return errStopIter
			}
			commitMap[c.Hash] = c
			return nil
		})
	}

	// 转换为 CommitInfo 列表
	commits := make([]CommitInfo, 0, len(commitMap))
	for _, c := range commitMap {
		info := commitToInfo(c)
		if refs, ok := refMap[c.Hash]; ok {
			info.Refs = refs
		}
		commits = append(commits, info)
	}

	// 按时间降序排序
	sort.Slice(commits, func(i, j int) bool {
		return commits[i].Date.After(commits[j].Date)
	})

	// 限制数量
	if len(commits) > max {
		commits = commits[:max]
	}

	return commits, nil
}

// LogAllRaw 使用 git CLI 获取所有分支的 commit 历史（带拓扑排序信息）
// 返回格式化的 commit 列表，适合前端构建 commit graph
func (r *Repository) LogAllRaw(max int) (string, error) {
	if max <= 0 {
		max = 200
	}

	cmd := exec.Command("git", "log", "--all",
		"--topo-order",
		fmt.Sprintf("--max-count=%d", max),
		"--format=%H|%h|%P|%an|%ae|%aI|%s|%D",
	)
	cmd.Dir = r.path

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git log --all 失败: %s: %w", string(exitErr.Stderr), err)
		}
		return "", fmt.Errorf("git log --all 失败: %w", err)
	}
	return string(output), nil
}
