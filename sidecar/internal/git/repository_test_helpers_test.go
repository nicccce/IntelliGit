package git

import gogit "github.com/go-git/go-git/v5"

func (r *Repository) GoGitRepo() *gogit.Repository {
	return r.goGit.repo
}
