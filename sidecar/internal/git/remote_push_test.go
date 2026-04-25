package git

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-git/go-git/v5/plumbing"
)

func TestCommitUsesGitConfigAuthorWhenAuthorOmitted(t *testing.T) {
	tempDir := t.TempDir()

	repo, err := Init(tempDir, false)
	if err != nil {
		t.Fatalf("init repo: %v", err)
	}

	cfg, err := repo.GoGitRepo().Config()
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	cfg.User.Name = "Configured User"
	cfg.User.Email = "configured@example.com"
	if err := repo.GoGitRepo().SetConfig(cfg); err != nil {
		t.Fatalf("write config: %v", err)
	}

	filePath := filepath.Join(tempDir, "identity.txt")
	if err := os.WriteFile(filePath, []byte("identity\n"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := repo.Add("identity.txt"); err != nil {
		t.Fatalf("add file: %v", err)
	}

	hash, err := repo.Commit("use configured identity", "", "")
	if err != nil {
		t.Fatalf("commit: %v", err)
	}

	commit, err := repo.GetCommit(hash)
	if err != nil {
		t.Fatalf("get commit: %v", err)
	}
	if commit.Author != "Configured User" || commit.AuthorEmail != "configured@example.com" {
		t.Fatalf("author = %q <%s>, want Configured User <configured@example.com>", commit.Author, commit.AuthorEmail)
	}
}

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

func TestPullUsesCurrentBranchWithoutTrackingConfig(t *testing.T) {
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "local")
	otherPath := filepath.Join(tempDir, "other")
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
	if err := os.WriteFile(filePath, []byte("base\n"), 0644); err != nil {
		t.Fatalf("write base file: %v", err)
	}
	if err := repo.Add("hello.txt"); err != nil {
		t.Fatalf("add base file: %v", err)
	}
	if _, err := repo.Commit("base", "Tester", "tester@example.com"); err != nil {
		t.Fatalf("commit base: %v", err)
	}
	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push base: %v", err)
	}

	other, err := Clone(remotePath, otherPath, nil)
	if err != nil {
		t.Fatalf("clone other: %v", err)
	}
	otherFile := filepath.Join(otherPath, "hello.txt")
	if err := os.WriteFile(otherFile, []byte("base\nremote\n"), 0644); err != nil {
		t.Fatalf("write remote change: %v", err)
	}
	if err := other.Add("hello.txt"); err != nil {
		t.Fatalf("add remote change: %v", err)
	}
	remoteHash, err := other.Commit("remote change", "Tester", "tester@example.com")
	if err != nil {
		t.Fatalf("commit remote change: %v", err)
	}
	if err := other.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push remote change: %v", err)
	}

	if err := repo.GoGitRepo().Storer.RemoveReference(plumbing.NewRemoteReferenceName("origin", "master")); err != nil {
		t.Fatalf("remove remote tracking ref: %v", err)
	}
	if err := repo.Pull("origin", nil, io.Discard); err != nil {
		t.Fatalf("pull current branch: %v", err)
	}

	head, _, err := repo.Head()
	if err != nil {
		t.Fatalf("head after pull: %v", err)
	}
	if head != remoteHash {
		t.Fatalf("head after pull = %s, want %s", head, remoteHash)
	}
	remoteRef, err := repo.GoGitRepo().Reference(plumbing.NewRemoteReferenceName("origin", "master"), true)
	if err != nil {
		t.Fatalf("remote tracking ref after pull: %v", err)
	}
	if remoteRef.Hash().String() != remoteHash {
		t.Fatalf("origin/master after pull = %s, want %s", remoteRef.Hash(), remoteHash)
	}
}

func TestPushOnlyPushesCurrentBranch(t *testing.T) {
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "local")
	otherPath := filepath.Join(tempDir, "other")
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

	basePath := filepath.Join(localPath, "base.txt")
	if err := os.WriteFile(basePath, []byte("base\n"), 0644); err != nil {
		t.Fatalf("write base file: %v", err)
	}
	if err := repo.Add("base.txt"); err != nil {
		t.Fatalf("add base file: %v", err)
	}
	if _, err := repo.Commit("base", "Tester", "tester@example.com"); err != nil {
		t.Fatalf("commit base: %v", err)
	}
	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push base: %v", err)
	}
	if err := repo.CreateBranch("feature"); err != nil {
		t.Fatalf("create local feature: %v", err)
	}

	other, err := Clone(remotePath, otherPath, nil)
	if err != nil {
		t.Fatalf("clone other: %v", err)
	}
	if err := other.CheckoutNewBranch("feature"); err != nil {
		t.Fatalf("checkout other feature: %v", err)
	}
	featurePath := filepath.Join(otherPath, "feature.txt")
	if err := os.WriteFile(featurePath, []byte("feature\n"), 0644); err != nil {
		t.Fatalf("write feature file: %v", err)
	}
	if err := other.Add("feature.txt"); err != nil {
		t.Fatalf("add feature file: %v", err)
	}
	if _, err := other.Commit("feature change", "Tester", "tester@example.com"); err != nil {
		t.Fatalf("commit feature change: %v", err)
	}
	if err := other.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push remote feature: %v", err)
	}

	masterPath := filepath.Join(localPath, "master.txt")
	if err := os.WriteFile(masterPath, []byte("master\n"), 0644); err != nil {
		t.Fatalf("write master file: %v", err)
	}
	if err := repo.Add("master.txt"); err != nil {
		t.Fatalf("add master file: %v", err)
	}
	masterHash, err := repo.Commit("master change", "Tester", "tester@example.com")
	if err != nil {
		t.Fatalf("commit master change: %v", err)
	}
	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push current branch: %v", err)
	}

	remoteRepo, err := Open(remotePath)
	if err != nil {
		t.Fatalf("open remote: %v", err)
	}
	masterRef, err := remoteRepo.GoGitRepo().Reference(plumbing.NewBranchReferenceName("master"), true)
	if err != nil {
		t.Fatalf("remote master ref: %v", err)
	}
	if masterRef.Hash().String() != masterHash {
		t.Fatalf("remote master = %s, want %s", masterRef.Hash(), masterHash)
	}
}
