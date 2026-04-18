package handler

import (
	"fmt"
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
			ID:      "",
			Success: false,
			Error:   "请求为空",
		}
	}

	if req.Command == "" {
		return d.fail(req.ID, "command 不能为空")
	}

	switch req.Command {
	case "ping":
		return d.ok(req.ID, map[string]string{"message": "pong"})
	case "shutdown":
		return d.ok(req.ID, map[string]string{"message": "bye"})
	}

	repoPath, err := getString(req.Payload, "repoPath")
	if err != nil {
		return d.fail(req.ID, err.Error())
	}

	repo, err := git.Open(repoPath)
	if err != nil {
		return d.fail(req.ID, err.Error())
	}

	switch req.Command {
	case "status":
		files, err := repo.Status()
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"files": files})

	case "add":
		path, err := getString(req.Payload, "path")
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		if err := repo.Add(path); err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]string{"message": "ok"})

	case "addAll":
		if err := repo.AddAll(); err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]string{"message": "ok"})

	case "log":
		max, err := getIntDefault(req.Payload, "max", 30)
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		commits, err := repo.Log(max)
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"commits": commits})

	case "commit":
		message, err := getString(req.Payload, "message")
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		authorName, err := getString(req.Payload, "authorName")
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		authorEmail, err := getString(req.Payload, "authorEmail")
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		hash, err := repo.Commit(message, authorName, authorEmail)
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]string{"hash": hash})

	case "branches":
		branches, err := repo.Branches()
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"branches": branches})

	case "currentBranch":
		name, err := repo.CurrentBranch()
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]string{"name": name})

	case "diffWithParent":
		hash, err := getString(req.Payload, "hash")
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		entries, err := repo.DiffWithParent(hash)
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"entries": entries})

	case "remotes":
		remotes, err := repo.Remotes()
		if err != nil {
			return d.fail(req.ID, err.Error())
		}
		return d.ok(req.ID, map[string]interface{}{"remotes": remotes})

	default:
		return d.fail(req.ID, fmt.Sprintf("未知命令: %s", req.Command))
	}
}

func (d *Dispatcher) ok(id string, data interface{}) *protocol.Response {
	return &protocol.Response{
		ID:      id,
		Success: true,
		Data:    data,
	}
}

func (d *Dispatcher) fail(id string, message string) *protocol.Response {
	return &protocol.Response{
		ID:      id,
		Success: false,
		Error:   message,
	}
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
