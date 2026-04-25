package git

import (
	"fmt"
	"strings"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// Commit 提交暂存区的变更
func (r *Repository) Commit(message, authorName, authorEmail string) (string, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("获取 worktree 失败: %w", err)
	}

	opts := &gogit.CommitOptions{}
	authorName = strings.TrimSpace(authorName)
	authorEmail = strings.TrimSpace(authorEmail)
	if authorName != "" || authorEmail != "" {
		if authorName == "" || authorEmail == "" {
			defaultName, defaultEmail := r.defaultCommitAuthor()
			if authorName == "" {
				authorName = defaultName
			}
			if authorEmail == "" {
				authorEmail = defaultEmail
			}
		}
		if authorName == "" || authorEmail == "" {
			return "", fmt.Errorf("提交作者信息不完整，请同时填写提交名称和邮箱")
		}
		opts.Author = &object.Signature{
			Name:  authorName,
			Email: authorEmail,
			When:  time.Now(),
		}
	}

	hash, err := wt.Commit(message, opts)
	if err != nil {
		return "", fmt.Errorf("git commit 失败: %w", err)
	}
	return hash.String(), nil
}

func (r *Repository) defaultCommitAuthor() (string, string) {
	cfg, err := r.repo.ConfigScoped(config.SystemScope)
	if err != nil {
		return "", ""
	}
	name := cfg.Author.Name
	email := cfg.Author.Email
	if name == "" {
		name = cfg.User.Name
	}
	if email == "" {
		email = cfg.User.Email
	}
	return name, email
}

// Log 获取提交历史记录，max 指定最多返回条数（0 表示不限制）
func (r *Repository) Log(max int) ([]CommitInfo, error) {
	iter, err := r.repo.Log(&gogit.LogOptions{
		Order: gogit.LogOrderCommitterTime,
	})
	if err != nil {
		return nil, fmt.Errorf("获取 log 失败: %w", err)
	}

	var commits []CommitInfo
	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		if max > 0 && count >= max {
			return errStopIter
		}
		commits = append(commits, commitToInfo(c))
		count++
		return nil
	})
	if err != nil && err != errStopIter {
		return nil, fmt.Errorf("遍历 log 失败: %w", err)
	}
	return commits, nil
}

// LogFrom 从指定 commit hash 开始获取提交历史
func (r *Repository) LogFrom(hashStr string, max int) ([]CommitInfo, error) {
	hash := plumbing.NewHash(hashStr)
	iter, err := r.repo.Log(&gogit.LogOptions{
		From:  hash,
		Order: gogit.LogOrderCommitterTime,
	})
	if err != nil {
		return nil, fmt.Errorf("获取 log 失败 (from %s): %w", hashStr[:8], err)
	}

	var commits []CommitInfo
	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		if max > 0 && count >= max {
			return errStopIter
		}
		commits = append(commits, commitToInfo(c))
		count++
		return nil
	})
	if err != nil && err != errStopIter {
		return nil, fmt.Errorf("遍历 log 失败: %w", err)
	}
	return commits, nil
}

// GetCommit 通过 hash 获取单个 commit 的详细信息
func (r *Repository) GetCommit(hashStr string) (*CommitInfo, error) {
	hash := plumbing.NewHash(hashStr)
	c, err := r.repo.CommitObject(hash)
	if err != nil {
		return nil, fmt.Errorf("获取 commit 失败 (%s): %w", hashStr[:8], err)
	}
	info := commitToInfo(c)
	return &info, nil
}

// commitToInfo 将 go-git 的 Commit 对象转换为 CommitInfo
func commitToInfo(c *object.Commit) CommitInfo {
	parentHashes := make([]string, len(c.ParentHashes))
	for i, h := range c.ParentHashes {
		parentHashes[i] = h.String()
	}

	hash := c.Hash.String()
	shortHash := hash
	if len(hash) > 8 {
		shortHash = hash[:8]
	}

	return CommitInfo{
		Hash:         hash,
		ShortHash:    shortHash,
		Author:       c.Author.Name,
		AuthorEmail:  c.Author.Email,
		Date:         c.Author.When,
		Message:      c.Message,
		ParentHashes: parentHashes,
	}
}

// errStopIter 用于手动中止 ForEach 迭代
var errStopIter = fmt.Errorf("stop iteration")
