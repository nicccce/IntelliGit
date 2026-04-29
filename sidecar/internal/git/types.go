package git

import "time"

// CommitInfo 表示一条提交记录的摘要信息
type CommitInfo struct {
	Hash         string    `json:"hash"`
	ShortHash    string    `json:"shortHash"`
	Author       string    `json:"author"`
	AuthorEmail  string    `json:"authorEmail"`
	Date         time.Time `json:"date"`
	Message      string    `json:"message"`
	ParentHashes []string  `json:"parentHashes"`
}

// StatusCode 对应 go-git 的 StatusCode，用更友好的字符串表示
type StatusCode string

const (
	StatusUnmodified StatusCode = " "
	StatusModified   StatusCode = "M"
	StatusAdded      StatusCode = "A"
	StatusDeleted    StatusCode = "D"
	StatusRenamed    StatusCode = "R"
	StatusCopied     StatusCode = "C"
	StatusUntracked  StatusCode = "?"
)

// FileStatus 描述单个文件的暂存区与工作区状态
type FileStatus struct {
	Path     string     `json:"path"`
	Staging  StatusCode `json:"staging"`
	Worktree StatusCode `json:"worktree"`
}

// BranchInfo 表示一个分支信息
type BranchInfo struct {
	Name     string `json:"name"`
	IsRemote bool   `json:"isRemote"`
	IsHead   bool   `json:"isHead"`
	Hash     string `json:"hash"`
}

// DiffEntry 表示两次提交之间的单个文件变更
type DiffEntry struct {
	Action string `json:"action"` // "insert", "delete", "modify", "rename"
	From   string `json:"from"`
	To     string `json:"to"`
}

// RemoteInfo 表示一个远程仓库信息
type RemoteInfo struct {
	Name     string   `json:"name"`
	FetchURL string   `json:"fetchUrl"`
	PushURLs []string `json:"pushUrls"`
}

// PatchDetail 传给前端的完整补丁描述
type PatchDetail struct {
	FilePatches []FilePatchInfo `json:"filePatches"`
}

// FilePatchInfo 描述单个文件的变动
type FilePatchInfo struct {
	IsBinary bool        `json:"isBinary"`
	FromPath string      `json:"fromPath"` // 旧路径
	ToPath   string      `json:"toPath"`   // 新路径
	Chunks   []ChunkInfo `json:"chunks"`
}

// ChunkInfo 描述具体的某一个代码块
type ChunkInfo struct {
	Content string `json:"content"` // 具体文本内容
	Type    string `json:"type"`    // "Add", "Delete", "Equal"
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Merge 冲突相关类型（为后续 merge 功能预留）
// ═══════════════════════════════════════════════════════════════════════════════

// MergeConflictInfo 描述一次 merge 冲突的详细信息
type MergeConflictInfo struct {
	// ConflictedFiles 冲突文件的路径列表
	ConflictedFiles []string `json:"conflictedFiles"`
	// Message merge 命令的原始输出
	Message string `json:"message"`
	// MergingBranch 正在合并的分支/引用名
	MergingBranch string `json:"mergingBranch"`
}

// MergeConflictError 表示 merge 操作产生了冲突。
// 实现 error 接口，可通过 errors.As 提取结构化冲突信息。
// 前端可据此展示冲突文件列表并引导用户解决。
type MergeConflictError struct {
	Info MergeConflictInfo
}

func (e *MergeConflictError) Error() string {
	return "合并冲突，请手动解决后提交: " + e.Info.Message
}

// MergeStatusResult 描述当前仓库的 merge 状态
type MergeStatusResult struct {
	// Merging 当前是否处于 merge 中间状态（存在 .git/MERGE_HEAD）
	Merging bool `json:"merging"`
	// ConflictedFiles 冲突文件列表（仅当 Merging=true 时有值）
	ConflictedFiles []string `json:"conflictedFiles,omitempty"`
	// MergeHead 正在合并的 commit hash（MERGE_HEAD 的内容）
	MergeHead string `json:"mergeHead,omitempty"`
}
