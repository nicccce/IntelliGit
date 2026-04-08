package git

import (
	"fmt"

	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/diff"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// DiffCommits 获取两个 commit 之间的文件变更列表
func (r *Repository) DiffCommits(hashAStr, hashBStr string) ([]DiffEntry, error) {
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
func (r *Repository) DiffWithParent(hashStr string) ([]DiffEntry, error) {
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
func (r *Repository) GetCommitPatch(hashStr string) (*PatchDetail, error) {
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
func (r *Repository) FileContentAtCommit(hashStr, filePath string) (string, error) {
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
func (r *Repository) ListFilesAtCommit(hashStr string) ([]string, error) {
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
