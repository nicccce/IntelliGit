# Walkthrough: Electron 与 Go Sidecar 双向通信层的实现 (4月10日)

本文档是为了方便新加入团队的成员快速了解 IntelliGit 中间层（IPC）架构而编写。该中间层连接了上层的 Node.js/Electron（主进程）和底层的 Go（Sidecar 进程）。

---

## 1. 架构总览与核心思想

我们**没有**使用常见的 HTTP 或者 gRPC 进行本地通信，而是采用了一套极其轻量、安全的机制：**基于标准输入输出（stdin/stdout）的 JSON-RPC 协议**。

这和 VS Code 的 Language Server Protocol (LSP) 架构完全一致。它的优势是：
- **无端口占用**：不用担心防火墙拦截或者本地端口冲突。
- **生命周期绑定**：Electron 主进程一关，Go 进程通过监听 `EOF` 会自动退出，不会残留僵尸进程。

**整体通信流程如下：**
1. **渲染进程 (Vue/React)** 通过 `window.electronAPI.invokeGit` 触发 IPC。
2. **主进程 (Node.js)** 生成唯一的 `RequestID`，组装成 JSON，通过 `stdin.write` 喂给 Go 进程，并将对应的 `Promise` 存起来。
3. **Sidecar 进程 (Go)** 监听 `stdin`，一行一行读取 JSON，解析出命令并交由 `Router` 路由给具体的处理函数。
4. **Sidecar 进程 (Go)** 将执行结果包装成 JSON，通过 `stdout` 打印出来。
5. **主进程 (Node.js)** 监听 `stdout`，读到 JSON 后，根据 `RequestID` 找回那个 `Promise` 并 `resolve()` 返回给渲染进程。

---

## 2. 核心模块与文件解读

为了实现这个连接，我们在项目两端分别做了重要封装，你可以通过阅读这几个核心文件来快速上手。

### 2.1 Node.js 端 (Electron Main)

| 文件 | 作用 | 重点要看的代码 |
|------|------|----------------|
| `src/main/core/SidecarManager.ts` | **核心通信枢纽**。负责子进程的生命周期。 | 1. `processBuffer()`: 如何防止 JSON 粘包。<br>2. `send()`: 如何把发出的请求挂起等待。<br>3. `tryAutoRestart()`: 防无限重启逻辑（5秒稳定期）。<br>4. `createProxy()`: 如何实现无感调用。 |
| `src/shared/types/sidecar.ts` | Node 与 Go 端互通的数据结构定义。 | `SidecarRequest` 和 `SidecarResponse`，这是我们约定的通信底线。 |
| `src/main/ipc/gitHandlers.ts` | IPC 注册。 | 这里将渲染进程的请求转发给了 `SidecarManager`。 |
| `src/preload/index.ts` | 上下文隔离的安全网。 | 渲染层如何监听 Go 传来的主动通知（如克隆进度条）。 |

**黑科技：Proxy 无感调用**
在前端，我们用了一个 `Proxy` 拦截了所有对 `git` 对象的属性访问，并自动将它们转换为底层的 `send` 发送命令。
这让业务代码写起来像这样舒服：`const status = await git['staging.status']({ path: '/xxx' })`，完全感觉不到底层的管道交互。

### 2.2 Go 端 (Sidecar)

| 文件 | 作用 | 重点要看的代码 |
|------|------|----------------|
| `sidecar/cmd/sidecar/main.go` | **Go 进程的主入口**。 | 那个 `for { ... }` 死循环，它是如何一行行读数据，读到 `EOF` 就退出的。 |
| `sidecar/internal/protocol/codec.go` | **编解码器**。 | 包含了读取上限扩展至 `10MB` 的 `bufio.Scanner`（防大 diff 爆内存），以及带锁的 `WriteResponse`。 |
| `sidecar/internal/handler/router.go` | **路由分发中心**。 | 如何把类似 `"repo.open"` 的字符串分配给对应的 Go 函数。 |
| `sidecar/internal/handler/handlers.go` | **具体的业务逻辑**。 | 所有的 Git 操作最终都在这里实现，这里也是我们后续日常开发主要修改的文件。 |
| `sidecar/internal/handler/registry.go` | **接口注册清单**。 | 记录了所有对外暴露的方法映射表。 |

---

## 3. 如何为项目添加一个新的接口？

如果你接到了需求，要在 IntelliGit 中加入一个新的底层功能（比如获取某个文件的 diff），你只需要做两步，就可以连通两层：

**步骤 1：在 Go 层写好业务逻辑并注册**
1. 在 `sidecar/internal/handler/handlers.go` 中新增一个符合签名的函数：
   ```go
   func handleMyNewFeature(ctx *Context) (any, error) {
       // 通过 ctx.Bind() 解析前端传来的参数
       // 执行 go-git 逻辑...
       return resultData, nil
   }
   ```
2. 在 `sidecar/internal/handler/registry.go` 中，给这个函数起个名字暴露出去：
   ```go
   r.Register("my.newFeature", handleMyNewFeature)
   ```

**步骤 2：在渲染进程直接调用**
在前端代码中，完全不用写任何额外的通信代码，直接通过 `electronAPI` 调用刚才你注册的名字即可：
```javascript
const result = await window.electronAPI.invokeGit("my.newFeature", { param1: "abc" });
```

---

## 4. 常见问题排查 (Troubleshooting)

如果你在运行项目时发现前后端连不上，最常见的可能是以下两种：

### Q1: `[SidecarManager] 进程启动失败: spawn ENOENT`
这是因为 Node.js 去找编译好的 Go 二进制文件（Sidecar）没找到。
**解决办法**：在 `sidecar` 目录下运行 `go build -o ../resources/intelligit-sidecar.exe ./cmd/sidecar/` 重新编译出二进制文件供 Electron 使用。

### Q2: 请求一直 pending 不返回
如果发现调用 `invokeGit` 后 `await` 一直卡住：
1. 去 Go 代码里看是不是那个 `handler` 函数由于网络或死锁阻塞了，一直没返回。如果没返回，Go 就不会写 `stdout`，Node 就一直等，直到触发 `30_000ms`（30秒）超时。
2. 检查你传回来的 `Data` 里面是不是包含了不支持 JSON 序列化的奇怪数据结构（如 Channel、不支持的指针类型）。

---
*(本文档归档于 docs/lxy 目录，随时欢迎根据最新的重构进行更新。)*
