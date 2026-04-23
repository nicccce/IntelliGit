package handler

import "io"

// ProgressWriter 实现 io.Writer 接口，将 go-git 的进度输出转换为 Notification 推送。
//
// go-git 的 Push / Pull / Fetch / Clone 操作接受一个 io.Writer 参数用于输出进度信息。
// 本 Writer 每次收到写入时，将其打包为进度通知发送到 Node 侧，
// 前端可通过 requestID 将进度与具体操作关联。
//
// 用法示例（在 handler 中）：
//
//	pw := NewProgressWriter(ctx.Notifier, ctx.RequestID)
//	err := repo.Push("origin", auth, pw)
type ProgressWriter struct {
	notifier  *Notifier
	requestID string
}

// NewProgressWriter 创建进度写入器。
//
//   - notifier:  用于推送通知的 Notifier 实例
//   - requestID: 关联的请求 ID
func NewProgressWriter(notifier *Notifier, requestID string) *ProgressWriter {
	return &ProgressWriter{
		notifier:  notifier,
		requestID: requestID,
	}
}

// Write 实现 io.Writer 接口。
// 每次 go-git 写入进度文本时，自动推送进度通知。
func (pw *ProgressWriter) Write(p []byte) (n int, err error) {
	message := string(p)
	if message != "" {
		pw.notifier.SendProgress(pw.requestID, message)
	}
	return len(p), nil
}

// 编译时断言：确保 ProgressWriter 实现了 io.Writer
var _ io.Writer = (*ProgressWriter)(nil)
