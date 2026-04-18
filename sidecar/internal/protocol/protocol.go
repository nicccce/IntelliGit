package protocol

// Request 表示从 stdin 读取的一条请求。
type Request struct {
	ID      string                 `json:"id"`
	Command string                 `json:"command"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Response 表示写入 stdout 的一条响应。
type Response struct {
	ID      string      `json:"id"`
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}
