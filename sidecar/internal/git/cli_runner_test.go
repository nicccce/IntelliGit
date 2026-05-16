package git

import (
	"strings"
	"testing"
)

func TestGitCliEnvDisablesInteractivePrompts(t *testing.T) {
	env := gitCliEnv()

	assertEnvValue(t, env, "GIT_MERGE_AUTOEDIT", "no")
	assertEnvValue(t, env, "GIT_TERMINAL_PROMPT", "0")
	assertEnvValue(t, env, "GCM_INTERACTIVE", "never")
}

func assertEnvValue(t *testing.T, env []string, key string, want string) {
	t.Helper()

	prefix := key + "="
	for _, item := range env {
		if strings.HasPrefix(item, prefix) {
			got := strings.TrimPrefix(item, prefix)
			if got != want {
				t.Fatalf("%s = %q, want %q", key, got, want)
			}
			return
		}
	}
	t.Fatalf("%s was not set", key)
}
