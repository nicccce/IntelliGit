package git

import "fmt"

// LogAllRaw 使用 git CLI 获取所有分支的 commit 历史（带拓扑排序信息）。
func (r *gitCliBackend) LogAllRaw(max int) (string, error) {
	if max <= 0 {
		max = 200
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir: r.path,
		Args: []string{
			"log", "--all",
			"--topo-order",
			fmt.Sprintf("--max-count=%d", max),
			"--format=%H|%h|%P|%an|%ae|%aI|%s|%D",
		},
	})
	if err != nil {
		return "", gitCliError("git log --all 失败", output, err)
	}
	return output, nil
}
