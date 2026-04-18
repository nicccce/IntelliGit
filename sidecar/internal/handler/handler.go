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
// Handle 将请求路由到对应命令处理逻辑。
func Handle(req protocol.Request) protocol.Response {
	switch req.Command {
	//1.获取仓库状态
	case "status":
		return handleStatus(req)
	//2.获取提交历史
	case "log":
		return handleLog(req)
	//3.提交变更
	case "commit":
		return handleCommit(req)
	//4.获取远程仓库信息
	case "remote":
		return handleRemote(req)
	//5.获取分支信息
	case "branch":
		return handleBranch(req)
	//6.获取文件差异
	case "diff":
		return handleDiff(req)
	default:
		return protocol.Response{
			ID:      req.ID,
			Success: false,
			Error:   fmt.Sprintf("不支持的命令: %s", req.Command),
		}
	}
}

func handleStatus(req protocol.Request) protocol.Response {
	repoPath := getRepoPath(req.Payload)

	repo, err := git.Open(repoPath)
	if err != nil {
		return fail(req.ID, err)
	}

	repoPath, err := getString(req.Params, "repoPath")
	status, err := repo.Status()
	if err != nil {
		return d.fail(req.ID, -32602, err.Error())
	}
		return fail(req.ID, err)
	}

	return protocol.Response{
		ID:      req.ID,
		Success: true,
		Data:    status,
	}
}

func handleLog(req protocol.Request) protocol.Response {
	repoPath := getRepoPath(req.Payload)
	maxEntries := getMaxEntries(req.Payload)

	repo, err := git.Open(repoPath)
	if err != nil {
		return d.fail(req.ID, -32010, err.Error())
		return fail(req.ID, err)
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
	logs, err := repo.Log(maxEntries)
	if err != nil {
		return fail(req.ID, err)
	}

	return protocol.Response{
		ID:      req.ID,
		Success: true,
		Data:    logs,
	}
}

func getRepoPath(payload map[string]interface{}) string {
	if payload == nil {
		return "."
	}
	v, ok := payload["repoPath"]
	if !ok {
		return "."
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return "."
	}
	return s
}

func getMaxEntries(payload map[string]interface{}) int {
	if payload == nil {
		return 20
	}
	v, ok := payload["maxEntries"]
	if !ok {
		return 20
	}

	// encoding/json 默认会把数字解到 float64
	if n, ok := v.(float64); ok {
		if n <= 0 {
			return 20
		}
		return int(n)
	}

	if n, ok := v.(int); ok {
		if n <= 0 {
			return 20
		}
		return n
	}

	return 20
}

func fail(id string, err error) protocol.Response {
	return protocol.Response{
		ID:      id,
		Success: false,
		Error:   err.Error(),
	}
}
