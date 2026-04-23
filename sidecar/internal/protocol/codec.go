package protocol

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

// Codec 封装基于 JSON-Line 的编解码器。
//
// 读取端：从 reader（stdin）按行读取 JSON，解码为 Request。
// 写入端：将 Response / Notification 编码为 JSON 写入 writer（stdout），每条以 \n 结尾。
//
// 写入操作是线程安全的（使用 sync.Mutex），因为 handler 中的 goroutine
// 可能在处理请求的同时推送进度通知。
type Codec struct {
	scanner *bufio.Scanner
	encoder *json.Encoder
	writer  io.Writer
	mu      sync.Mutex // 保护 writer 的并发写入
}

// NewCodec 创建一个新的 Codec。
//
//   - reader: 通常传入 os.Stdin
//   - writer: 通常传入 os.Stdout
func NewCodec(reader io.Reader, writer io.Writer) *Codec {
	scanner := bufio.NewScanner(reader)
	// 默认 64KB 行缓冲可能不够（大 diff 的 payload），扩展到 10MB
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)

	return &Codec{
		scanner: scanner,
		encoder: json.NewEncoder(writer),
		writer:  writer,
	}
}

// ReadRequest 从 stdin 读取下一个 Request。
// 到达 EOF 时返回 io.EOF。
func (c *Codec) ReadRequest() (*Request, error) {
	if !c.scanner.Scan() {
		if err := c.scanner.Err(); err != nil {
			return nil, fmt.Errorf("读取 stdin 失败: %w", err)
		}
		// Scan 返回 false 且无 error，说明遇到了 EOF
		return nil, io.EOF
	}

	line := c.scanner.Bytes()
	if len(line) == 0 {
		// 跳过空行，递归读下一行
		return c.ReadRequest()
	}

	var req Request
	if err := json.Unmarshal(line, &req); err != nil {
		return nil, fmt.Errorf("解析请求 JSON 失败: %w (raw: %s)", err, string(line))
	}

	return &req, nil
}

// WriteResponse 将 Response 编码为 JSON 写入 stdout。
// 线程安全。
func (c *Codec) WriteResponse(resp *Response) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.encoder.Encode(resp)
}

// WriteNotification 将 Notification 编码为 JSON 写入 stdout。
// 线程安全。
func (c *Codec) WriteNotification(notif *Notification) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.encoder.Encode(notif)
}
