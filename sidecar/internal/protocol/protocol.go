package protocol

// Request 表示从 stdin 读取的一条请求。
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

// Response 表示写入 stdout 的一条响应。
type Response struct {
	JSONRPC string       `json:"jsonrpc"`
	ID      string       `json:"id"`
	Result  interface{}  `json:"result,omitempty"`
	Error   *ErrorObject `json:"error,omitempty"`
}
