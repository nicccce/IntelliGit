package handler

import (
	"log"

	"intelligit-sidecar/internal/protocol"
)

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
