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

		req, err := protocol.DecodeRequest(line)
		if err != nil {
			writeResponse(writer, &protocol.Response{
				JSONRPC: "2.0",
				ID:      "",
				Error: &protocol.ErrorObject{
					Code:    -32700,
					Message: fmt.Sprintf("请求 JSON 解析失败: %v", err),
				},
			})
			continue
		}

		resp := dispatcher.Handle(req)
		writeResponse(writer, resp)

		if req.Method == "shutdown" || req.Method == "git/shutdown" {
			return
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "stdin 读取失败: %v\n", err)
	}
}
