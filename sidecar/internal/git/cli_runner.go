package git

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

type gitCliRunner struct {
	executable string
}

type gitCliRunRequest struct {
	Dir      string
	Args     []string
	Stdin    io.Reader
	Progress io.Writer
}

func newGitCliRunner() *gitCliRunner {
	return &gitCliRunner{executable: "git"}
}

func (r *gitCliRunner) run(req gitCliRunRequest) (string, error) {
	cmd := exec.Command(r.executable, req.Args...)
	cmd.Dir = req.Dir
	cmd.Env = gitCliEnv()
	cmd.Stdin = req.Stdin

	var output bytes.Buffer
	writer := io.Writer(&output)
	if req.Progress != nil {
		writer = io.MultiWriter(&output, req.Progress)
	}
	cmd.Stdout = writer
	cmd.Stderr = writer

	err := cmd.Run()
	return output.String(), err
}

func gitCliEnv() []string {
	return append(os.Environ(),
		"GIT_MERGE_AUTOEDIT=no",
		"GIT_TERMINAL_PROMPT=0",
		"GCM_INTERACTIVE=never",
	)
}

func gitCliError(operation string, output string, err error) error {
	message := strings.TrimSpace(output)
	if message == "" {
		return fmt.Errorf("%s: %w", operation, err)
	}
	return fmt.Errorf("%s: %s: %w", operation, message, err)
}
