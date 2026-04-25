package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveUnstagesModifiedFile(t *testing.T) {
	repo, dir := newStagingTestRepo(t)
	path := "tracked.txt"

	writeTestFile(t, dir, path, "base\n")
	if err := repo.Add(path); err != nil {
		t.Fatalf("add base file: %v", err)
	}
	if _, err := repo.Commit("initial commit", "Tester", "tester@example.com"); err != nil {
		t.Fatalf("commit base file: %v", err)
	}

	writeTestFile(t, dir, path, "changed\n")
	if err := repo.Add(path); err != nil {
		t.Fatalf("stage modified file: %v", err)
	}

	before := requireFileStatus(t, repo, path)
	if before.Staging != StatusModified || before.Worktree != StatusUnmodified {
		t.Fatalf("expected staged modification before remove, got staging=%q worktree=%q", before.Staging, before.Worktree)
	}

	if err := repo.Remove(path); err != nil {
		t.Fatalf("remove should unstage modified file: %v", err)
	}

	after := requireFileStatus(t, repo, path)
	if after.Staging != StatusUnmodified || after.Worktree != StatusModified {
		t.Fatalf("expected unstaged modification after remove, got staging=%q worktree=%q", after.Staging, after.Worktree)
	}

	content, err := os.ReadFile(filepath.Join(dir, path))
	if err != nil {
		t.Fatalf("read working tree file: %v", err)
	}
	if string(content) != "changed\n" {
		t.Fatalf("working tree content changed unexpectedly: %q", string(content))
	}
}

func TestRemoveUnstagesAddedFileWithoutHead(t *testing.T) {
	repo, dir := newStagingTestRepo(t)
	path := "new.txt"

	writeTestFile(t, dir, path, "new file\n")
	if err := repo.Add(path); err != nil {
		t.Fatalf("stage new file: %v", err)
	}

	if err := repo.Remove(path); err != nil {
		t.Fatalf("remove should unstage new file without HEAD: %v", err)
	}

	status := requireFileStatus(t, repo, path)
	if status.Staging != StatusUntracked || status.Worktree != StatusUntracked {
		t.Fatalf("expected untracked file after remove, got staging=%q worktree=%q", status.Staging, status.Worktree)
	}

	content, err := os.ReadFile(filepath.Join(dir, path))
	if err != nil {
		t.Fatalf("read working tree file: %v", err)
	}
	if string(content) != "new file\n" {
		t.Fatalf("working tree content changed unexpectedly: %q", string(content))
	}
}

func newStagingTestRepo(t *testing.T) (*Repository, string) {
	t.Helper()

	dir := t.TempDir()
	repo, err := Init(dir, false)
	if err != nil {
		t.Fatalf("init repo: %v", err)
	}
	return repo, dir
}

func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()

	fullPath := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func requireFileStatus(t *testing.T, repo *Repository, path string) FileStatus {
	t.Helper()

	statuses, err := repo.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	for _, status := range statuses {
		if status.Path == path {
			return status
		}
	}
	t.Fatalf("missing status for %s in %#v", path, statuses)
	return FileStatus{}
}
