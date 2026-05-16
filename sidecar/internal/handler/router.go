// Package handler 实现 Sidecar 的命令路由与处理逻辑。
package handler

import (
	"fmt"

	"intelligit-sidecar/internal/git"
	"intelligit-sidecar/internal/protocol"
)

// HandlerFunc 是命令处理函数的签名。
//
//   - ctx: 包含请求参数和通知推送能力
//   - 返回值: (数据, 错误)
//
// 返回的数据会被自动序列化为 JSON 放入 Response.Data。
// 返回非 nil 错误时，Response.Success=false，错误信息放入 Response.Error。
type HandlerFunc func(ctx *Context) (any, error)

// Router 管理 command → HandlerFunc 的映射并执行分发。
type Router struct {
	handlers map[string]HandlerFunc
	repo     *git.Repository // 当前打开的仓库
	notifier *Notifier
}

// NewRouter 创建一个新的路由器。
func NewRouter(notifier *Notifier) *Router {
	return &Router{
		handlers: make(map[string]HandlerFunc),
		notifier: notifier,
	}
}

// Register 注册一个命令处理函数。
//
//   - command: 命令名称，格式 "模块.方法"，如 "repo.open"
//   - handler: 处理函数
func (r *Router) Register(command string, handler HandlerFunc) {
	r.handlers[command] = handler
}

// SetRepo 设置当前打开的仓库（由 repo.open / repo.init / clone 调用）。
func (r *Router) SetRepo(repo *git.Repository) {
	r.repo = repo
}

// GetRepo 获取当前打开的仓库。
func (r *Router) GetRepo() *git.Repository {
	return r.repo
}

// Dispatch 根据 Request.Command 查找并执行对应的 handler。
// 返回 Response（始终非 nil）。
func (r *Router) Dispatch(req *protocol.Request) *protocol.Response {
	handler, ok := r.handlers[req.Command]
	if !ok {
		return &protocol.Response{
			ID:      req.ID,
			Success: false,
			Error:   fmt.Sprintf("未知命令: %s", req.Command),
		}
	}

	ctx := &Context{
		RequestID:  req.ID,
		RawPayload: req.Payload,
		Notifier:   r.notifier,
		repo:       r.repo,
		setRepoFn:  r.SetRepo,
	}

	data, err := handler(ctx)
	if err != nil {
		return &protocol.Response{
			ID:      req.ID,
			Success: false,
			Error:   err.Error(),
		}
	}

	return &protocol.Response{
		ID:      req.ID,
		Success: true,
		Data:    data,
	}
}
