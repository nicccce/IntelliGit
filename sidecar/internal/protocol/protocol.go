package protocol

import "encoding/json"

// Request 表示主进程发往 Sidecar 的单条命令。
type Request struct {
	ID      string                 `json:"id"`
	Command string                 `json:"command"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Response 表示 Sidecar 返回给主进程的结果。
type Response struct {
	ID      string      `json:"id"`
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// DecodeRequest 解析一行 JSON 请求。
func DecodeRequest(line []byte) (*Request, error) {
	var req Request
	if err := json.Unmarshal(line, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

// EncodeResponse 将响应编码为 JSON。
func EncodeResponse(resp *Response) ([]byte, error) {
	return json.Marshal(resp)
}
