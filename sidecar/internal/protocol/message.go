// Package protocol 定义 Sidecar 的 IPC 通信协议。
//
// 消息格式：每条消息是一行 JSON，以 \n 分隔。
// 消息分三类：
//   - Request  — 来自 Node 主进程的请求（带 ID）
//   - Response — 返回给 Node 的响应（带 ID，与 Request 配对）
//   - Notification — Go 主动推送给 Node（无 ID，单向）
//
// ┌──────────── 如何新增接口 ────────────┐
// │ 本文件只定义通信协议的数据结构,       │
// │ 新增接口请到 handler/registry.go 注册 │
// └─────────────────────────────────────┘
package protocol

import "encoding/json"

// ─── 请求 ──────────────────────────────────────────────────────────────────────

// Request 来自 Node 主进程的请求。
type Request struct {
	// ID 唯一请求标识，用于匹配异步响应。
	ID string `json:"id"`

	// Command 命令名称，格式为 "模块.方法"，例如 "repo.open"、"staging.status"。
	Command string `json:"command"`

	// Payload 命令携带的参数，延迟解析为具体结构体。
	Payload json.RawMessage `json:"payload,omitempty"`
}

// ─── 响应 ──────────────────────────────────────────────────────────────────────

// Response 返回给 Node 主进程的响应。
type Response struct {
	// ID 对应 Request 的 ID。
	ID string `json:"id"`

	// Success 是否执行成功。
	Success bool `json:"success"`

	// Data 成功时的返回数据（可以是任意 JSON 序列化后的值）。
	Data any `json:"data,omitempty"`

	// Error 失败时的错误信息。
	Error string `json:"error,omitempty"`
}

// ─── 通知（Go → Node 推送） ────────────────────────────────────────────────────

// Notification Go 侧主动推送给 Node 的通知消息。
// 与 Response 不同，Notification 没有 ID，Node 无需回复。
type Notification struct {
	// Type 固定为 "notification"，用于 Node 侧区分消息类型。
	Type string `json:"type"`

	// Event 事件名称，例如 "progress"。
	Event string `json:"event"`

	// Data 事件携带的数据。
	Data any `json:"data,omitempty"`
}

// ─── 通知数据载荷 ──────────────────────────────────────────────────────────────

// ProgressData 进度推送的数据载荷。
// 用于 push / pull / fetch / clone 等支持进度报告的操作。
type ProgressData struct {
	// RequestID 关联的请求 ID，前端可据此将进度与特定操作关联。
	RequestID string `json:"requestId"`

	// Message 进度文本（来自 go-git 的输出，如 "Counting objects: 50%"）。
	Message string `json:"message"`
}
