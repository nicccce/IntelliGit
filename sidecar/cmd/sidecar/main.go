package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"intelligit-sidecar/internal/handler"
	"intelligit-sidecar/internal/protocol"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var req protocol.Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			_ = encoder.Encode(protocol.Response{
				ID:      "",
				Success: false,
				Error:   fmt.Sprintf("请求 JSON 解析失败: %v", err),
			})
			continue
		}

		resp := handler.Handle(req)
		if err := encoder.Encode(resp); err != nil {
			fmt.Fprintf(os.Stderr, "响应写入失败: %v\n", err)
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "stdin 读取失败: %v\n", err)
	}
}
