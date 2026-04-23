package handler

// ┌──────────────────────────────────────────────────────────────────────────────┐
// │                          Handler 实现                                        │
// │                                                                              │
// │  每个 handler 对应一个 Git 操作。handler 的职责：                              │
// │    1. 通过 ctx.Bind() 解析参数                                                │
// │    2. 通过 ctx.Repo() 获取仓库实例                                            │
// │    3. 调用 git 包的方法                                                       │
// │    4. 返回 (data, error)                                                     │
// │                                                                              │
// │  新增 handler 步骤：                                                          │
// │    1. 在本文件中编写 handler 函数                                              │
// │    2. 到 registry.go 中注册命令名称与 handler 的映射                           │
// │    3. （可选）到 Node 端 shared/types/sidecar.ts 中添加对应的类型定义           │
// └──────────────────────────────────────────────────────────────────────────────┘

import (
	"fmt"

	"intelligit-sidecar/internal/git"
)

// ═══════════════════════════════════════════════════════════════════════════════
//  仓库管理
// ═══════════════════════════════════════════════════════════════════════════════

func handleRepoOpen(ctx *Context) (any, error) {
	var params struct {
		Path string `json:"path"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}

	repo, err := git.Open(params.Path)
	if err != nil {
		return nil, err
	}

	// 在 Router 中设置当前仓库
	ctx.setRepoCallback(repo)

	return map[string]string{"path": repo.Path()}, nil
}

func handleRepoInit(ctx *Context) (any, error) {
	var params struct {
		Path string `json:"path"`
		Bare bool   `json:"bare"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}

	repo, err := git.Init(params.Path, params.Bare)
	if err != nil {
		return nil, err
	}

	ctx.setRepoCallback(repo)

	return map[string]string{"path": repo.Path()}, nil
}

func handleClone(ctx *Context) (any, error) {
	var params struct {
		URL    string `json:"url"`
		Path   string `json:"path"`
		Depth  int    `json:"depth"`
		Branch string `json:"branch"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.URL == "" {
		return nil, errMissingParam("url")
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}

	pw := NewProgressWriter(ctx.Notifier, ctx.RequestID)
	opts := &git.CloneOptions{
		Depth:    params.Depth,
		Branch:   params.Branch,
		Progress: pw,
	}

	repo, err := git.Clone(params.URL, params.Path, opts)
	if err != nil {
		return nil, err
	}

	ctx.setRepoCallback(repo)

	return map[string]string{"path": repo.Path()}, nil
}

func handleHead(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	hash, branch, err := repo.Head()
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"hash":   hash,
		"branch": branch,
	}, nil
}

func handleIsClean(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	clean, err := repo.IsClean()
	if err != nil {
		return nil, err
	}
	return map[string]bool{"clean": clean}, nil
}

// ═══════════════════════════════════════════════════════════════════════════════
//  暂存区
// ═══════════════════════════════════════════════════════════════════════════════

func handleStatus(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Status()
}

func handleAdd(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Path string `json:"path"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}
	return nil, repo.Add(params.Path)
}

func handleAddAll(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return nil, repo.AddAll()
}

func handleRemove(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Path string `json:"path"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}
	return nil, repo.Remove(params.Path)
}

func handleRestore(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Path string `json:"path"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}
	return nil, repo.Restore(params.Path)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  提交
// ═══════════════════════════════════════════════════════════════════════════════

func handleCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Message     string `json:"message"`
		AuthorName  string `json:"authorName"`
		AuthorEmail string `json:"authorEmail"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Message == "" {
		return nil, errMissingParam("message")
	}

	hash, err := repo.Commit(params.Message, params.AuthorName, params.AuthorEmail)
	if err != nil {
		return nil, err
	}
	return map[string]string{"hash": hash}, nil
}

func handleLog(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Max  int    `json:"max"`
		From string `json:"from"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}

	if params.From != "" {
		return repo.LogFrom(params.From, params.Max)
	}
	return repo.Log(params.Max)
}

func handleGetCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Hash string `json:"hash"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Hash == "" {
		return nil, errMissingParam("hash")
	}
	return repo.GetCommit(params.Hash)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  分支
// ═══════════════════════════════════════════════════════════════════════════════

func handleBranches(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Branches()
}

func handleRemoteBranches(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.RemoteBranches()
}

func handleCurrentBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	branch, err := repo.CurrentBranch()
	if err != nil {
		return nil, err
	}
	return map[string]string{"branch": branch}, nil
}

func handleCreateBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Name string `json:"name"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Name == "" {
		return nil, errMissingParam("name")
	}
	return nil, repo.CreateBranch(params.Name)
}

func handleDeleteBranch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Name string `json:"name"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Name == "" {
		return nil, errMissingParam("name")
	}
	return nil, repo.DeleteBranch(params.Name)
}

func handleCheckout(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Branch string `json:"branch"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Branch == "" {
		return nil, errMissingParam("branch")
	}
	return nil, repo.Checkout(params.Branch)
}

func handleCheckoutNew(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Branch string `json:"branch"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Branch == "" {
		return nil, errMissingParam("branch")
	}
	return nil, repo.CheckoutNewBranch(params.Branch)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  远程（支持进度推送）
// ═══════════════════════════════════════════════════════════════════════════════

// authParams 远程操作共用的认证参数
type authParams struct {
	Remote      string `json:"remote"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	SSHKeyPath  string `json:"sshKeyPath"`
	SSHPassword string `json:"sshPassword"`
}

// toAuthMethod 将 authParams 转换为 git.AuthMethod
func (a *authParams) toAuthMethod() *git.AuthMethod {
	if a.Username == "" && a.Password == "" && a.SSHKeyPath == "" {
		return nil
	}
	return &git.AuthMethod{
		Username:    a.Username,
		Password:    a.Password,
		SSHKeyPath:  a.SSHKeyPath,
		SSHPassword: a.SSHPassword,
	}
}

func handleRemotes(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.Remotes()
}

func handleAddRemote(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Name == "" {
		return nil, errMissingParam("name")
	}
	if params.URL == "" {
		return nil, errMissingParam("url")
	}
	return nil, repo.AddRemote(params.Name, params.URL)
}

func handleRemoveRemote(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Name string `json:"name"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Name == "" {
		return nil, errMissingParam("name")
	}
	return nil, repo.RemoveRemote(params.Name)
}

func handleFetch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params authParams
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	remote := params.Remote
	if remote == "" {
		remote = "origin"
	}

	pw := NewProgressWriter(ctx.Notifier, ctx.RequestID)
	return nil, repo.Fetch(remote, params.toAuthMethod(), pw)
}

func handlePull(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params authParams
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	remote := params.Remote
	if remote == "" {
		remote = "origin"
	}

	pw := NewProgressWriter(ctx.Notifier, ctx.RequestID)
	return nil, repo.Pull(remote, params.toAuthMethod(), pw)
}

func handlePush(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params authParams
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	remote := params.Remote
	if remote == "" {
		remote = "origin"
	}

	pw := NewProgressWriter(ctx.Notifier, ctx.RequestID)
	return nil, repo.Push(remote, params.toAuthMethod(), pw)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Diff
// ═══════════════════════════════════════════════════════════════════════════════

func handleDiffCommits(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		HashA string `json:"hashA"`
		HashB string `json:"hashB"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.HashA == "" || params.HashB == "" {
		return nil, errMissingParam("hashA / hashB")
	}
	return repo.DiffCommits(params.HashA, params.HashB)
}

func handleDiffWithParent(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Hash string `json:"hash"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Hash == "" {
		return nil, errMissingParam("hash")
	}
	return repo.DiffWithParent(params.Hash)
}

func handleGetCommitPatch(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Hash string `json:"hash"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Hash == "" {
		return nil, errMissingParam("hash")
	}
	return repo.GetCommitPatch(params.Hash)
}

func handleFileContentAtCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Hash string `json:"hash"`
		Path string `json:"path"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Hash == "" {
		return nil, errMissingParam("hash")
	}
	if params.Path == "" {
		return nil, errMissingParam("path")
	}
	content, err := repo.FileContentAtCommit(params.Hash, params.Path)
	if err != nil {
		return nil, err
	}
	return map[string]string{"content": content}, nil
}

func handleListFilesAtCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	var params struct {
		Hash string `json:"hash"`
	}
	if err := ctx.Bind(&params); err != nil {
		return nil, err
	}
	if params.Hash == "" {
		return nil, errMissingParam("hash")
	}
	return repo.ListFilesAtCommit(params.Hash)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

func errMissingParam(name string) error {
	return fmt.Errorf("缺少必填参数: %s", name)
}
