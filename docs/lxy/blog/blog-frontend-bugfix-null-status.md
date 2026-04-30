> 本文为山东大学软件学院创新实训项目博客

# 记一次 JSON null 解析导致的 Bug

在 IntelliGit 的前后端联调联试阶段，我遇到了一个极其“玄学”的 Bug。

这个 Bug 的表现非常诡异：当你在界面中修改文件、加入暂存、然后点击提交后，系统提示“提交成功”。但奇怪的是，**被提交的文件却依然像个“钉子户”一样，死死地霸占着界面的暂存区列表，始终不肯消失。**

这并非简单的界面刷新延迟，背后隐藏着一个经典的跨语言边界陷阱。今天这篇博客，我将带你重温这个抓虫过程，看看这个“隐形炸弹”是如何引爆的，以及我们该如何优雅地拆除它。

---

## 一、 问题现象

Bug 发生后的第一反应是怀疑：**会不会是底层的 `go-git` 库有缓存，没有实时读取到文件系统的更新？**

为了验证这一点，我直接通过终端进入了那个测试仓库，敲下了 `git status`。
命令行清晰地回显：
```text
On branch master
nothing to commit, working tree clean
```
这意味着，底层的 Git 工作区其实已经被清空了，状态完全正常。

既然底层状态没问题，那问题一定出在“Go 获取状态 -> 序列化发送 -> Node/JS 接收解析 -> 更新 UI”这条漫长的数据链路上。

---

## 二、 问题排查

为了弄清楚 Go 究竟传了什么数据给前端，我决定跳过所有中间层，直接写一个原生的 Go 测试脚本去调底层 API：

```go
// test_status.go
package main

import (
	"fmt"
	"intelligit-sidecar/internal/git"
)

func main() {
    // 直接打开目标仓库测试
	repo, _ := git.Open("E:\\IntelliGit\\sidecar\\test\\repo")
	st, _ := repo.Status()
    // 打印出来的状态结果是什么？
	fmt.Printf("%+v\n", st) 
}
```
运行脚本后，控制台输出了一个空空如也的 `[]`。
这就更奇怪了。底层的确老老实实地返回了一个空的数组（Slice），说明文件列表的确空了。

带着疑问，我转头检查前端接收这些数据的代码逻辑。在 `useAppStore.ts` 里，我是这样接收数据的：

```typescript
// 前端接收状态的逻辑
const response = await window.electronAPI.invokeGit('staging.status')

// 🚨 危险代码就在下面这行：
if (response.success && response.data) {
    set({ fileStatuses: response.data as FileStatusInfo[] })
}
```
看到这里，我脑海中闪过一丝灵光。真相大白。

---

## 三、 原因分析

其实问题就出在这个看似再正常不过的 `if` 判空逻辑上。

在 Go 端的代码 `staging.go` 里，我们是这样组装状态数据的：
```go
// 声明一个切片，此时它的值是 nil
var result []FileStatus

for path, s := range status {
    // 只有当存在修改过的文件时，才会 append
    result = append(result, FileStatus{...})
}

// 直接将这个 result 返回并序列化为 JSON
return result, nil
```

**关键点：Go 语言的 `nil` 切片在 JSON 序列化时的特殊行为。**
当文件没有任何变化时，`for` 循环一次都没走，`result` 切片没有被分配底层数组，它实际上是一个 `nil` 值。
当 Go 标准库 `encoding/json` 对一个 `nil` 切片执行序列化（`json.Marshal`）时，**它并不会把它转换成我们期待的 `[]`（空数组），而是把它变成了字面量上的 `null`。**

于是，这个 `null` 就顺着 IPC 管道一路跑到了前端 JS 代码里。此时的 `response.data` 变成了 `null`。

而在 JavaScript 的世界里，`null` 是一种**假值 (falsy)**。
当 JS 引擎执行到 `if (response.success && response.data)` 时：
1. `response.success` 是 `true`。
2. 但 `response.data` (值为 `null`) 在逻辑判断中被等效成了 `false`。
3. 整个条件判断失败，**状态更新函数被无情地跳过**！

最终结果就是：前端的 Zustand Store 里的 `fileStatuses` 根本没有被覆盖，上一次带旧文件的列表数据被永远留在了界面上。

---

## 四、 解决办法

查明原因后，修复方案非常简单粗暴。

既然我们知道了 Go 在某些空集合的情况下可能会甩一个 `null` 过来，那我们在前端就不要用 `.data` 本身作为前置的真值判断条件，而是要用短路或 `||` 运算符给它强行穿上一件“铁布衫”兜底：

```typescript
// 修复后的 useAppStore.ts
refreshStatus: async () => {
    const response = await window.electronAPI.invokeGit('staging.status')
    // 只要接口返回成功，就不管 data 是不是 null
    if (response.success) {
        // 关键点：如果是 null，强转为一个空数组 [] 喂给 Store
        set({ fileStatuses: (response.data as FileStatusInfo[]) || [] })
    }
}
```

为了防患于未然，我顺手把处理“分支列表”和“提交历史”的地方也全部加上了相同的空值兜底。重新编译运行后，Bug 瞬间烟消云散。

为了进一步提升用户体验，我还在此基础上加了一个小魔法：当用户选中仓库时，前端会自动启动一个 `setInterval` 的 3 秒轮询机制，主动去调用 `refreshStatus()`。现在，无论你在外部编辑器怎么改文件，切回 IntelliGit 窗口的 3 秒内，最新的变更状态就会立刻刷新出来。

---

## 五、 总结

这个坑虽然不大，但却是一个极其经典的跨端教训。
它生动地诠释了在强类型语言（如 Go，区分 `nil` 和初始化的空切片）与弱类型语言（如 JS，存在各种 falsy 值陷阱）交接的边界地带，往往潜伏着令人头秃的阻抗不匹配问题。

以后无论是在 Go 里面写后端，还是在 TS 里面接接口，遇到集合类型时，一定要多留个心眼：**“当它是空的时候，它到底是个什么鬼？”**
