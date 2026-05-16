package git

type gitCliBackend struct {
	path   string
	runner *gitCliRunner
}

func newGitCliBackend(path string) *gitCliBackend {
	return &gitCliBackend{
		path:   path,
		runner: newGitCliRunner(),
	}
}
