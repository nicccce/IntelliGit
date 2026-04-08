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
