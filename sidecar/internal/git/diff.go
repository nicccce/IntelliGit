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
		headTree = &object.Tree{}
	}

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

		var oldContent string
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
			if headTree != nil {
				f, fErr := headTree.File(path)
				if fErr == nil {
					oldContent, _ = f.Contents()
				}
			}
		}

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
		if !isRealChange(fpInfo) {
			continue
		}
		detail.FilePatches = append(detail.FilePatches, fpInfo)
	}

	return detail, nil
}

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

		var oldContent string
		if headTree != nil {
			f, fErr := headTree.File(path)
			if fErr == nil {
				oldContent, _ = f.Contents()
			}
		}

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
		if !isRealChange(fpInfo) {
			continue
		}
		detail.FilePatches = append(detail.FilePatches, fpInfo)
	}

	return detail, nil
}

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

func isRealChange(fpInfo FilePatchInfo) bool {
	if fpInfo.IsBinary {
		return true
	}
	if len(fpInfo.Chunks) == 0 {
		return false
	}
	for _, chunk := range fpInfo.Chunks {
		if chunk.Type != "Equal" {
			return true
		}
	}
	return false
}

func splitLines(content string) []string {
	if content == "" {
		return nil
	}
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.TrimSuffix(normalized, "\n")
	if normalized == "" {
		return nil
	}
	return strings.Split(normalized, "\n")
}

func buildFilePatch(fromPath, toPath, oldContent, newContent string, isDelete bool) FilePatchInfo {
	info := FilePatchInfo{
		FromPath: fromPath,
		ToPath:   toPath,
		Chunks:   make([]ChunkInfo, 0),
	}

	oldLines := splitLines(oldContent)
	newLines := splitLines(newContent)

	if isDelete {
		info.ToPath = ""
		if len(oldLines) > 0 {
			info.Chunks = append(info.Chunks, ChunkInfo{Content: strings.Join(oldLines, "\n") + "\n", Type: "Delete"})
		}
		return info
	}

	if len(oldLines) == 0 && len(newLines) > 0 {
		info.FromPath = ""
		info.Chunks = append(info.Chunks, ChunkInfo{Content: strings.Join(newLines, "\n") + "\n", Type: "Add"})
		return info
	}

	chunks := diffLines(oldLines, newLines)
	info.Chunks = chunks
	return info
}

// diffLines 使用 Myers 差异算法生成行级 diff chunk 列表
func diffLines(oldLines, newLines []string) []ChunkInfo {
	edits := myersDiff(oldLines, newLines)
	return editsToChunks(edits, oldLines, newLines)
}

// editOp 表示一次编辑操作
// lineNum: 对于 Equal 和 Delete 操作，是 oldLines 中的行号(-1)；对于 Add，是 newLines 中的行号(-1)
type editOp struct {
	kind    int // 0=Equal, 1=Delete, 2=Add
	lineNum int // 行号
}

// myersDiff 使用 Myers 差异算法计算从 old 到 new 的最短编辑脚本
func myersDiff(old, new []string) []editOp {
	n, m := len(old), len(new)
	max := n + m

	// 使用两个数组来跟踪到达每个对角线的步数
	fp := make([]int, 2*max+1)
	// 存储路径信息：path[k] = 在到达对角线 k 时的编辑序列
	paths := make([][]editOp, 2*max+1)

	// 初始化对角线起点
	for d := 0; d <= max; d++ {
		for k := -d; k <= d; k += 2 {
			idx := k + max

			var x int
			var prevPath []editOp
			if k == -d || (k != d && fp[idx-1] < fp[idx+1]) {
				// 从 k+1 向下移动 (上一次往右走)
				x = fp[idx+1]
				prevPath = paths[idx+1]
			} else {
				// 从 k-1 向下移动 (上一次往下走)
				x = fp[idx-1] + 1
				prevPath = paths[idx-1]
			}

			y := x - k

			// 记录路径
			path := make([]editOp, len(prevPath))
			copy(path, prevPath)

			// 检查是否从上一步移动而来（删除或添加操作）
			if k == -d || (k != d && fp[idx-1] < fp[idx+1]) {
				// 来自 k+1：添加操作（在 old 中删除，在 new 中添加新行？实际上是从 (x, y-1) 到 (x, y)，即添加 new[y-1]）
				if y-1 >= 0 && y-1 < m {
					path = append(path, editOp{kind: 2, lineNum: y - 1})
				}
			} else {
				// 来自 k-1：删除操作（从 (x-1, y) 到 (x, y)，即删除 old[x-1]）
				if x-1 >= 0 && x-1 < n {
					path = append(path, editOp{kind: 1, lineNum: x - 1})
				}
			}

			// 沿着对角线前进 (相等行)
			for x < n && y < m && old[x] == new[y] {
				path = append(path, editOp{kind: 0, lineNum: x})
				x++
				y++
			}

			fp[idx] = x
			paths[idx] = path

			if x >= n && y >= m {
				return path
			}
		}
	}

	return nil
}

// editsToChunks 将编辑操作序列转换为 ChunkInfo 列表
func editsToChunks(edits []editOp, oldLines, newLines []string) []ChunkInfo {
	var chunks []ChunkInfo

	i := 0
	for i < len(edits) {
		// 收集连续的同类型操作
		kind := edits[i].kind
		start := i
		for i < len(edits) && edits[i].kind == kind {
			i++
		}

		var buf strings.Builder
		for _, op := range edits[start:i] {
			var line string
			switch op.kind {
			case 0: // Equal: 行来自 old (或 new，内容相同)
				line = oldLines[op.lineNum]
			case 1: // Delete: 行来自 old
				line = oldLines[op.lineNum]
			case 2: // Add: 行来自 new
				line = newLines[op.lineNum]
			}
			buf.WriteString(line + "\n")
		}

		chunkType := "Equal"
		if kind == 1 {
			chunkType = "Delete"
		} else if kind == 2 {
			chunkType = "Add"
		}

		chunks = append(chunks, ChunkInfo{Content: buf.String(), Type: chunkType})
	}

	return chunks
}

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

	var entries []DiffEntry
	err = currentTree.Files().ForEach(func(f *object.File) error {
		entries = append(entries, DiffEntry{Action: "insert", From: "", To: f.Name})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("遍历文件失败: %w", err)
	}
	return entries, nil
}

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

	detail := &PatchDetail{FilePatches: make([]FilePatchInfo, 0)}

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
			info.Chunks = append(info.Chunks, ChunkInfo{Content: chunk.Content(), Type: opType})
		}
		detail.FilePatches = append(detail.FilePatches, info)
	}

	return detail, nil
}

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

func changesToDiffEntries(changes object.Changes) []DiffEntry {
	entries := make([]DiffEntry, 0, len(changes))
	for _, c := range changes {
		entry := DiffEntry{}
		action, err := c.Action()
		if err != nil {
			continue
		}
		switch action {
		case 0:
			entry.Action = "insert"
			entry.To = c.To.Name
		case 1:
			entry.Action = "delete"
			entry.From = c.From.Name
		case 2:
			entry.Action = "modify"
			entry.From = c.From.Name
			entry.To = c.To.Name
		}
		entries = append(entries, entry)
	}
	return entries
}
