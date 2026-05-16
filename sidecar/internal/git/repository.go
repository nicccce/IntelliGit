package git

import (
	"errors"
	"fmt"
	"io"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// Repository 是 handler 层唯一依赖的 Git facade。
// 具体实现由 go-git backend 与 git CLI backend 分担，避免调用方关心策略细节。
type Repository struct {
	path  string
	goGit *goGitBackend
	cli   *gitCliBackend
}

// Open 打开一个已存在的 Git 仓库
func Open(path string) (*Repository, error) {
	repo, err := gogit.PlainOpen(path)
	if err != nil {
		return nil, fmt.Errorf("打开仓库失败 (%s): %w", path, err)
	}
	return newRepository(path, repo), nil
}

// Init 在指定路径初始化一个新的 Git 仓库
func Init(path string, bare bool) (*Repository, error) {
	repo, err := gogit.PlainInit(path, bare)
	if err != nil {
		return nil, fmt.Errorf("初始化仓库失败 (%s): %w", path, err)
	}
	return newRepository(path, repo), nil
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
	return newRepository(path, repo), nil
}

// CloneOptions 克隆时的可选参数
type CloneOptions struct {
	Depth    int    // 浅克隆层数，0 表示完整克隆
	Branch   string // 指定分支，空则使用默认分支
	Progress interface {
		Write(p []byte) (n int, err error)
	} // 进度输出
}

func newRepository(path string, repo *gogit.Repository) *Repository {
	return &Repository{
		path:  path,
		goGit: newGoGitBackend(repo),
		cli:   newGitCliBackend(path),
	}
}

// Path 返回仓库根目录路径
func (r *Repository) Path() string {
	return r.path
}

// Head 获取当前 HEAD 引用
func (r *Repository) Head() (hash string, branch string, err error) {
	return r.goGit.Head()
}

// IsClean 返回工作区是否干净（无未提交的修改）
func (r *Repository) IsClean() (bool, error) {
	return r.goGit.IsClean()
}

func (r *Repository) Status() ([]FileStatus, error) {
	return r.goGit.Status()
}

func (r *Repository) Add(path string) error {
	return r.goGit.Add(path)
}

func (r *Repository) AddAll() error {
	return r.goGit.AddAll()
}

func (r *Repository) AddGlob(pattern string) error {
	return r.goGit.AddGlob(pattern)
}

func (r *Repository) Remove(path string) error {
	return r.goGit.Remove(path)
}

func (r *Repository) Restore(path string) error {
	return r.goGit.Restore(path)
}

func (r *Repository) ApplyPatch(patchContent string) error {
	return r.cli.ApplyPatch(patchContent)
}

func (r *Repository) UnstageHunk(patchContent string) error {
	return r.cli.UnstageHunk(patchContent)
}

func (r *Repository) DiscardHunk(patchContent string) error {
	return r.cli.DiscardHunk(patchContent)
}

func (r *Repository) Commit(message, authorName, authorEmail string) (string, error) {
	return r.goGit.Commit(message, authorName, authorEmail)
}

func (r *Repository) Log(max int) ([]CommitInfo, error) {
	return r.goGit.Log(max)
}

func (r *Repository) LogFrom(hashStr string, max int) ([]CommitInfo, error) {
	return r.goGit.LogFrom(hashStr, max)
}

func (r *Repository) GetCommit(hashStr string) (*CommitInfo, error) {
	return r.goGit.GetCommit(hashStr)
}

func (r *Repository) Branches() ([]BranchInfo, error) {
	return r.goGit.Branches()
}

func (r *Repository) RemoteBranches() ([]BranchInfo, error) {
	return r.goGit.RemoteBranches()
}

func (r *Repository) CurrentBranch() (string, error) {
	return r.goGit.CurrentBranch()
}

func (r *Repository) CreateBranch(name string) error {
	return r.goGit.CreateBranch(name)
}

func (r *Repository) DeleteBranch(name string) error {
	return r.goGit.DeleteBranch(name)
}

func (r *Repository) Checkout(branch string) error {
	return r.goGit.Checkout(branch)
}

func (r *Repository) CheckoutNewBranch(branch string, startPoint string) error {
	return r.goGit.CheckoutNewBranch(branch, startPoint)
}

func (r *Repository) AheadBehind(branchName string) (ahead int, behind int, err error) {
	return r.goGit.AheadBehind(branchName)
}

func (r *Repository) Remotes() ([]RemoteInfo, error) {
	return r.goGit.Remotes()
}

func (r *Repository) AddRemote(name, url string) error {
	return r.goGit.AddRemote(name, url)
}

func (r *Repository) SetRemoteURL(name, url string) error {
	return r.goGit.SetRemoteURL(name, url)
}

func (r *Repository) RemoveRemote(name string) error {
	return r.goGit.RemoveRemote(name)
}

func (r *Repository) Fetch(remoteName string, auth *AuthMethod, progress io.Writer) error {
	return r.goGit.Fetch(remoteName, auth, progress)
}

func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.goGit.PullFastForward(remoteName, auth, progress)
	if err == nil {
		return nil
	}
	if !errors.Is(err, gogit.ErrNonFastForwardUpdate) {
		return err
	}

	remoteRef := fmt.Sprintf("%s/%s", remoteName, branchRef.Short())
	return r.cli.RunLocalMerge(progress, remoteRef)
}

func (r *Repository) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
	return r.goGit.Push(remoteName, auth, progress)
}

func (r *Repository) MergeStatus() (*MergeStatusResult, error) {
	return r.cli.MergeStatus()
}

func (r *Repository) MergeAbort() error {
	return r.cli.MergeAbort()
}

func (r *Repository) MergeContinue(message string) error {
	return r.cli.MergeContinue(message)
}

func (r *Repository) DiffWorkdir(filePath string) (*PatchDetail, error) {
	return r.goGit.DiffWorkdir(filePath)
}

func (r *Repository) DiffStaged(filePath string) (*PatchDetail, error) {
	return r.goGit.DiffStaged(filePath)
}

func (r *Repository) DiffWorkdirRaw(filePath string) (string, error) {
	return r.cli.DiffWorkdirRaw(filePath)
}

func (r *Repository) DiffStagedRaw(filePath string) (string, error) {
	return r.cli.DiffStagedRaw(filePath)
}

func (r *Repository) DiffCommits(hashAStr, hashBStr string) ([]DiffEntry, error) {
	return r.goGit.DiffCommits(hashAStr, hashBStr)
}

func (r *Repository) DiffWithParent(hashStr string) ([]DiffEntry, error) {
	return r.goGit.DiffWithParent(hashStr)
}

func (r *Repository) GetCommitPatch(hashStr string) (*PatchDetail, error) {
	return r.goGit.GetCommitPatch(hashStr)
}

func (r *Repository) FileContentAtCommit(hashStr, filePath string) (string, error) {
	return r.goGit.FileContentAtCommit(hashStr, filePath)
}

func (r *Repository) ListFilesAtCommit(hashStr string) ([]string, error) {
	return r.goGit.ListFilesAtCommit(hashStr)
}

func (r *Repository) ResetToCommit(hashStr string, mode string) error {
	return r.goGit.ResetToCommit(hashStr, mode)
}

func (r *Repository) CheckoutCommit(hashStr string) error {
	return r.goGit.CheckoutCommit(hashStr)
}

func (r *Repository) LogAll(max int) ([]CommitInfo, error) {
	return r.goGit.LogAll(max)
}

func (r *Repository) LogAllRaw(max int) (string, error) {
	return r.cli.LogAllRaw(max)
}
