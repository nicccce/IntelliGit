package main

import (
	"bufio"
	"fmt"
	"os"

	"intelligit-sidecar/internal/handler"
	"intelligit-sidecar/internal/protocol"
)

func main() {
	dispatcher := &handler.Dispatcher{}
	scanner := bufio.NewScanner(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		req, err := protocol.DecodeRequest(line)
		if err != nil {
			writeResponse(writer, &protocol.Response{
				ID:      "",
				Success: false,
				Error:   fmt.Sprintf("请求 JSON 解析失败: %v", err),
			})
			continue
		}

		resp := dispatcher.Handle(req)
		writeResponse(writer, resp)

		if req.Command == "shutdown" {
			return
		}
	}

	if err := scanner.Err(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[sidecar] stdin 读取失败: %v\n", err)
	}
}

func writeResponse(writer *bufio.Writer, resp *protocol.Response) {
	bytes, err := protocol.EncodeResponse(resp)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[sidecar] 响应编码失败: %v\n", err)
		return
	}
	if _, err := writer.Write(bytes); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[sidecar] 响应写入失败: %v\n", err)
		return
	}
	if err := writer.WriteByte('\n'); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[sidecar] 响应换行写入失败: %v\n", err)
		return
	}
	if err := writer.Flush(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[sidecar] 响应 flush 失败: %v\n", err)
	}
}
