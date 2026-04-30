package main

import (
	"fmt"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

func main() {
	// 初始化：打开本地 Git 仓库
	repo, err := git.PlainOpen("../../..")
	if err != nil {
		panic(err)
	}

	fmt.Println("=== 示例 1: 提取底层 Commit 与 Tree 对象 ===")
	example1_ReadCommitAndTree(repo)

	fmt.Println("\n=== 示例 2: 动态计算文件补丁差异 ===")
	example2_CalculateDiff(repo)

	fmt.Println("\n=== 示例 3: 读取当前工作区状态 (Status) ===")
	example3_CheckStatus(repo)
}

func example1_ReadCommitAndTree(repo *git.Repository) {
	// 解析 HEAD 引用
	ref, err := repo.Head()
	if err != nil {
		panic(err)
	}

	// 取出 Commit 对象
	commit, err := repo.CommitObject(ref.Hash())
	if err != nil {
		panic(err)
	}
	fmt.Printf("[Commit] 作者: %s, 注释: %s", commit.Author.Name, commit.Message)

	// 获取根 Tree
	tree, err := commit.Tree()
	if err != nil {
		panic(err)
	}

	// 遍历前 3 个文件（Blob）以作演示
	count := 0
	tree.Files().ForEach(func(f *object.File) error {
		if count < 3 {
			fmt.Printf("[Blob] 路径: %s, 哈希: %s\n", f.Name, f.Hash)
			count++
		}
		return nil
	})
}

func example2_CalculateDiff(repo *git.Repository) {
	ref, _ := repo.Head()
	currentCommit, _ := repo.CommitObject(ref.Hash())

	// 必须要有父节点才能做差异对比
	if currentCommit.NumParents() == 0 {
		fmt.Println("初始提交，无父节点可对比。")
		return
	}

	parentCommit, _ := currentCommit.Parent(0)
	currentTree, _ := currentCommit.Tree()
	parentTree, _ := parentCommit.Tree()

	// 核心原理：让父级 Tree 与当前 Tree 碰撞对比
	changes, err := parentTree.Diff(currentTree)
	if err != nil {
		panic(err)
	}

	fmt.Printf("本次提交与上一次提交相比，共有 %d 处文件发生变更。\n", len(changes))

	// 生成具体的文本 Patch 补丁
	patch, _ := changes.Patch()
	for _, filePatch := range patch.FilePatches() {
		from, to := filePatch.Files()
		if from == nil {
			fmt.Printf("[Diff] 新增文件: %s\n", to.Path())
		} else if to == nil {
			fmt.Printf("[Diff] 删除文件: %s\n", from.Path())
		} else {
			fmt.Printf("[Diff] 修改文件: %s\n", to.Path())
		}
	}
}

func example3_CheckStatus(repo *git.Repository) {
	// 获取工作区
	wt, err := repo.Worktree()
	if err != nil {
		panic(err)
	}

	// 调用 Status()，底层会遍历工作区文件并对比当前 HEAD 的 Tree
	status, err := wt.Status()
	if err != nil {
		panic(err)
	}

	// 检查是否有处于冲突（Unmerged）状态的文件
	conflictCount := 0
	for path, fileStatus := range status {
		if fileStatus.Staging == git.Unmodified && fileStatus.Worktree == git.Unmodified {
			continue
		}
		// 处于 UU 状态即代表出现冲突未解决
		if fileStatus.Staging == git.Unmerged || fileStatus.Worktree == git.Unmerged {
			fmt.Printf("[Status] 发现冲突文件: %s\n", path)
			conflictCount++
		}
	}
	
	if conflictCount == 0 {
		if status.IsClean() {
			fmt.Println("[Status] 工作区干净 (Clean)。")
		} else {
			fmt.Printf("[Status] 工作区有未提交的变更，文件变更数: %d\n", len(status))
		}
	}
}
