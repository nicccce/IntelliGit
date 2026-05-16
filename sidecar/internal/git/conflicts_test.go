package git

import (
	"reflect"
	"testing"
)

func TestParseConflictedFiles(t *testing.T) {
	output := `Auto-merging app/main.go
CONFLICT (content): Merge conflict in app/main.go
CONFLICT (rename/delete): docs/old.md renamed to docs/new.md in HEAD, but deleted in feature.
CONFLICT (content): Merge conflict in sidecar/internal/git/merge.go
Automatic merge failed; fix conflicts and then commit the result.`

	got := parseConflictedFiles(output)
	want := []string{"app/main.go", "sidecar/internal/git/merge.go"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseConflictedFiles() = %#v, want %#v", got, want)
	}
}
