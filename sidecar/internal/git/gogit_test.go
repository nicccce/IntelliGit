package git

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestInitWithRemote(t *testing.T) {
	tempDir := t.TempDir()
	testRepoPath := filepath.Join(tempDir, "repo")
	remotePath := filepath.Join(tempDir, "remote.git")

	if _, err := Init(remotePath, true); err != nil {
		t.Fatalf("初始化远端仓库失败: %v", err)
	}
	repo, err := Init(testRepoPath, false)
	if err != nil {
		t.Fatalf("初始化仓库失败: %v", err)
	}

	remoteName := "origin"
	if err := repo.AddRemote(remoteName, remotePath); err != nil {
		t.Fatalf("添加远程仓库失败: %v", err)
	}

	remotes, err := repo.Remotes()
	if err != nil {
		t.Fatalf("获取远程仓库列表失败: %v", err)
	}
	if len(remotes) != 1 {
		t.Fatalf("remotes length = %d, want 1", len(remotes))
	}
	if remotes[0].Name != remoteName || remotes[0].FetchURL != remotePath {
		t.Fatalf("remote = %#v, want %s -> %s", remotes[0], remoteName, remotePath)
	}
}

func TestAddAndCommit(t *testing.T) {
	testRepoPath := t.TempDir()

	repo, err := Init(testRepoPath, false)
	if err != nil {
		t.Fatalf("初始化仓库失败: %v", err)
	}

	filename := "hello.txt"
	filepathAbs := filepath.Join(testRepoPath, filename)
	err = os.WriteFile(filepathAbs, []byte("Hello, IntelliGit test repository!\n"), 0644)
	if err != nil {
		t.Fatalf("创建文件失败: %v", err)
	}

	err = repo.Add(filename)
	if err != nil {
		t.Fatalf("添加暂存区失败: %v", err)
	}

	hash, err := repo.Commit("Add hello.txt for testing", "Tester", "tester@intelligit.dev")
	if err != nil {
		t.Fatalf("提交失败: %v", err)
	}

	commit, err := repo.GetCommit(hash)
	if err != nil {
		t.Fatalf("读取 commit 失败: %v", err)
	}
	if commit.Message != "Add hello.txt for testing" {
		t.Fatalf("commit message = %q, want %q", commit.Message, "Add hello.txt for testing")
	}
}

func TestPushToLocalRemoteWithoutAuth(t *testing.T) {
	tempDir := t.TempDir()
	testRepoPath := filepath.Join(tempDir, "repo")
	remotePath := filepath.Join(tempDir, "remote.git")

	if _, err := Init(remotePath, true); err != nil {
		t.Fatalf("初始化远端仓库失败: %v", err)
	}
	repo, err := Init(testRepoPath, false)
	if err != nil {
		t.Fatalf("初始化仓库失败: %v", err)
	}
	if err := repo.AddRemote("origin", remotePath); err != nil {
		t.Fatalf("添加远端失败: %v", err)
	}

	filePath := filepath.Join(testRepoPath, "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello\n"), 0644); err != nil {
		t.Fatalf("创建文件失败: %v", err)
	}
	if err := repo.Add("hello.txt"); err != nil {
		t.Fatalf("添加暂存区失败: %v", err)
	}
	hash, err := repo.Commit("Add hello.txt for testing", "Tester", "tester@intelligit.dev")
	if err != nil {
		t.Fatalf("提交失败: %v", err)
	}

	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("推送失败: %v", err)
	}

	remoteRepo, err := Open(remotePath)
	if err != nil {
		t.Fatalf("打开远端仓库失败: %v", err)
	}
	remoteRef, err := remoteRepo.GoGitRepo().Head()
	if err != nil {
		t.Fatalf("读取远端 HEAD 失败: %v", err)
	}
	if remoteRef.Hash().String() != hash {
		t.Fatalf("remote HEAD = %s, want %s", remoteRef.Hash(), hash)
	}
}
