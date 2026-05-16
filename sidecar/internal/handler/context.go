package handler

import (
	"encoding/json"
	"fmt"

	"intelligit-sidecar/internal/git"
)

// Context 封装每次请求的上下文信息，传递给 HandlerFunc。
type Context struct {
	// RequestID 当前请求的 ID（可用于关联进度通知）。
	RequestID string

	// RawPayload 原始的 JSON 参数，handler 通过 Bind 解析到命名 payload 结构。
	RawPayload json.RawMessage

	// Notifier 用于向 Node 侧推送通知。
	Notifier *Notifier

	// repo 当前打开的仓库引用（由 Router 注入）。
	repo *git.Repository

	// setRepoFn 供 repo.open / repo.init / repo.clone 更新 Router 当前仓库。
	setRepoFn func(repo *git.Repository)
}

// Bind 将 RawPayload 解析到目标结构体。
func (c *Context) Bind(target any) error {
	if len(c.RawPayload) == 0 {
		return nil
	}
	if err := json.Unmarshal(c.RawPayload, target); err != nil {
		return fmt.Errorf("参数解析失败: %w", err)
	}
	return nil
}

// Repo 获取当前打开的仓库。
func (c *Context) Repo() (*git.Repository, error) {
	if c.repo == nil {
		return nil, fmt.Errorf("尚未打开仓库，请先调用 repo.open")
	}
	return c.repo, nil
}

// setRepoCallback 供 handler 内部调用，更新 Router 的当前仓库。
func (c *Context) setRepoCallback(repo *git.Repository) {
	if c.setRepoFn != nil {
		c.setRepoFn(repo)
	}
}
