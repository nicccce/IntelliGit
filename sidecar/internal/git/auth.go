package git

import (
	"errors"
	"fmt"
	"strings"

	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
)

// AuthMethod 封装认证信息，支持 HTTP(S) 和 SSH。
type AuthMethod struct {
	Username string
	Password string

	SSHKeyPath  string
	SSHPassword string
}

func wrapAuthError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, transport.ErrAuthenticationRequired) ||
		errors.Is(err, transport.ErrAuthorizationFailed) {
		return fmt.Errorf("认证失败，请在设置页检查凭据配置: %w", err)
	}

	errMsg := err.Error()
	if strings.Contains(errMsg, "authentication") ||
		strings.Contains(errMsg, "Authorization") ||
		strings.Contains(errMsg, "401") ||
		strings.Contains(errMsg, "403") {
		return fmt.Errorf("认证失败，请在设置页检查凭据配置: %w", err)
	}
	return err
}

func resolveAuth(auth *AuthMethod) transport.AuthMethod {
	if auth == nil {
		return nil
	}
	if auth.SSHKeyPath != "" {
		keys, err := gitssh.NewPublicKeysFromFile("git", auth.SSHKeyPath, auth.SSHPassword)
		if err == nil {
			return keys
		}
	}
	if auth.Username != "" || auth.Password != "" {
		return &http.BasicAuth{
			Username: auth.Username,
			Password: auth.Password,
		}
	}
	return nil
}
