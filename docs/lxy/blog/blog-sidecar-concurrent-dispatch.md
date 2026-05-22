> 本文为山东大学软件学院创新实训项目博客

# Go Sidecar 主循环并发化改造：让请求不再排队堵在门口

这次我修的是 IntelliGit Go Sidecar 入口处的请求分发问题。

问题本身看起来很小：`sidecar/cmd/sidecar/main.go` 里的主循环在读到一个请求以后，会同步执行 `router.Dispatch(req)`，再同步调用 `codec.WriteResponse(resp)` 写回响应。也就是说，整个 Sidecar 虽然通过 stdin/stdout 支持异步请求 ID，但 Go 端真正处理请求时仍然是一个接一个排队执行。

这在小仓库、少量操作时不明显；但一旦前端启动刷新、状态刷新、历史刷新、远程 fetch 同时发生，问题就会被放大：

```text
前端 Promise.all 并发发请求
  -> Electron Main 逐条写入 Sidecar stdin
  -> Go Sidecar 主循环逐条读取
  -> 第一条请求没处理完，第二条请求只能等
  -> 如果第一条刚好是 remote.fetch 这种网络 IO，后面的 status/log/diff 都会被堵住
```

所以这次修复的目标很明确：**保持 stdin 读取仍然稳定顺序进行，但每个请求的实际处理放进 goroutine 中并发执行。**

---

## 一、原来的主循环为什么会堵住

Sidecar 的入口文件是：

```text
sidecar/cmd/sidecar/main.go
```

原来的主循环大致是这样的：

```go
for {
    req, err := codec.ReadRequest()
    if err != nil {
        if err == io.EOF {
            break
        }
        log.Printf("读取请求失败: %v", err)
        continue
    }

    log.Printf("收到请求: id=%s command=%s", req.ID, req.Command)

    resp := router.Dispatch(req)

    if err := codec.WriteResponse(resp); err != nil {
        log.Printf("写入响应失败: %v", err)
    }

    if resp.Success {
        log.Printf("请求完成: id=%s ✓", req.ID)
    } else {
        log.Printf("请求失败: id=%s error=%s", req.ID, resp.Error)
    }
}
```

这段代码没有语法问题，也很好理解。但它有一个隐藏的结构问题：

```text
ReadRequest
  -> Dispatch
  -> WriteResponse
  -> 再读下一个请求
```

也就是说，`ReadRequest()` 读到请求以后，主循环会一直卡在当前请求的业务处理里。只有当前请求完整处理完、响应写回以后，它才会继续读取下一行 JSON。

这和前端的调用方式是冲突的。

前端很多地方已经是并发模型了，比如刷新时会同时请求：

```text
staging.status
commit.log
branch.current
branch.list
remote.fetch
diff.workdir
```

但这些并发请求到了 Go 端以后，又重新变成了串行队列。于是我们得到一个很尴尬的结果：

```text
前端以为自己在并发
后端实际还在排队
```

如果排在前面的命令只是 `sidecar.ping`，影响不大；但如果排在前面的是 `remote.fetch`、`commit.log`、大文件 `diff.workdir` 这类耗时操作，后面的本地状态刷新就会被无辜牵连。用户看到的现象就是：明明只是想刷新一下文件状态，界面却像是在等网络。

---

## 二、并发化之前先确认 stdout 是否安全

这个改动不能只是在 `Dispatch` 外面随手套一个 `go func()`。因为 Sidecar 和 Electron Main 的通信依赖 stdout 上的一行一条 JSON：

```json
{"id":"1","success":true,"data":{}}
{"id":"2","success":false,"error":"..."}
```

如果多个 goroutine 同时往 stdout 写，而写入过程没有互斥保护，就可能出现两条 JSON 交叉写入：

```text
{"id":"1","success{"id":"2","success":true}
":true}
```

这样 Node 侧就会直接解析失败，整个 IPC 协议会被污染。

所以在动主循环之前，我先检查了协议层：

```text
sidecar/internal/protocol/codec.go
```

里面的 `Codec` 已经有一个 mutex：

```go
type Codec struct {
    scanner *bufio.Scanner
    encoder *json.Encoder
    writer  io.Writer
    mu      sync.Mutex // 保护 writer 的并发写入
}
```

`WriteResponse` 和 `WriteNotification` 都会先加锁：

```go
func (c *Codec) WriteResponse(resp *Response) error {
    c.mu.Lock()
    defer c.mu.Unlock()

    return c.encoder.Encode(resp)
}
```

这说明并发写响应是可行的。多个请求可以并发执行，但最终写 stdout 时会串行进入 `encoder.Encode`，保证每条 JSON 仍然是一行完整消息。

这一步很关键。否则并发化主循环虽然能提高吞吐量，却可能把 IPC 协议本身打坏。

---

## 三、不能无限开 goroutine

修复计划里给出的核心方向是：

```go
go func(r *protocol.Request) {
    resp := router.Dispatch(r)
    codec.WriteResponse(resp)
}(req)
```

这是最小可行版本。但我实际落代码时没有停在这个版本，而是加了一个并发上限：

```go
const maxConcurrentRequests = 8
```

对应主循环里新增了一个带缓冲的 channel：

```go
requestSlots := make(chan struct{}, maxConcurrentRequests)
var wg sync.WaitGroup
```

为什么要加这个限制？

因为 IntelliGit 的 Sidecar 处理的不是普通内存计算，而是 Git 操作。Git 操作里可能包含：

```text
扫描工作区文件
读取 Git index
遍历 commit 历史
生成 diff
执行 git CLI
访问远程仓库
```

如果前端因为轮询、防重入缺失或者用户连续操作，一瞬间打进来几十个请求，我们不应该无上限地创建几十个 goroutine 同时跑 Git 操作。那样虽然“并发”了，但可能把磁盘、CPU、网络和底层 Git 仓库状态一起压垮。

所以这里采用了一个更稳妥的模型：

```text
stdin 继续顺序读取请求
每个请求进入 goroutine 执行
最多同时执行 8 个请求
超过 8 个时，主循环在 requestSlots 处自然背压
```

这相当于一个很轻量的 worker 限流器。它没有引入复杂的任务队列，也没有改变协议，只是给 goroutine 并发加了一个上限。

---

## 四、实际代码改动

最终 `main.go` 的核心逻辑变成了这样：

```go
requestSlots := make(chan struct{}, maxConcurrentRequests)
var wg sync.WaitGroup

for {
    req, err := codec.ReadRequest()
    if err != nil {
        if err == io.EOF {
            log.Println("stdin 已关闭，准备退出")
            break
        }
        log.Printf("读取请求失败: %v", err)
        continue
    }

    log.Printf("收到请求: id=%s command=%s", req.ID, req.Command)

    requestSlots <- struct{}{}
    wg.Add(1)
    go func(r *protocol.Request) {
        defer wg.Done()
        defer func() {
            <-requestSlots
        }()

        handleRequest(router, codec, r)
    }(req)
}

wg.Wait()
log.Println("IntelliGit Sidecar 已退出")
```

这里有几个细节值得记录。

第一，`req` 被显式传进 goroutine：

```go
go func(r *protocol.Request) {
    handleRequest(router, codec, r)
}(req)
```

这样可以避免闭包直接捕获循环变量带来的隐患。虽然现代 Go 对 loop variable 的行为已经改进过，但这里显式传参仍然更清楚，也更符合老代码维护时的直觉。

第二，`requestSlots` 的释放放在 `defer` 里：

```go
defer func() {
    <-requestSlots
}()
```

这样无论请求成功、失败，还是中间出现 panic 恢复，都会释放并发槽位，不会因为某个请求异常导致整个 Sidecar 后续请求全部卡死。

第三，EOF 之后没有立刻退出，而是等待所有在途请求完成：

```go
wg.Wait()
```

这让退出行为更优雅。stdin 关闭只能说明 Electron Main 不再继续发送新请求，并不代表之前已经读到的请求都处理完了。等待在途请求结束，可以避免最后几条响应莫名其妙丢失。

---

## 五、把请求处理拆成小函数

为了不让 `main()` 继续膨胀，我把单个请求的处理拆到了 `handleRequest`：

```go
func handleRequest(router *handler.Router, codec *protocol.Codec, req *protocol.Request) {
    resp := dispatchRequest(router, req)

    if err := codec.WriteResponse(resp); err != nil {
        log.Printf("写入响应失败: %v", err)
    }

    if resp.Success {
        log.Printf("请求完成: id=%s ✓", req.ID)
    } else {
        log.Printf("请求失败: id=%s error=%s", req.ID, resp.Error)
    }
}
```

这个函数只做三件事：

```text
分发请求
写回响应
记录完成日志
```

原来外层主循环里的完成日志也被移到了 goroutine 内部。这个位置调整是必须的，因为并发以后，请求完成顺序不再等于请求读取顺序。

比如请求顺序可能是：

```text
1 remote.fetch
2 staging.status
3 commit.log
```

但完成顺序完全可能变成：

```text
2 staging.status
3 commit.log
1 remote.fetch
```

所以“请求完成”日志必须跟着实际处理逻辑走，不能继续留在主循环里。

---

## 六、补上 panic 恢复

这次我还额外加了一层 `dispatchRequest`：

```go
func dispatchRequest(router *handler.Router, req *protocol.Request) (resp *protocol.Response) {
    defer func() {
        if recovered := recover(); recovered != nil {
            log.Printf("请求处理 panic: id=%s panic=%v", req.ID, recovered)
            resp = &protocol.Response{
                ID:      req.ID,
                Success: false,
                Error:   fmt.Sprintf("请求处理 panic: %v", recovered),
            }
        }
    }()

    return router.Dispatch(req)
}
```

这个不是并发化的必要条件，但它和并发改造非常适合一起做。

原因是：并发以后，每个请求都在独立 goroutine 里跑。如果某个 handler 发生 panic，而我们没有 recover，整个 Go 进程仍然会崩溃。对一个桌面客户端来说，这种行为太脆弱了。

现在的策略是：

```text
单个请求 panic
  -> 记录 stderr 日志
  -> 给对应 request id 返回失败响应
  -> 其他请求继续执行
  -> Sidecar 进程继续存活
```

这对后续排查也更友好。前端至少能拿到带 request id 的失败响应，而不是突然发现 Sidecar 进程消失了。

---

## 七、这次改动后的执行模型

改完以后，Sidecar 的整体执行模型可以概括成：

```text
主 goroutine:
  只负责从 stdin 读取请求
  为每个请求申请并发槽位
  启动请求处理 goroutine
  EOF 后等待在途请求结束

请求 goroutine:
  调用 router.Dispatch
  recover handler panic
  通过 codec.WriteResponse 写回响应
  记录请求完成/失败日志
  释放并发槽位

Codec:
  用 mutex 保证 stdout 写入互斥
```

这个模型没有改变协议格式，也没有要求前端改代码。对 Electron Main 来说，它仍然是：

```text
写入一行请求 JSON
等待对应 id 的响应 JSON
```

区别在于 Go 端不再让一个慢请求堵住后面的所有请求。

---

## 八、为什么这次只改 main.go

这次任务只要求完成修复计划里的第 1 项：

```text
修改 sidecar/cmd/sidecar/main.go（开启并发处理）
```

所以这次没有继续动 `repository.go` 的锁保护，也没有动 `staging.go` / `diff.go` 里的性能优化。

但需要注意的是，主循环并发化只是第一步。它会让多个 Git 请求真正同时进入 handler 和 Repository 层，因此后续第 2 项“给 Repository 增加并发锁”非常重要。

这次的改动解决的是：

```text
请求调度层不再串行堵塞
```

后续锁保护要解决的是：

```text
多个并发请求同时访问当前仓库时的数据安全问题
```

这两个问题是配套的。没有主循环并发化，Repository 锁的收益不明显；没有 Repository 锁，并发化又可能把底层 Git 状态暴露在竞争条件里。

---

## 九、验证结果

改动完成后，我先对入口文件执行了格式化：

```bash
gofmt -w sidecar/cmd/sidecar/main.go
```

然后运行 Go 端测试：

```bash
cd sidecar
go test ./...
```

第一次测试时，命令被当前运行环境的沙箱拦在 Go 构建缓存目录：

```text
open C:\Users\pc23\AppData\Local\go-build\...\*.d: Access is denied
```

这不是代码错误，而是 Go 测试需要写用户级 `go-build` 缓存。提权后重新运行，测试通过：

```text
?    intelligit-sidecar/cmd/sidecar      [no test files]
ok   intelligit-sidecar/internal/git     12.289s
ok   intelligit-sidecar/internal/handler 1.684s
?    intelligit-sidecar/internal/protocol [no test files]
```

最终本次实际修改的代码文件只有：

```text
sidecar/cmd/sidecar/main.go
```

新增的能力包括：

```text
1. 请求处理进入 goroutine，并发执行 Dispatch + WriteResponse。
2. 使用 maxConcurrentRequests 限制最大并发数为 8。
3. 使用 WaitGroup 在 EOF 后等待在途请求完成。
4. 将完成/失败日志移动到请求 goroutine 内部。
5. 增加 panic recover，避免单个 handler 异常拖垮整个 Sidecar。
```

---

## 十、总结

这次修复不算大，但它改到了 IntelliGit Sidecar 的一个关键位置：请求入口。

原来的 Sidecar 更像是一个单窗口柜台：前端哪怕同时递上来很多张单子，后端也只能一张一张办。现在它变成了有限并发模型：多个请求可以同时处理，但仍然有明确的并发上限和 stdout 写入互斥。

它带来的直接收益是：

```text
remote.fetch 不再天然堵住 staging.status
大 diff 不再天然堵住 sidecar.ping
慢请求不再天然拖慢所有后续请求
EOF 退出时不会粗暴丢弃已经读到的请求
单个 handler panic 不会直接杀死整个 Sidecar
```

从架构上看，这一步也为后续优化铺好了路。接下来继续补上 Repository 的读写锁、Status/Diff 的索引 map 优化、前端刷新防重入之后，IntelliGit 的启动刷新链路会从“请求排队等慢操作”逐步变成真正的分层并发模型。

这就是这次 `main.go` 并发化改造的完整记录。
