package handler

import (
	"fmt"
	"strings"
)

func registerMergeHandlers(r *Router) {
	r.Register(CommandMergeStatus, handleMergeStatus)
	r.Register(CommandMergeAbort, handleMergeAbort)
	r.Register(CommandMergeContinue, handleMergeContinue)
	r.Register(CommandMergeShadow, handleShadowMerge)
	r.Register(CommandMergeStageContent, handleMergeStageContent)
	r.Register(CommandConflictResolve, handleConflictResolve)
}

func handleMergeStatus(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return repo.MergeStatus()
}

func handleMergeAbort(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	return nil, repo.MergeAbort()
}

func handleMergeContinue(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[mergeContinuePayload](ctx)
	if err != nil {
		return nil, err
	}
	return nil, repo.MergeContinue(payload.Message)
}

func handleShadowMerge(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[shadowMergePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("targetBranch", payload.TargetBranch); err != nil {
		return nil, err
	}
	return repo.ShadowMerge(payload.TargetBranch)
}

// handleMergeStageContent 读取冲突文件在 git index 中的三个版本：
//   :1: → 共同祖先 (ancestor)
//   :2: → 当前分支 (ours / HEAD)
//   :3: → 被合并分支 (theirs / MERGE_HEAD)
func handleMergeStageContent(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[stageContentPayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}

	readStage := func(stage, path string) (string, bool) {
		ref := stage + path
		out, err := repo.ShowObject(ref)
		if err != nil {
			return "", false
		}
		// 简单探测：若包含 NUL 字节则视为二进制
		if strings.ContainsRune(out, 0) {
			return "", true
		}
		return out, false
	}

	ancestor, binA := readStage(":1:", payload.Path)
	ours, binO := readStage(":2:", payload.Path)
	theirs, binT := readStage(":3:", payload.Path)

	return stageContentResult{
		Ancestor: ancestor,
		Ours:     ours,
		Theirs:   theirs,
		Binary:   binA || binO || binT,
	}, nil
}

// handleConflictResolve 将解决后的内容写入文件，并执行 git add 标记已解决。
func handleConflictResolve(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}
	payload, err := bindPayload[conflictResolvePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("path", payload.Path); err != nil {
		return nil, err
	}
	if payload.Content == "" {
		return nil, fmt.Errorf("解决内容不能为空")
	}
	return nil, repo.ResolveConflict(payload.Path, payload.Content)
}
