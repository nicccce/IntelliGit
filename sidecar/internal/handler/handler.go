package handler

import (
	"fmt"
	"strings"
	"strconv"

	"intelligit-sidecar/internal/git"
	"intelligit-sidecar/internal/protocol"
)

// Dispatcher 负责将 command 路由到具体 Git 操作。
type Dispatcher struct{}

// Handle 处理单条请求并返回响应对象。
func (d *Dispatcher) Handle(req *protocol.Request) *protocol.Response {
	if req == nil {
		return &protocol.Response{
			JSONRPC: "2.0",
			ID:      "",
			Error: &protocol.ErrorObject{
				Code:    -32600,
				Message: "请求为空",
			},
		}
	}

	if req.JSONRPC != "2.0" {
		return d.fail(req.ID, -32600, "仅支持 jsonrpc=2.0")
	}

	if req.Method == "" {
		return d.fail(req.ID, -32600, "method 不能为空")
	}

	command, err := normalizeMethod(req.Method)
	if err != nil {
		return d.fail(req.ID, -32601, err.Error())
	}

	switch command {
	case "ping":
		return d.ok(req.ID, map[string]string{"message": "pong"})
	case "shutdown":
		return d.ok(req.ID, map[string]string{"message": "bye"})
	}

	repoPath, err := getString(req.Params, "repoPath")
	if err != nil {
		return d.fail(req.ID, -32602, err.Error())
	}

	repo, err := git.Open(repoPath)
	if err != nil {
		return d.fail(req.ID, -32010, err.Error())
	}

	switch command {
	case "status":
		files, err := repo.Status()
		if err != nil {
			return d.fail(req.ID, -32011, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"files": files})

	case "add":
		path, err := getString(req.Params, "path")
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		if err := repo.Add(path); err != nil {
			return d.fail(req.ID, -32012, err.Error())
		}
		return d.ok(req.ID, map[string]string{"message": "ok"})

	case "addAll":
		if err := repo.AddAll(); err != nil {
			return d.fail(req.ID, -32012, err.Error())
		}
		return d.ok(req.ID, map[string]string{"message": "ok"})

	case "log":
		max, err := getIntDefault(req.Params, "max", 30)
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		commits, err := repo.Log(max)
		if err != nil {
			return d.fail(req.ID, -32013, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"commits": commits})

	case "commit":
		message, err := getString(req.Params, "message")
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		authorName, err := getString(req.Params, "authorName")
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		authorEmail, err := getString(req.Params, "authorEmail")
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		hash, err := repo.Commit(message, authorName, authorEmail)
		if err != nil {
			return d.fail(req.ID, -32014, err.Error())
		}
		return d.ok(req.ID, map[string]string{"hash": hash})

	case "branches":
		branches, err := repo.Branches()
		if err != nil {
			return d.fail(req.ID, -32015, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"branches": branches})

	case "currentBranch":
		name, err := repo.CurrentBranch()
		if err != nil {
			return d.fail(req.ID, -32015, err.Error())
		}
		return d.ok(req.ID, map[string]string{"name": name})

	case "diffWithParent":
		hash, err := getString(req.Params, "hash")
		if err != nil {
			return d.fail(req.ID, -32602, err.Error())
		}
		entries, err := repo.DiffWithParent(hash)
		if err != nil {
			return d.fail(req.ID, -32016, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"entries": entries})

	case "remotes":
		remotes, err := repo.Remotes()
		if err != nil {
			return d.fail(req.ID, -32017, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"remotes": remotes})

	default:
		return d.fail(req.ID, -32601, fmt.Sprintf("未知命令: %s", command))
	}
}

func (d *Dispatcher) ok(id string, data interface{}) *protocol.Response {
	return &protocol.Response{
		JSONRPC: "2.0",
		ID:      id,
		Result:  data,
	}
}

func (d *Dispatcher) fail(id string, code int, message string) *protocol.Response {
	return &protocol.Response{
		JSONRPC: "2.0",
		ID:      id,
		Error: &protocol.ErrorObject{
			Code:    code,
			Message: message,
		},
	}
}

func normalizeMethod(method string) (string, error) {
	if method == "ping" || method == "shutdown" {
		return method, nil
	}
	if !strings.HasPrefix(method, "git/") {
		return "", fmt.Errorf("method 不合法: %s（应为 git/<command>）", method)
	}
	command := strings.TrimPrefix(method, "git/")
	if command == "" {
		return "", fmt.Errorf("method 不合法: %s（缺少 command）", method)
	}
	return command, nil
}

func getString(payload map[string]interface{}, key string) (string, error) {
	if payload == nil {
		return "", fmt.Errorf("缺少 payload")
	}
	raw, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("payload 缺少字段: %s", key)
	}
	value, ok := raw.(string)
	if !ok || value == "" {
		return "", fmt.Errorf("payload.%s 必须为非空字符串", key)
	}
	return value, nil
}

func getIntDefault(payload map[string]interface{}, key string, defaultVal int) (int, error) {
	if payload == nil {
		return defaultVal, nil
	}
	raw, ok := payload[key]
	if !ok || raw == nil {
		return defaultVal, nil
	}

	switch v := raw.(type) {
	case float64:
		return int(v), nil
	case int:
		return v, nil
	case string:
		n, err := strconv.Atoi(v)
		if err != nil {
			return 0, fmt.Errorf("payload.%s 不是合法数字", key)
		}
		return n, nil
	default:
		return 0, fmt.Errorf("payload.%s 类型错误", key)
	}
}
