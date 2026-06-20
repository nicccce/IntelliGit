package git

import (
	"fmt"
	"strings"
)

// ShadowMerge 在不修改工作区、暂存区或任何引用的前提下，
// 模拟将 targetBranch 合并到当前 HEAD，并返回预检结果。
//
// 实现方式：
//  1. git merge-base HEAD <target>       — 找到共同祖先
//  2. 快进判断：若 merge-base == target hash，无需合并；若 merge-base == HEAD，可快进
//  3. git merge-tree <base> HEAD <target> — 纯只读三路合并，不写磁盘
//  4. 解析输出中的冲突标记，提取冲突文件列表
func (r *gitCliBackend) ShadowMerge(targetBranch string) (*ShadowMergeResult, error) {
	result := &ShadowMergeResult{TargetBranch: targetBranch}

	// 解析目标分支的 commit hash
	targetHashOut, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"rev-parse", "--verify", targetBranch},
	})
	if err != nil {
		return nil, fmt.Errorf("分支 %s 不存在: %w", targetBranch, err)
	}
	targetHash := strings.TrimSpace(targetHashOut)

	// 获取当前 HEAD hash
	headOut, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"rev-parse", "HEAD"},
	})
	if err != nil {
		return nil, fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	headHash := strings.TrimSpace(headOut)

	// 同一个 commit，无需合并
	if headHash == targetHash {
		return result, nil
	}

	// 找公共祖先
	mergeBaseOut, err := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"merge-base", "HEAD", targetBranch},
	})
	if err != nil {
		// 无公共祖先（无关历史），必然冲突
		result.HasConflicts = true
		result.ConflictedFiles = []string{}
		return result, nil
	}
	mergeBase := strings.TrimSpace(mergeBaseOut)

	// 快进判断
	if mergeBase == targetHash {
		// 当前分支已包含目标的所有提交，合并只需快进（无冲突）
		return result, nil
	}
	if mergeBase == headHash {
		// 目标分支领先，可以快进到目标
		result.CanFastForward = true
		return result, nil
	}

	// 执行只读三路合并（git merge-tree 不修改任何文件）
	mergeTreeOut, _ := r.runner.run(gitCliRunRequest{
		Dir:  r.path,
		Args: []string{"merge-tree", mergeBase, "HEAD", targetBranch},
	})

	conflictFiles := parseMergeTreeConflicts(mergeTreeOut)
	result.HasConflicts = len(conflictFiles) > 0
	result.ConflictedFiles = conflictFiles

	return result, nil
}

// parseMergeTreeConflicts 从 git merge-tree 的输出中提取存在冲突的文件路径列表。
//
// 处理两种冲突形式：
//  1. "added in both"  — 两侧都新增了同一文件（内容不同即冲突，直接记录）
//  2. "changed in both" + `<<<<<<< ` — 两侧都修改了同一文件且有重叠
func parseMergeTreeConflicts(output string) []string {
	var files []string
	seen := make(map[string]bool)

	lines := strings.Split(output, "\n")
	currentFile := ""
	isAddedInBoth := false
	fileRecorded := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// 检测区块头部（不以空格、@、+、-、\ 开头的非空行）
		if len(line) > 0 && line[0] != ' ' && line[0] != '@' &&
			line[0] != '+' && line[0] != '-' && line[0] != '\\' {
			currentFile = ""
			fileRecorded = false
			isAddedInBoth = trimmed == "added in both"
		}

		// 从 "base/our/their 100644 <hash> <path>" 提取文件路径
		if currentFile == "" {
			if strings.HasPrefix(trimmed, "base ") ||
				strings.HasPrefix(trimmed, "our ") ||
				strings.HasPrefix(trimmed, "their ") {
				fields := strings.Fields(trimmed)
				if len(fields) >= 4 {
					currentFile = fields[3]
				}
			}
		}

		// "added in both"：两侧哈希必然不同，直接视为冲突
		if isAddedInBoth && currentFile != "" && !fileRecorded {
			// 确认 our/their 行都能解析到（说明两侧都有文件）
			if strings.HasPrefix(trimmed, "our ") || strings.HasPrefix(trimmed, "their ") {
				if !seen[currentFile] {
					seen[currentFile] = true
					files = append(files, currentFile)
				}
				fileRecorded = true
			}
		}

		// 通用冲突标记检测（涵盖 "changed in both" 及部分 "added in both"）
		if strings.Contains(line, "<<<<<<<") && currentFile != "" && !seen[currentFile] {
			seen[currentFile] = true
			files = append(files, currentFile)
		}
	}

	return files
}
