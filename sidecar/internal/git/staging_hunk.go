package git

import (
	"fmt"
	"os/exec"
	"strings"
)

// ApplyPatch 将构造好的 unified diff patch 应用到暂存区（git apply --cached）
// 这是实现 hunk 级和行级暂存的核心方法。
// 前端负责根据用户的选择（整块暂存或选择行暂存）构造对应的 unified diff 文本。
func (r *Repository) ApplyPatch(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	cmd := exec.Command("git", "apply", "--cached", "--unidiff-zero", "-")
	cmd.Dir = r.path
	cmd.Stdin = strings.NewReader(patchContent)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git apply --cached 失败: %s: %w", string(output), err)
	}
	return nil
}

// UnstageHunk 将构造好的 unified diff patch 从暂存区移除（git apply --cached --reverse）
// 用于取消已暂存的 hunk
func (r *Repository) UnstageHunk(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	cmd := exec.Command("git", "apply", "--cached", "--unidiff-zero", "--reverse", "-")
	cmd.Dir = r.path
	cmd.Stdin = strings.NewReader(patchContent)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git apply --cached --reverse 失败: %s: %w", string(output), err)
	}
	return nil
}

// DiscardHunk 丢弃工作区中的指定 hunk（git apply --reverse）
func (r *Repository) DiscardHunk(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	cmd := exec.Command("git", "apply", "--unidiff-zero", "--reverse", "-")
	cmd.Dir = r.path
	cmd.Stdin = strings.NewReader(patchContent)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git apply --reverse 失败: %s: %w", string(output), err)
	}
	return nil
}

// DiffWorkdirRaw 获取原始的 unified diff 输出（git diff），用于前端构造 patch
func (r *Repository) DiffWorkdirRaw(filePath string) (string, error) {
	args := []string{"diff"}
	if filePath != "" {
		args = append(args, "--", filePath)
	}

	cmd := exec.Command("git", args...)
	cmd.Dir = r.path

	output, err := cmd.Output()
	if err != nil {
		// git diff 对于无差异返回空输出且 exit code 0
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git diff 失败: %s: %w", string(exitErr.Stderr), err)
		}
		return "", fmt.Errorf("git diff 失败: %w", err)
	}
	return string(output), nil
}

// DiffStagedRaw 获取原始的 staged unified diff 输出（git diff --staged）
func (r *Repository) DiffStagedRaw(filePath string) (string, error) {
	args := []string{"diff", "--staged"}
	if filePath != "" {
		args = append(args, "--", filePath)
	}

	cmd := exec.Command("git", args...)
	cmd.Dir = r.path

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git diff --staged 失败: %s: %w", string(exitErr.Stderr), err)
		}
		return "", fmt.Errorf("git diff --staged 失败: %w", err)
	}
	return string(output), nil
}

