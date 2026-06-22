package git

import (
	"strings"
	"testing"
)

func TestDiffWorkdirRawIncludesUntrackedFile(t *testing.T) {
	repo, dir := newStagingTestRepo(t)
	path := "new.txt"

	writeTestFile(t, dir, path, "hello\nworld\n")

	raw, err := repo.DiffWorkdirRaw("")
	if err != nil {
		t.Fatalf("diff workdir raw: %v", err)
	}

	assertContains(t, raw, "diff --git a/new.txt b/new.txt")
	assertContains(t, raw, "new file mode 100644")
	assertContains(t, raw, "--- /dev/null")
	assertContains(t, raw, "+++ b/new.txt")
	assertContains(t, raw, "+hello")
	assertContains(t, raw, "+world")

	stagedRaw, err := repo.DiffStagedRaw("")
	if err != nil {
		t.Fatalf("diff staged raw: %v", err)
	}
	if strings.TrimSpace(stagedRaw) != "" {
		t.Fatalf("workdir raw diff should not stage untracked files, got staged diff:\n%s", stagedRaw)
	}

	status := requireFileStatus(t, repo, path)
	if status.Staging != StatusUntracked || status.Worktree != StatusUntracked {
		t.Fatalf("expected file to remain untracked, got staging=%q worktree=%q", status.Staging, status.Worktree)
	}
}

func TestDiffWorkdirRawFiltersUntrackedPath(t *testing.T) {
	repo, dir := newStagingTestRepo(t)

	writeTestFile(t, dir, "keep.txt", "keep\n")
	writeTestFile(t, dir, "skip.txt", "skip\n")

	raw, err := repo.DiffWorkdirRaw("keep.txt")
	if err != nil {
		t.Fatalf("diff workdir raw for path: %v", err)
	}

	assertContains(t, raw, "diff --git a/keep.txt b/keep.txt")
	if strings.Contains(raw, "skip.txt") {
		t.Fatalf("path-filtered diff should not include skip.txt:\n%s", raw)
	}
}

func assertContains(t *testing.T, value, expected string) {
	t.Helper()

	if !strings.Contains(value, expected) {
		t.Fatalf("expected output to contain %q, got:\n%s", expected, value)
	}
}
