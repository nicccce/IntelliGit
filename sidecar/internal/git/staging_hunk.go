package git

import (
	"fmt"
	"strings"
)

// ApplyPatch 将构造好的 unified diff patch 应用到暂存区（git apply --cached）
// 这是实现 hunk 级和行级暂存的核心方法。
// 前端负责根据用户的选择（整块暂存或选择行暂存）构造对应的 unified diff 文本。
func (r *gitCliBackend) ApplyPatch(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir:   r.path,
		Args:  []string{"apply", "--cached", "--unidiff-zero", "-"},
		Stdin: strings.NewReader(patchContent),
	})
	if err != nil {
		return gitCliError("git apply --cached 失败", output, err)
	}
	return nil
}

// UnstageHunk 将构造好的 unified diff patch 从暂存区移除（git apply --cached --reverse）
// 用于取消已暂存的 hunk
func (r *gitCliBackend) UnstageHunk(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir:   r.path,
		Args:  []string{"apply", "--cached", "--unidiff-zero", "--reverse", "-"},
		Stdin: strings.NewReader(patchContent),
	})
	if err != nil {
		return gitCliError("git apply --cached --reverse 失败", output, err)
	}
	return nil
}

// DiscardHunk 丢弃工作区中的指定 hunk（git apply --reverse）
func (r *gitCliBackend) DiscardHunk(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir:   r.path,
		Args:  []string{"apply", "--unidiff-zero", "--reverse", "-"},
		Stdin: strings.NewReader(patchContent),
	})
	if err != nil {
		return gitCliError("git apply --reverse 失败", output, err)
	}
	return nil
}

// DiffWorkdirRaw 获取原始的 unified diff 输出（git diff），用于前端构造 patch
func (r *gitCliBackend) DiffWorkdirRaw(filePath string) (string, error) {
	args := []string{"diff"}
	if filePath != "" {
		args = append(args, "--", filePath)
	}

	output, err := r.runner.run(gitCliRunRequest{Dir: r.path, Args: args})
	if err != nil {
		return "", gitCliError("git diff 失败", output, err)
	}
	return output, nil
}

// DiffStagedRaw 获取原始的 staged unified diff 输出（git diff --staged）
func (r *gitCliBackend) DiffStagedRaw(filePath string) (string, error) {
	args := []string{"diff", "--staged"}
	if filePath != "" {
		args = append(args, "--", filePath)
	}

	output, err := r.runner.run(gitCliRunRequest{Dir: r.path, Args: args})
	if err != nil {
		return "", gitCliError("git diff --staged 失败", output, err)
	}
	return output, nil
}
