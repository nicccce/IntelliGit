package git

import (
	"fmt"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/storer"
)

// Branches 列出所有本地分支
func (r *Repository) Branches() ([]BranchInfo, error) {
	headRef, _ := r.repo.Head()

	iter, err := r.repo.Branches()
	if err != nil {
		return nil, fmt.Errorf("获取分支列表失败: %w", err)
	}

	var branches []BranchInfo
	err = iter.ForEach(func(ref *plumbing.Reference) error {
		isHead := headRef != nil && ref.Name() == headRef.Name()
		branches = append(branches, BranchInfo{
			Name:     ref.Name().Short(),
			IsRemote: false,
			IsHead:   isHead,
			Hash:     ref.Hash().String(),
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("遍历分支失败: %w", err)
	}
	return branches, nil
}

// RemoteBranches 列出所有远程追踪分支
func (r *Repository) RemoteBranches() ([]BranchInfo, error) {
	refs, err := r.repo.References()
	if err != nil {
		return nil, fmt.Errorf("获取引用列表失败: %w", err)
	}

	var branches []BranchInfo
	err = refs.ForEach(func(ref *plumbing.Reference) error {
		if ref.Name().IsRemote() {
			branches = append(branches, BranchInfo{
				Name:     ref.Name().Short(),
				IsRemote: true,
				Hash:     ref.Hash().String(),
			})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("遍历引用失败: %w", err)
	}
	return branches, nil
}

// CurrentBranch 获取当前所在分支名
func (r *Repository) CurrentBranch() (string, error) {
	ref, err := r.repo.Head()
	if err != nil {
		return "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	if !ref.Name().IsBranch() {
		return "", fmt.Errorf("当前处于 detached HEAD 状态 (%s)", ref.Hash().String()[:8])
	}
	return ref.Name().Short(), nil
}

// CreateBranch 在当前 HEAD 上创建一条新分支
func (r *Repository) CreateBranch(name string) error {
	headRef, err := r.repo.Head()
	if err != nil {
		return fmt.Errorf("获取 HEAD 失败: %w", err)
	}

	refName := plumbing.NewBranchReferenceName(name)
	ref := plumbing.NewHashReference(refName, headRef.Hash())
	if err := r.repo.Storer.SetReference(ref); err != nil {
		return fmt.Errorf("创建分支失败 (%s): %w", name, err)
	}

	// 同时在 config 中记录分支信息
	if err := r.repo.CreateBranch(&config.Branch{
		Name:   name,
		Remote: "origin",
		Merge:  refName,
	}); err != nil {
		// 非致命：分支引用已经创建成功，config 写入不影响功能
		_ = err
	}

	return nil
}

// DeleteBranch 删除一条本地分支
func (r *Repository) DeleteBranch(name string) error {
	refName := plumbing.NewBranchReferenceName(name)

	// 不允许删除当前所在分支
	headRef, err := r.repo.Head()
	if err == nil && headRef.Name() == refName {
		return fmt.Errorf("无法删除当前所在分支 (%s)", name)
	}

	if err := r.repo.Storer.RemoveReference(refName); err != nil {
		return fmt.Errorf("删除分支失败 (%s): %w", name, err)
	}

	// 清理 config 中的分支配置
	_ = r.repo.DeleteBranch(name)

	return nil
}

// Checkout 切换到指定分支
func (r *Repository) Checkout(branch string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	if err := wt.Checkout(&gogit.CheckoutOptions{
		Branch: plumbing.NewBranchReferenceName(branch),
	}); err != nil {
		return fmt.Errorf("切换分支失败 (%s): %w", branch, err)
	}
	return nil
}

// CheckoutNewBranch 创建并切换到新分支（git checkout -b <branch> [<startPoint>]）
// 如果 startPoint 不为空，则从指定的 commit hash 创建分支；否则从当前 HEAD 创建。
func (r *Repository) CheckoutNewBranch(branch string, startPoint string) error {
	wt, err := r.repo.Worktree()
	if err != nil {
		return fmt.Errorf("获取 worktree 失败: %w", err)
	}

	opts := &gogit.CheckoutOptions{
		Branch: plumbing.NewBranchReferenceName(branch),
		Create: true,
	}

	if startPoint != "" {
		opts.Hash = plumbing.NewHash(startPoint)
	}

	if err := wt.Checkout(opts); err != nil {
		return fmt.Errorf("创建并切换分支失败 (%s): %w", branch, err)
	}
	return nil
}

// AheadBehind 计算当前分支相较于远程对应分支（如 origin/branchName）的落后与超前提交数
func (r *Repository) AheadBehind(branchName string) (ahead int, behind int, err error) {
	localRef, err := r.repo.Reference(plumbing.ReferenceName("refs/heads/"+branchName), true)
	if err != nil {
		return 0, 0, err
	}

	remoteRef, err := r.repo.Reference(plumbing.ReferenceName("refs/remotes/origin/"+branchName), true)
	if err != nil {
		// 无远程分支，说明全是 ahead
		iter, err := r.repo.Log(&gogit.LogOptions{From: localRef.Hash()})
		if err == nil {
			_ = iter.ForEach(func(c *object.Commit) error {
				ahead++
				return nil
			})
		}
		return ahead, 0, nil
	}

	localCommit, err := r.repo.CommitObject(localRef.Hash())
	if err != nil {
		return 0, 0, err
	}

	remoteCommit, err := r.repo.CommitObject(remoteRef.Hash())
	if err != nil {
		return 0, 0, err
	}

	if localCommit.Hash == remoteCommit.Hash {
		return 0, 0, nil
	}

	bases, err := localCommit.MergeBase(remoteCommit)
	if err != nil || len(bases) == 0 {
		return 0, 0, nil
	}
	base := bases[0]

	iter1, _ := r.repo.Log(&gogit.LogOptions{From: localCommit.Hash})
	_ = iter1.ForEach(func(c *object.Commit) error {
		if c.Hash == base.Hash {
			return storer.ErrStop
		}
		ahead++
		return nil
	})

	iter2, _ := r.repo.Log(&gogit.LogOptions{From: remoteCommit.Hash})
	_ = iter2.ForEach(func(c *object.Commit) error {
		if c.Hash == base.Hash {
			return storer.ErrStop
		}
		behind++
		return nil
	})

	return ahead, behind, nil
}
