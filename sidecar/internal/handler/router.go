// Package handler 实现 Sidecar 的命令路由与处理逻辑。
//
// 核心概念：
//   - Router:      命令路由器，管理 command → handler 的映射
//   - HandlerFunc: 命令处理函数签名
//   - Context:     传递给每个 handler 的上下文，包含参数解析和通知推送能力
//   - Notifier:    允许 handler 向 Node 侧推送通知（如进度条）
package handler

import (
	"encoding/json"
	"fmt"
	"log"

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

// ─── Context ───────────────────────────────────────────────────────────────────

// Context 封装每次请求的上下文信息，传递给 HandlerFunc。
type Context struct {
	// RequestID 当前请求的 ID（可用于关联进度通知）
	RequestID string

	// RawPayload 原始的 JSON 参数，handler 通过 Bind() 解析到目标结构体
	RawPayload json.RawMessage

	// Notifier 用于向 Node 侧推送通知
	Notifier *Notifier

	// repo 当前打开的仓库引用（由 Router 注入）
	repo *git.Repository

	// setRepoFn 回调函数，用于 repo.open / repo.init / clone handler 更新 Router 的 repo
	setRepoFn func(repo *git.Repository)
}

// Bind 将 RawPayload 解析到目标结构体。
//
// 用法示例：
//
//	var params struct {
//	    Path string `json:"path"`
//	}
//	if err := ctx.Bind(&params); err != nil {
//	    return nil, err
//	}
func (c *Context) Bind(target any) error {
	if len(c.RawPayload) == 0 {
		return nil // 无参数时不报错，让 handler 自行检查必填字段
	}
	if err := json.Unmarshal(c.RawPayload, target); err != nil {
		return fmt.Errorf("参数解析失败: %w", err)
	}
	return nil
}

// Repo 获取当前打开的仓库。
// 如果尚未通过 repo.open 打开仓库，返回错误。
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

// ─── Notifier ──────────────────────────────────────────────────────────────────

// Notifier 提供向 Node 侧推送通知的能力。
type Notifier struct {
	codec *protocol.Codec
}

// NewNotifier 创建一个新的 Notifier。
func NewNotifier(codec *protocol.Codec) *Notifier {
	return &Notifier{codec: codec}
}

// SendProgress 推送进度通知。
func (n *Notifier) SendProgress(requestID, message string) {
	notif := &protocol.Notification{
		Type:  "notification",
		Event: "progress",
		Data: protocol.ProgressData{
			RequestID: requestID,
			Message:   message,
		},
	}
	if err := n.codec.WriteNotification(notif); err != nil {
		log.Printf("[Notifier] 推送进度通知失败: %v", err)
	}
}

// SendEvent 推送自定义事件通知。
func (n *Notifier) SendEvent(event string, data any) {
	notif := &protocol.Notification{
		Type:  "notification",
		Event: event,
		Data:  data,
	}
	if err := n.codec.WriteNotification(notif); err != nil {
		log.Printf("[Notifier] 推送事件通知失败 (%s): %v", event, err)
	}
}

// ─── Router ────────────────────────────────────────────────────────────────────

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
