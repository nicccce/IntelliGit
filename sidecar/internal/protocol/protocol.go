package protocol

import "strings"

// Request 表示从 stdin 读取的一条请求。
type Request struct {
	// 兼容 JSON-RPC 2.0
	JSONRPC string                 `json:"jsonrpc,omitempty"`
	Method  string                 `json:"method,omitempty"`
	Params  map[string]interface{} `json:"params,omitempty"`

	// 兼容自定义协议
	ID      string                 `json:"id"`
	Command string                 `json:"command,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Response 表示写入 stdout 的一条响应。
type Response struct {
	ID      string      `json:"id"`
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// Normalize 将请求归一化为 command/payload 形式，兼容 JSON-RPC 与旧协议。
func (r *Request) Normalize() {
	// 优先使用 command；为空时从 method 推导（如 "git/status" -> "status"）
	if strings.TrimSpace(r.Command) == "" {
		method := strings.TrimSpace(r.Method)
		if method != "" {
			if idx := strings.LastIndex(method, "/"); idx >= 0 && idx < len(method)-1 {
				r.Command = strings.TrimSpace(method[idx+1:])
			} else {
				r.Command = method
			}
		}
	}

	// payload 为空时，回退到 params
	if r.Payload == nil && r.Params != nil {
		r.Payload = r.Params
	}
}
