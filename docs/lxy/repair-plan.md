# IntelliGit 性能优化修复执行计划（Agent 专用）

> **⚠️ 致执行 Agent 的特别授权说明**
> 本计划列出的修改步骤及代码片段为核心指导方向。在实际执行过程中，如果在不偏离功能初衷和优化效果的前提下，发现原计划中的设计不够鲁棒（例如：缺乏 Panic 恢复、锁粒度过粗导致读写死锁、缺少并发数限制、或者前端缺少网络请求的防重入保护等），**充分授权执行 Agent 在代码结构和系统鲁棒性上进行适当增强与防御性编程**。请以实现工业级高可用性为标准，无需完全拘泥于本文档中给出的基础或简化版示例代码。

## 优化目标概述

目前 IntelliGit 存在启动极慢、白屏时间长、前端请求堆积导致进程卡死的问题。根本原因在于：
1. Go 端使用了 $O(n^2)$ 的线性扫描比对。
2. Go 端 `main.go` 主循环为串行阻塞处理，无法并发。
3. `repository.go` 缺少并发锁保护。
4. 前端启动时，`remote.fetch` (网络 IO) 阻塞了本地状态的刷新。
5. 前端每秒轮询缺乏“防重入锁”，导致前一个请求未完成时，下一个请求又发了过来，形成堆积。

下面是分发给你的具体修复步骤。

---

## 阶段一：Go Sidecar 并发改造与锁保护

### 1. 修改 `sidecar/cmd/sidecar/main.go`（开启并发处理）
**目标文件**：`e:\IntelliGit\sidecar\cmd\sidecar\main.go`
**行动**：将主循环中的同步 `Dispatch` 和 `WriteResponse` 放入 `goroutine` 中并发执行。

**原始代码 (~L53)**:
```go
		// 分发请求并获取响应
		resp := router.Dispatch(req)

		// 写入响应
		if err := codec.WriteResponse(resp); err != nil {
			log.Printf("写入响应失败: %v", err)
		}
```

**修改为**:
```go
		// 异步分发请求并获取响应
		go func(r *protocol.Request) {
			resp := router.Dispatch(r)

			// codec.WriteResponse 内部已经有 mu.Lock() 保护，并发安全
			if err := codec.WriteResponse(resp); err != nil {
				log.Printf("写入响应失败: %v", err)
			}

			if resp.Success {
				log.Printf("请求完成: id=%s ✓", r.ID)
			} else {
				log.Printf("请求失败: id=%s error=%s", r.ID, resp.Error)
			}
		}(req)
```
*(注意移除外层原本的日志打印，因为并发执行时请求完成的日志必须在 goroutine 内打印)*

### 2. 修改 `sidecar/internal/git/repository.go`（添加并发锁）
**目标文件**：`e:\IntelliGit\sidecar\internal\git\repository.go`
**行动**：为 `Repository` 结构体增加 `sync.RWMutex`，并在所有对 `r.goGit` 的调用外层包裹读锁或写锁。

**修改 2.1：增加包引入**
确保文件头部 import 了 `"sync"`。

**修改 2.2：增加字段**
```go
type Repository struct {
	path  string
	goGit *goGitBackend
	cli   *gitCliBackend
	mu    sync.RWMutex // 新增：并发保护锁
}
```

**修改 2.3：为方法加锁**
在 `Repository` 所有的读方法（如 `Status()`, `DiffWorkdir()`, `DiffStaged()`, `Log()`, `Branches()` 等）中包裹读锁：
```go
func (r *Repository) Status() ([]FileStatus, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.goGit.Status()
}
```
在所有写方法（如 `Add()`, `Remove()`, `Commit()`, `Fetch()`, `Checkout()` 等）中包裹写锁：
```go
func (r *Repository) Add(path string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.goGit.Add(path)
}
```
*(请代理 Agent 自行遍历并为 `Repository` 中的公开方法分别添加 RLock 和 Lock)*

---

## 阶段二：消灭 $O(n^2)$ 线性扫描性能黑洞

### 3. 修改 `sidecar/internal/git/staging.go`
**目标文件**：`e:\IntelliGit\sidecar\internal\git\staging.go`
**问题**：`Status()` 方法中使用了 `for _, entry := range idx.Entries` 线性查找。
**行动**：使用 Map 将复杂度降为 $O(1)$。

**在 `var result []FileStatus` 之前（约 L32 行），添加如下代码构建 Map**：
```go
	// 预先将 Index 构建为 map 以实现 O(1) 查找
	indexMap := make(map[string]*index.Entry)
	if idx != nil {
		for _, entry := range idx.Entries {
			indexMap[entry.Name] = entry
		}
	}
	
	var result []FileStatus
```

**在 `s.Worktree == gogit.Modified` 分支中（约 L39 行），替换查找逻辑**：
```diff
-			if idx != nil {
-				for _, entry := range idx.Entries {
-					if entry.Name == path {
-						if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
-							if reader, rErr := blob.Reader(); rErr == nil {
-								data, _ := io.ReadAll(reader)
-								reader.Close()
-								refContent = string(data)
-							}
-						}
-						break
-					}
-				}
-			}
+			if entry, ok := indexMap[path]; ok {
+				if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
+					if reader, rErr := blob.Reader(); rErr == nil {
+						data, _ := io.ReadAll(reader)
+						reader.Close()
+						refContent = string(data)
+					}
+				}
+			}
```

**在 `s.Staging == gogit.Modified` 分支中（约 L86 行），进行相同替换**：
将针对 `indexContent` 赋值时的 `for _, entry := range idx.Entries` 循环，同样替换为通过 `indexMap[path]` 直接获取。

### 4. 修改 `sidecar/internal/git/diff.go`
**目标文件**：`e:\IntelliGit\sidecar\internal\git\diff.go`
**行动**：
1. 像 `staging.go` 一样，在 `DiffWorkdir()` 和 `DiffStaged()` 的入口处（循环外部）构建 `indexMap`。
2. 替换内部的线性扫描。

---

## 阶段三：前端瀑布流与请求堆积优化

### 5. 修改 `src/renderer/src/services/refreshCoordinator.ts`
**目标文件**：`e:\IntelliGit\src\renderer\src\services\refreshCoordinator.ts`
**问题**：
1. `refreshAllLocal()` 被1秒轮询调用，但没有任何防重入锁，导致请求互相踩踏。
2. `refreshAll()` 被首屏加载调用，其中 `this.refreshRemote()` (Fetch 网络 IO) 阻塞了后续的首屏本地文件列表显示。

**行动 5.1：增加防重入标记位**
在 `RefreshCoordinator` 类中增加字段：
```typescript
    private isRefreshingLocal = false
```

**行动 5.2：改造 `refreshAllLocal`**
```typescript
    async refreshAllLocal(): Promise<void> {
        if (this.isRefreshingLocal) return; // 防重入保护
        this.isRefreshingLocal = true;
        try {
            await Promise.all([
                this.refreshStatus(),
                this.refreshHistory(),
                this.refreshBranchState(),
            ])
            await this.syncSelectedFileDiff()
        } finally {
            this.isRefreshingLocal = false;
        }
    }
```

**行动 5.3：释放首屏加载 `refreshAll`**
将 `refreshRemote` 剥离出 Promise.all 的等待阻塞。
```typescript
    async refreshAll(): Promise<void> {
        // 让远端 fetch 默默在后台跑，不阻塞 await
        this.refreshRemote().catch(console.error)

        // 优先保证本地数据秒刷出来
        await Promise.all([
            this.refreshStatus(),
            this.refreshHistory(),
        ])
        await this.syncSelectedFileDiff()
    }
```

---

## 阶段四：消除重复打开仓库的性能浪费

### 6. 优化 `handleRepoOpen` (可选但推荐)
**说明**：当前主进程和渲染进程初始化时都会执行 `repo.open` 命令。
如果需要的话，可以在 Go 侧 `handlers.go` 中检查 `r.repo.Path() == req.Path`，如果是则直接返回成功，跳过实际的 `git.PlainOpen`。
（此部分可以作为进阶优化交给代理自行判断）。

---

## 阶段五：彻底重构 Myers Diff 算法（回溯法）

### 7. 修改 `sidecar/internal/git/diff.go` 中的 `myersDiff` 算法
**目标文件**：`e:\IntelliGit\sidecar\internal\git\diff.go`
**问题**：当前的 `myersDiff` 在每一步搜索都通过 `make` 和 `copy` 深度拷贝了整个演进切片，导致 O(D^2) 的巨大内存开销和 GC 压力。
**行动**：重构为标准的回溯法 Myers Diff 算法：
1. **取消路径切片拷贝**：不再存储 `paths` 切片。使用一个 2D 切片（或基于 D 动态扩展的记录表）`trace` 来保存每一步 $d$ 搜索完成后，各个对角线 $k$ 上的最远 $x$ 坐标值。
2. **两阶段执行**：
   - 第一阶段（前向搜索）：在网格中仅计算和记录 $x$ 的最远到达点，直到 $x \ge N$ 且 $y \ge M$。
   - 第二阶段（反向回溯）：从终点 $(N, M)$ 开始，依据之前存储的 `trace` 状态表，反向推导每一步是如何从前一步走过来的（向上走 = Delete，向左走 = Add，沿对角线走 = Equal），直到回到起点 $(0,0)$。
3. **将回溯路径翻转**：反向推导出的操作列表是倒序的，最后将其翻转为正序操作并返回。

**执行 Agent 请注意：开始工作前，请通读本指南。先做 Go 后端，再做 TypeScript 前端。祝好运！**
