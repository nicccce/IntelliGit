// Package main 是 IntelliGit Sidecar 的入口。
//
// 启动后进入主循环：
//  1. 从 stdin 读取 JSON 行请求
//  2. 通过 Router 分发到对应的 handler
//  3. 将响应写入 stdout
//  4. stdin 关闭（EOF）时优雅退出
//
// 日志输出到 stderr，不会干扰 stdout 上的协议数据。
package main

import (
	"io"
	"log"
	"os"

	"intelligit-sidecar/internal/handler"
	"intelligit-sidecar/internal/protocol"
)

func main() {
	// 日志输出到 stderr，避免污染 stdout 协议通道
	log.SetOutput(os.Stderr)
	log.SetPrefix("[sidecar] ")
	log.Println("IntelliGit Sidecar 启动")

	// 创建协议编解码器（stdin 读，stdout 写）
	codec := protocol.NewCodec(os.Stdin, os.Stdout)

	// 创建通知器和路由器
	notifier := handler.NewNotifier(codec)
	router := handler.NewRouter(notifier)

	// 注册所有命令
	handler.RegisterAll(router)

	log.Println("就绪，等待请求...")

	// 主循环：读取请求 → 分发 → 响应
	for {
		req, err := codec.ReadRequest()
		if err != nil {
			if err == io.EOF {
				log.Println("stdin 已关闭，准备退出")
				break
			}
			log.Printf("读取请求失败: %v", err)
			continue
		}

		log.Printf("收到请求: id=%s command=%s", req.ID, req.Command)

		// 分发请求并获取响应
		resp := router.Dispatch(req)

		// 写入响应
		if err := codec.WriteResponse(resp); err != nil {
			log.Printf("写入响应失败: %v", err)
		}

		if resp.Success {
			log.Printf("请求完成: id=%s ✓", req.ID)
		} else {
			log.Printf("请求失败: id=%s error=%s", req.ID, resp.Error)
		}
	}

	log.Println("IntelliGit Sidecar 已退出")
}
