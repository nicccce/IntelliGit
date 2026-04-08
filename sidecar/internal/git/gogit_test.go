package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitWithRemote(t *testing.T) {
	// 定义测试目录（在 go test 执行时的相对路径为 ../../test/repo）
	testRepoPath, err := filepath.Abs("../../test/repo")
	if err != nil {
		t.Fatalf("获取绝对路径失败: %v", err)
	}

	// 每次运行前先清理一下目录，保证是全新的空仓库
	_ = os.RemoveAll(testRepoPath)
	if err := os.MkdirAll(testRepoPath, 0755); err != nil {
		t.Fatalf("创建测试目录失败: %v", err)
	}

	// 1. 在该目录下初始化仓库
	repo, err := Init(testRepoPath, false)
	if err != nil {
		t.Fatalf("初始化仓库失败: %v", err)
	}
	t.Logf("✅ 仓库已初始化在: %s", testRepoPath)

	// 2. 添加 remote 仓库
	remoteName := "origin"
	remoteURL := "https://github.com/nicccce/git-test.git"

	if err := repo.AddRemote(remoteName, remoteURL); err != nil {
		t.Fatalf("添加远程仓库失败: %v", err)
	}
	t.Logf("✅ 远程仓库 [%s] 已添加: %s", remoteName, remoteURL)

	// 3. 验证 remote 是否添加成功
	remotes, err := repo.Remotes()
	if err != nil {
		t.Fatalf("获取远程仓库列表失败: %v", err)
	}

	for _, r := range remotes {
		t.Logf("📌 读取到的 Remote — 名称: %s, FetchURL: %s", r.Name, r.FetchURL)
	}
}

func TestAddAndCommit(t *testing.T) {
	testRepoPath, err := filepath.Abs("../../test/repo")
	if err != nil {
		t.Fatalf("获取绝对路径失败: %v", err)
	}

	// 1. 打开前面创建的仓库
	repo, err := Open(testRepoPath)
	if err != nil {
		t.Fatalf("打开仓库失败: %v", err)
	}

	// 2. 新建一个随便的文件
	filename := "hello.txt"
	filepathAbs := filepath.Join(testRepoPath, filename)
	err = os.WriteFile(filepathAbs, []byte("Hello, IntelliGit test repository!\n"), 0644)
	if err != nil {
		t.Fatalf("创建文件失败: %v", err)
	}
	t.Logf("✅ 成功创建文件: %s", filename)

	// 3. 将文件添加到暂存区 (git add)
	err = repo.Add(filename)
	if err != nil {
		t.Fatalf("添加暂存区失败: %v", err)
	}
	t.Logf("✅ 成功添加文件到暂存区")

	// 4. 提交 (git commit)
	hash, err := repo.Commit("Add hello.txt for testing", "Tester", "tester@intelligit.dev")
	if err != nil {
		t.Fatalf("提交失败: %v", err)
	}
	t.Logf("✅ 成功提交，Commit Hash: %s", hash[:8])
}

func TestPushWithoutToken(t *testing.T) {
	testRepoPath, err := filepath.Abs("../../test/repo")
	if err != nil {
		t.Fatalf("获取绝对路径失败: %v", err)
	}

	repo, err := Open(testRepoPath)
	if err != nil {
		t.Fatalf("打开仓库失败: %v", err)
	}

	t.Log("⏳ 正在尝试在无 token 情况下 push 到 origin...")

	// auth 传 nil，不带认证信息去推，并将 os.Stdout 传入以观察底层流出的进度文本
	err = repo.Push("origin", nil, os.Stdout)

	if err != nil {
		// 这是我们预期之内的报错，把它以普通 Log 的形式打印出来看看内容
		t.Logf("✅ 预期之内的报错结果: %v\n", err)
	} else {
		// 如果没报错，反而得让他挂掉
		t.Fatalf("❌ 预期应当报错，但 push 似乎成功了？这通常不正常！")
	}
}

// TestPushWithToken 演示如何通过环境变量安全地传入 Token 进行真实 Push
func TestPushWithToken(t *testing.T) {
	// 核心安全策略：永远不硬编码！从环境变量读取
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		t.Skip("跳过此测试：本地环境未设置 GITHUB_TOKEN，如果需要真实测试请自己设置")
	}

	testRepoPath, err := filepath.Abs("../../test/repo")
	if err != nil {
		t.Fatalf("获取绝对路径失败: %v", err)
	}

	repo, err := Open(testRepoPath)
	if err != nil {
		t.Fatalf("打开仓库失败: %v", err)
	}

	t.Log("🚀 检测到 GITHUB_TOKEN，正在尝试进行带认证的真实 Push...")

	// 组装认证对象（GitHub Token 的 Username 随便填，密码填 token 即可）
	auth := &AuthMethod{
		Username: "token", 
		Password: token,
	}

	// 传入 auth 以及 os.Stdout 观测输出流
	err = repo.Push("origin", auth, os.Stdout)
	if err != nil {
		t.Fatalf("❌ 真实 Push 失败: %v", err)
	}
	
	t.Log("✅ Push 成功！请前往 GitHub 网页端检查对应仓库更新！")
}
