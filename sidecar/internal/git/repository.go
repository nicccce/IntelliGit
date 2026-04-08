package git

import (
	"fmt"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// Repository 封装 go-git 的 Repository，作为所有 Git 操作的统一入口。
// 后续可在此结构体中扩展缓存、配置、事件回调等。
type Repository struct {
	repo *gogit.Repository
	path string // 仓库根目录（包含 .git 的目录）
}

// Open 打开一个已存在的 Git 仓库
func Open(path string) (*Repository, error) {
	repo, err := gogit.PlainOpen(path)
	if err != nil {
		return nil, fmt.Errorf("打开仓库失败 (%s): %w", path, err)
	}
	return &Repository{repo: repo, path: path}, nil
}

// Init 在指定路径初始化一个新的 Git 仓库
func Init(path string, bare bool) (*Repository, error) {
	repo, err := gogit.PlainInit(path, bare)
	if err != nil {
		return nil, fmt.Errorf("初始化仓库失败 (%s): %w", path, err)
	}
	return &Repository{repo: repo, path: path}, nil
}

// Clone 克隆一个远程仓库到本地路径
func Clone(url, path string, opts *CloneOptions) (*Repository, error) {
	cloneOpts := &gogit.CloneOptions{
		URL: url,
	}
	if opts != nil {
		if opts.Depth > 0 {
			cloneOpts.Depth = opts.Depth
		}
		if opts.Branch != "" {
			cloneOpts.ReferenceName = plumbing.NewBranchReferenceName(opts.Branch)
			cloneOpts.SingleBranch = true
		}
		cloneOpts.Progress = opts.Progress
	}

	repo, err := gogit.PlainClone(path, false, cloneOpts)
	if err != nil {
		return nil, fmt.Errorf("克隆仓库失败 (%s): %w", url, err)
	}
	return &Repository{repo: repo, path: path}, nil
}

// CloneOptions 克隆时的可选参数
type CloneOptions struct {
	Depth    int       // 浅克隆层数，0 表示完整克隆
	Branch   string    // 指定分支，空则使用默认分支
	Progress interface{ Write(p []byte) (n int, err error) } // 进度输出
}

// Path 返回仓库根目录路径
func (r *Repository) Path() string {
	return r.path
}

// GoGitRepo 返回底层 go-git Repository 对象，供需要直接操作的场景使用
func (r *Repository) GoGitRepo() *gogit.Repository {
	return r.repo
}

// Head 获取当前 HEAD 引用
func (r *Repository) Head() (hash string, branch string, err error) {
	ref, err := r.repo.Head()
	if err != nil {
		return "", "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	return ref.Hash().String(), ref.Name().Short(), nil
}

// IsClean 返回工作区是否干净（无未提交的修改）
func (r *Repository) IsClean() (bool, error) {
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
