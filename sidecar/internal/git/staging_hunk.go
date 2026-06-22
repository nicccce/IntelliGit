package git

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
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

	untrackedDiff, err := r.diffUntrackedFilesRaw(filePath)
	if err != nil {
		return "", err
	}
	return joinRawDiffs(output, untrackedDiff), nil
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

func (r *gitCliBackend) diffUntrackedFilesRaw(filePath string) (string, error) {
	args := []string{"ls-files", "--others", "--exclude-standard", "-z"}
	if filePath != "" {
		args = append(args, "--", filePath)
	}

	output, err := r.runner.run(gitCliRunRequest{Dir: r.path, Args: args})
	if err != nil {
		return "", gitCliError("git ls-files --others failed", output, err)
	}

	patches := make([]string, 0)
	for _, gitPath := range splitNulOutput(output) {
		patch, err := r.renderUntrackedFilePatch(gitPath)
		if err != nil {
			return "", err
		}
		if patch != "" {
			patches = append(patches, patch)
		}
	}
	return joinRawDiffs(patches...), nil
}

func (r *gitCliBackend) renderUntrackedFilePatch(gitPath string) (string, error) {
	fullPath, err := r.resolveRepoFilePath(gitPath)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		return "", fmt.Errorf("read untracked file info failed (%s): %w", gitPath, err)
	}
	if info.IsDir() {
		return "", nil
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return "", fmt.Errorf("read untracked file failed (%s): %w", gitPath, err)
	}

	mode := "100644"
	if info.Mode()&0111 != 0 {
		mode = "100755"
	}
	if bytes.IndexByte(content, 0) >= 0 {
		return renderBinaryNewFilePatch(gitPath, mode), nil
	}
	return renderTextNewFilePatch(gitPath, mode, string(content)), nil
}

func (r *gitCliBackend) resolveRepoFilePath(gitPath string) (string, error) {
	cleanPath := filepath.Clean(filepath.FromSlash(gitPath))
	if cleanPath == "." || cleanPath == ".." || filepath.IsAbs(cleanPath) || strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid repository relative path: %s", gitPath)
	}
	return filepath.Join(r.path, cleanPath), nil
}

func renderTextNewFilePatch(gitPath, mode, content string) string {
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("diff --git a/%s b/%s\n", gitPath, gitPath))
	builder.WriteString(fmt.Sprintf("new file mode %s\n", mode))
	builder.WriteString("index 0000000..0000000\n")
	builder.WriteString("--- /dev/null\n")
	builder.WriteString(fmt.Sprintf("+++ b/%s\n", gitPath))

	if content == "" {
		return builder.String()
	}

	hasTrailingNewline := strings.HasSuffix(content, "\n")
	lines := strings.Split(content, "\n")
	lineCount := len(lines)
	if hasTrailingNewline {
		lineCount--
	}

	builder.WriteString(fmt.Sprintf("@@ -0,0 +1,%d @@\n", lineCount))
	for index, line := range lines {
		if hasTrailingNewline && index == len(lines)-1 {
			break
		}
		builder.WriteString("+")
		builder.WriteString(line)
		builder.WriteString("\n")
	}
	if !hasTrailingNewline {
		builder.WriteString("\\ No newline at end of file\n")
	}
	return builder.String()
}

func renderBinaryNewFilePatch(gitPath, mode string) string {
	return fmt.Sprintf(
		"diff --git a/%s b/%s\nnew file mode %s\nindex 0000000..0000000\nBinary files /dev/null and b/%s differ\n",
		gitPath,
		gitPath,
		mode,
		gitPath,
	)
}

func splitNulOutput(output string) []string {
	if output == "" {
		return nil
	}

	parts := strings.Split(output, "\x00")
	paths := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			paths = append(paths, part)
		}
	}
	return paths
}

func joinRawDiffs(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			normalized = append(normalized, strings.TrimRight(part, "\n"))
		}
	}
	if len(normalized) == 0 {
		return ""
	}
	return strings.Join(normalized, "\n") + "\n"
}
