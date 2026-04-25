package git

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestPushUpdatesRemoteTrackingRef(t *testing.T) {
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "local")
	remotePath := filepath.Join(tempDir, "remote.git")

	_, err := Init(remotePath, true)
	if err != nil {
		t.Fatalf("init bare remote: %v", err)
	}

	repo, err := Init(localPath, false)
	if err != nil {
		t.Fatalf("init local repo: %v", err)
	}
	if err := repo.AddRemote("origin", remotePath); err != nil {
		t.Fatalf("add remote: %v", err)
	}

	filePath := filepath.Join(localPath, "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello\n"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := repo.Add("hello.txt"); err != nil {
		t.Fatalf("add file: %v", err)
	}
	if _, err := repo.Commit("add hello", "Tester", "tester@example.com"); err != nil {
		t.Fatalf("commit: %v", err)
	}

	ahead, behind, err := repo.AheadBehind("master")
	if err != nil {
		t.Fatalf("ahead/behind before push: %v", err)
	}
	if ahead != 1 || behind != 0 {
		t.Fatalf("before push ahead/behind = %d/%d, want 1/0", ahead, behind)
	}

	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push: %v", err)
	}

	ahead, behind, err = repo.AheadBehind("master")
	if err != nil {
		t.Fatalf("ahead/behind after push: %v", err)
	}
	if ahead != 0 || behind != 0 {
		t.Fatalf("after push ahead/behind = %d/%d, want 0/0", ahead, behind)
	}
}
