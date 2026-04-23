package handler

import (
	"fmt"

	"intelligit-sidecar/internal/git"
	"intelligit-sidecar/internal/protocol"
)

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

	status, err := repo.Status()
	if err != nil {
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
		return fail(req.ID, err)
	}

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

// 以下命令暂未实现，先保留统一失败响应，确保主链路可编译可运行。
func handleCommit(req protocol.Request) protocol.Response {
	return protocol.Response{ID: req.ID, Success: false, Error: "commit 命令暂未实现"}
}

func handleRemote(req protocol.Request) protocol.Response {
	return protocol.Response{ID: req.ID, Success: false, Error: "remote 命令暂未实现"}
}

func handleBranch(req protocol.Request) protocol.Response {
	return protocol.Response{ID: req.ID, Success: false, Error: "branch 命令暂未实现"}
}

func handleDiff(req protocol.Request) protocol.Response {
	return protocol.Response{ID: req.ID, Success: false, Error: "diff 命令暂未实现"}
}
