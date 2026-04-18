package protocol

import "encoding/json"

// Request 表示主进程发往 Sidecar 的单条命令。
type Request struct {
	JSONRPC string                 `json:"jsonrpc"`
	ID      string                 `json:"id"`
	Method  string                 `json:"method"`
	Params  map[string]interface{} `json:"params,omitempty"`
}

// ErrorObject 表示 JSON-RPC 标准错误对象。
type ErrorObject struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Response 表示 Sidecar 返回给主进程的结果。
type Response struct {
	JSONRPC string       `json:"jsonrpc"`
	ID      string       `json:"id"`
	Result  interface{}  `json:"result,omitempty"`
	Error   *ErrorObject `json:"error,omitempty"`
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
