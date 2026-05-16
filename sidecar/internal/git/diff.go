package git

import (
	"fmt"
	"io"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/diff"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// DiffWorkdir 获取工作区未暂存变更的结构化 diff（等价于 git diff）
// 对于指定文件 filePath 返回 diff；filePath 为空时返回所有文件的 diff
func (r *goGitBackend) DiffWorkdir(filePath string) (*PatchDetail, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}

	// 获取 HEAD tree 作为基准
	headTree, err := r.headTree()
	if err != nil {
		// 初始提交时没有 HEAD tree，使用空 tree
		headTree = &object.Tree{}
	}

	// 获取 index tree（暂存区作为基准，与工作区对比）
	idx, err := r.repo.Storer.Index()
	if err != nil {
		return nil, fmt.Errorf("获取 index 失败: %w", err)
	}

	detail := &PatchDetail{FilePatches: make([]FilePatchInfo, 0)}

	for path, fileStatus := range status {
		if fileStatus.Worktree == gogit.Unmodified && fileStatus.Staging != gogit.Untracked {
			continue
		}
		if filePath != "" && path != filePath {
			continue
		}

		// 获取暂存区版本（或 HEAD 版本）
		var oldContent string
		// 先尝试从 index 获取
		for _, entry := range idx.Entries {
			if entry.Name == path {
				blob, bErr := r.repo.BlobObject(entry.Hash)
				if bErr == nil {
					reader, rErr := blob.Reader()
					if rErr == nil {
						data, _ := io.ReadAll(reader)
						reader.Close()
						oldContent = string(data)
					}
				}
				break
			}
		}
		if oldContent == "" {
			// fallback: 从 HEAD tree 获取
			if headTree != nil {
				f, fErr := headTree.File(path)
				if fErr == nil {
					oldContent, _ = f.Contents()
				}
			}
		}

		// 获取工作区版本
		newContent := ""
		if fileStatus.Worktree != gogit.Deleted {
			wFile, wErr := wt.Filesystem.Open(path)
			if wErr == nil {
				data, _ := io.ReadAll(wFile)
				wFile.Close()
				newContent = string(data)
			}
		}

		fpInfo := buildFilePatch(path, path, oldContent, newContent, fileStatus.Worktree == gogit.Deleted)
		detail.FilePatches = append(detail.FilePatches, fpInfo)
	}

	return detail, nil
}

// DiffStaged 获取已暂存变更的结构化 diff（等价于 git diff --staged）
func (r *goGitBackend) DiffStaged(filePath string) (*PatchDetail, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}

	headTree, err := r.headTree()
	if err != nil {
		headTree = &object.Tree{}
	}

	idx, err := r.repo.Storer.Index()
	if err != nil {
		return nil, fmt.Errorf("获取 index 失败: %w", err)
	}

	detail := &PatchDetail{FilePatches: make([]FilePatchInfo, 0)}

	for path, fileStatus := range status {
		if fileStatus.Staging == gogit.Unmodified || fileStatus.Staging == gogit.Untracked {
			continue
		}
		if filePath != "" && path != filePath {
			continue
		}

		// HEAD 版本
		var oldContent string
		if headTree != nil {
			f, fErr := headTree.File(path)
			if fErr == nil {
				oldContent, _ = f.Contents()
			}
		}

		// Index 版本
		newContent := ""
		if fileStatus.Staging != gogit.Deleted {
			for _, entry := range idx.Entries {
				if entry.Name == path {
					blob, bErr := r.repo.BlobObject(entry.Hash)
					if bErr == nil {
						reader, rErr := blob.Reader()
						if rErr == nil {
							data, _ := io.ReadAll(reader)
							reader.Close()
							newContent = string(data)
						}
					}
					break
				}
			}
		}

		fpInfo := buildFilePatch(path, path, oldContent, newContent, fileStatus.Staging == gogit.Deleted)
		detail.FilePatches = append(detail.FilePatches, fpInfo)
	}

	return detail, nil
}

// headTree 获取 HEAD commit 的 tree 对象
func (r *goGitBackend) headTree() (*object.Tree, error) {
	headRef, err := r.repo.Head()
	if err != nil {
		return nil, err
	}
	commit, err := r.repo.CommitObject(headRef.Hash())
	if err != nil {
		return nil, err
	}
	return commit.Tree()
}

// buildFilePatch 通过简单的行级 diff 构建 FilePatchInfo
func buildFilePatch(fromPath, toPath, oldContent, newContent string, isDelete bool) FilePatchInfo {
	info := FilePatchInfo{
		FromPath: fromPath,
		ToPath:   toPath,
		Chunks:   make([]ChunkInfo, 0),
	}

	if isDelete {
		info.ToPath = ""
		if oldContent != "" {
			info.Chunks = append(info.Chunks, ChunkInfo{Content: oldContent, Type: "Delete"})
		}
		return info
	}

	if oldContent == "" && newContent != "" {
		info.FromPath = ""
		info.Chunks = append(info.Chunks, ChunkInfo{Content: newContent, Type: "Add"})
		return info
	}

	// 简单 line-level diff: 使用 LCS-based diff
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")
	chunks := diffLines(oldLines, newLines)
	info.Chunks = chunks
	return info
}

// diffLines 简单的行级 diff 算法，产出 chunk 列表
func diffLines(oldLines, newLines []string) []ChunkInfo {
	// 使用 Hunt-McIlroy / simple LCS approach
	// 为简化实现，采用逐段比较
	lcs := computeLCS(oldLines, newLines)
	var chunks []ChunkInfo

	oi, ni, li := 0, 0, 0

	for li < len(lcs) {
		// 找到 lcs[li] 在 old 和 new 中的位置
		lcsLine := lcs[li]

		// 输出 old 中到 lcsLine 之前的删除行
		var delBuf strings.Builder
		for oi < len(oldLines) && oldLines[oi] != lcsLine {
			delBuf.WriteString(oldLines[oi])
			delBuf.WriteString("\n")
			oi++
		}
		if delBuf.Len() > 0 {
			chunks = append(chunks, ChunkInfo{Content: delBuf.String(), Type: "Delete"})
		}

		// 输出 new 中到 lcsLine 之前的新增行
		var addBuf strings.Builder
		for ni < len(newLines) && newLines[ni] != lcsLine {
			addBuf.WriteString(newLines[ni])
			addBuf.WriteString("\n")
			ni++
		}
		if addBuf.Len() > 0 {
			chunks = append(chunks, ChunkInfo{Content: addBuf.String(), Type: "Add"})
		}

		// 输出相同行
		var eqBuf strings.Builder
		for li < len(lcs) && oi < len(oldLines) && ni < len(newLines) &&
			oldLines[oi] == newLines[ni] && oldLines[oi] == lcs[li] {
			eqBuf.WriteString(oldLines[oi])
			eqBuf.WriteString("\n")
			oi++
			ni++
			li++
		}
		if eqBuf.Len() > 0 {
			chunks = append(chunks, ChunkInfo{Content: eqBuf.String(), Type: "Equal"})
		}
	}

	// 剩余的 old 行
	var delBuf strings.Builder
	for oi < len(oldLines) {
		delBuf.WriteString(oldLines[oi])
		delBuf.WriteString("\n")
		oi++
	}
	if delBuf.Len() > 0 {
		chunks = append(chunks, ChunkInfo{Content: delBuf.String(), Type: "Delete"})
	}

	// 剩余的 new 行
	var addBuf strings.Builder
	for ni < len(newLines) {
		addBuf.WriteString(newLines[ni])
		addBuf.WriteString("\n")
		ni++
	}
	if addBuf.Len() > 0 {
		chunks = append(chunks, ChunkInfo{Content: addBuf.String(), Type: "Add"})
	}

	return chunks
}

// computeLCS 计算两个字符串切片的最长公共子序列
func computeLCS(a, b []string) []string {
	m, n := len(a), len(b)
	// DP table
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	// Backtrack
	result := make([]string, 0, dp[m][n])
	i, j := m, n
	for i > 0 && j > 0 {
		if a[i-1] == b[j-1] {
			result = append(result, a[i-1])
			i--
			j--
		} else if dp[i-1][j] >= dp[i][j-1] {
			i--
		} else {
			j--
		}
	}
	// Reverse
	for l, r := 0, len(result)-1; l < r; l, r = l+1, r-1 {
		result[l], result[r] = result[r], result[l]
	}
	return result
}

// DiffCommits 获取两个 commit 之间的文件变更列表
func (r *goGitBackend) DiffCommits(hashAStr, hashBStr string) ([]DiffEntry, error) {
	hashA := plumbing.NewHash(hashAStr)
	hashB := plumbing.NewHash(hashBStr)

	commitA, err := r.repo.CommitObject(hashA)
	if err != nil {
		return nil, fmt.Errorf("获取 commitA 失败 (%s): %w", hashAStr[:8], err)
	}
	commitB, err := r.repo.CommitObject(hashB)
	if err != nil {
		return nil, fmt.Errorf("获取 commitB 失败 (%s): %w", hashBStr[:8], err)
	}

	treeA, err := commitA.Tree()
	if err != nil {
		return nil, fmt.Errorf("获取 treeA 失败: %w", err)
	}
	treeB, err := commitB.Tree()
	if err != nil {
		return nil, fmt.Errorf("获取 treeB 失败: %w", err)
	}

	changes, err := treeA.Diff(treeB)
	if err != nil {
		return nil, fmt.Errorf("diff 失败: %w", err)
	}

	return changesToDiffEntries(changes), nil
}

// DiffWithParent 获取指定 commit 与其第一个父 commit 之间的差异
// 对于初始提交（无父 commit），返回该次提交引入的所有文件
func (r *goGitBackend) DiffWithParent(hashStr string) ([]DiffEntry, error) {
	hash := plumbing.NewHash(hashStr)
	commit, err := r.repo.CommitObject(hash)
	if err != nil {
		return nil, fmt.Errorf("获取 commit 失败 (%s): %w", hashStr[:8], err)
	}

	currentTree, err := commit.Tree()
	if err != nil {
		return nil, fmt.Errorf("获取 tree 失败: %w", err)
	}

	// 如果有父 commit，与父 commit 对比
	if commit.NumParents() > 0 {
		parent, err := commit.Parent(0)
		if err != nil {
			return nil, fmt.Errorf("获取父 commit 失败: %w", err)
		}
		parentTree, err := parent.Tree()
		if err != nil {
			return nil, fmt.Errorf("获取父 tree 失败: %w", err)
		}
		changes, err := parentTree.Diff(currentTree)
		if err != nil {
			return nil, fmt.Errorf("diff 失败: %w", err)
		}
		return changesToDiffEntries(changes), nil
	}

	// 初始提交：所有文件都是新增的
	var entries []DiffEntry
	err = currentTree.Files().ForEach(func(f *object.File) error {
		entries = append(entries, DiffEntry{
			Action: "insert",
			From:   "",
			To:     f.Name,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("遍历文件失败: %w", err)
	}
	return entries, nil
}

// GetCommitPatch 获取指定 commit 与其父 commit 之间的具体差异（结构化对象）
func (r *goGitBackend) GetCommitPatch(hashStr string) (*PatchDetail, error) {
	hash := plumbing.NewHash(hashStr)
	commit, err := r.repo.CommitObject(hash)
	if err != nil {
		return nil, fmt.Errorf("获取 commit 失败 (%s): %w", hashStr[:8], err)
	}

	currentTree, err := commit.Tree()
	if err != nil {
		return nil, fmt.Errorf("获取 tree 失败: %w", err)
	}

	var parentTree *object.Tree
	if commit.NumParents() > 0 {
		parent, err := commit.Parent(0)
		if err != nil {
			return nil, fmt.Errorf("获取父 commit 失败: %w", err)
		}
		parentTree, err = parent.Tree()
		if err != nil {
			return nil, fmt.Errorf("获取父 tree 失败: %w", err)
		}
	} else {
		// 初始提交时，提供一个空的 Tree，这样会显示整个文件被添加
		parentTree = &object.Tree{}
	}

	changes, err := parentTree.Diff(currentTree)
	if err != nil {
		return nil, fmt.Errorf("diff 失败: %w", err)
	}

	patch, err := changes.Patch()
	if err != nil {
		return nil, fmt.Errorf("生成 patch 失败: %w", err)
	}

	detail := &PatchDetail{
		FilePatches: make([]FilePatchInfo, 0),
	}

	for _, fp := range patch.FilePatches() {
		from, to := fp.Files()
		fromPath, toPath := "", ""
		if from != nil {
			fromPath = from.Path()
		}
		if to != nil {
			toPath = to.Path()
		}

		info := FilePatchInfo{
			IsBinary: fp.IsBinary(),
			FromPath: fromPath,
			ToPath:   toPath,
			Chunks:   make([]ChunkInfo, 0, len(fp.Chunks())),
		}

		for _, chunk := range fp.Chunks() {
			opType := "Equal"
			switch chunk.Type() {
			case diff.Add:
				opType = "Add"
			case diff.Delete:
				opType = "Delete"
			}
			info.Chunks = append(info.Chunks, ChunkInfo{
				Content: chunk.Content(),
				Type:    opType,
			})
		}
		detail.FilePatches = append(detail.FilePatches, info)
	}

	return detail, nil
}

// FileContentAtCommit 读取指定 commit 中某个文件的内容
func (r *goGitBackend) FileContentAtCommit(hashStr, filePath string) (string, error) {
	hash := plumbing.NewHash(hashStr)
	commit, err := r.repo.CommitObject(hash)
	if err != nil {
		return "", fmt.Errorf("获取 commit 失败 (%s): %w", hashStr[:8], err)
	}

	tree, err := commit.Tree()
	if err != nil {
		return "", fmt.Errorf("获取 tree 失败: %w", err)
	}

	file, err := tree.File(filePath)
	if err != nil {
		return "", fmt.Errorf("文件不存在 (%s@%s): %w", filePath, hashStr[:8], err)
	}

	content, err := file.Contents()
	if err != nil {
		return "", fmt.Errorf("读取文件内容失败: %w", err)
	}
	return content, nil
}

// ListFilesAtCommit 列出指定 commit 中的所有文件路径
func (r *goGitBackend) ListFilesAtCommit(hashStr string) ([]string, error) {
	hash := plumbing.NewHash(hashStr)
	commit, err := r.repo.CommitObject(hash)
	if err != nil {
		return nil, fmt.Errorf("获取 commit 失败 (%s): %w", hashStr[:8], err)
	}

	tree, err := commit.Tree()
	if err != nil {
		return nil, fmt.Errorf("获取 tree 失败: %w", err)
	}

	var paths []string
	err = tree.Files().ForEach(func(f *object.File) error {
		paths = append(paths, f.Name)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("遍历文件失败: %w", err)
	}
	return paths, nil
}

// changesToDiffEntries 将 go-git 的 Changes 转换为 DiffEntry 列表
func changesToDiffEntries(changes object.Changes) []DiffEntry {
	entries := make([]DiffEntry, 0, len(changes))
	for _, c := range changes {
		entry := DiffEntry{}
		action, err := c.Action()
		if err != nil {
			continue
		}
		switch action {
		case 0: // Insert
			entry.Action = "insert"
			entry.To = c.To.Name
		case 1: // Delete
			entry.Action = "delete"
			entry.From = c.From.Name
		case 2: // Modify
			entry.Action = "modify"
			entry.From = c.From.Name
			entry.To = c.To.Name
		}
		entries = append(entries, entry)
	}
	return entries
}
