package git

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// RunLocalMerge 执行本地 git merge。网络认证由 go-git fetch/pull 阶段处理。
func (r *gitCliBackend) RunLocalMerge(progress io.Writer, ref string) error {
	output, err := r.runner.run(gitCliRunRequest{
		Dir:      r.path,
		Args:     []string{"merge", "--no-edit", ref},
		Progress: progress,
	})
	if err == nil {
		return nil
	}

	message := strings.TrimSpace(output)
	if message == "" {
		message = err.Error()
	}
	if strings.Contains(message, "CONFLICT") || strings.Contains(message, "Automatic merge failed") {
		return &MergeConflictError{
			Info: MergeConflictInfo{
				ConflictedFiles: parseConflictedFiles(message),
				Message:         message,
				MergingBranch:   ref,
			},
		}
	}
	return fmt.Errorf("merge 失败: %s", message)
}

// MergeStatus 检查当前仓库是否处于 merge 中间状态。
func (r *gitCliBackend) MergeStatus() (*MergeStatusResult, error) {
	result := &MergeStatusResult{}

	data, err := os.ReadFile(filepath.Join(r.path, ".git", "MERGE_HEAD"))
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return nil, fmt.Errorf("检查 merge 状态失败: %w", err)
	}

	result.Merging = true
	result.MergeHead = strings.TrimSpace(string(data))

	output, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"diff", "--name-only", "--diff-filter=U"},
	})
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
			if line != "" {
				result.ConflictedFiles = append(result.ConflictedFiles, line)
			}
		}
	}

	return result, nil
}

// MergeAbort 放弃当前正在进行的 merge。
func (r *gitCliBackend) MergeAbort() error {
	output, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"merge", "--abort"},
	})
	if err != nil {
		return gitCliError("merge abort 失败", output, err)
	}
	return nil
}

// MergeContinue 在用户解决完冲突并 add 后，完成 merge 提交。
func (r *gitCliBackend) MergeContinue(message string) error {
	args := []string{"commit", "--no-edit"}
	if message != "" {
		args = []string{"commit", "-m", message}
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: args,
	})
	if err != nil {
		return gitCliError("merge continue 失败", output, err)
	}
	return nil
}

// ShowObject 运行 git show <ref>，常用于读取 index stage 内容（如 :1:path, :2:path, :3:path）。
func (r *gitCliBackend) ShowObject(ref string) (string, error) {
	output, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"show", ref},
	})
	if err != nil {
		return "", fmt.Errorf("git show %s 失败: %w", ref, err)
	}
	return output, nil
}

// ResolveConflict 将解决后的内容写入工作区文件，然后 git add 标记冲突已解决。
func (r *gitCliBackend) ResolveConflict(filePath, content string) error {
	fullPath := filepath.Join(r.path, filepath.FromSlash(filePath))
	if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	output, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"add", filePath},
	})
	if err != nil {
		return gitCliError("git add 失败", output, err)
	}
	return nil
}
