> 本文为山东大学软件学院创新实训项目博客

# 记一次 Go map 遍历无序导致的文件列表跳动问题

这次遇到的问题非常有意思，甚至可以说有一点“反直觉”。

在 IntelliGit 的变更视图中，界面会把当前仓库里的文件状态分成两个区域：一个是“已暂存”，一个是“未暂存”。正常情况下，如果文件没有继续修改，这两个列表应该保持原样。用户看着界面时，文件顺序也应该稳定，不应该自己动来动去。

但实际测试时却发现：当仓库里的变更文件一多，即使这些文件没有再发生任何修改，暂存区和未暂存区里的文件显示顺序也会隔一会儿变化一次。它不是文件内容变了，也不是用户点了排序按钮，更不是 Git 状态真的发生了变化，而是同一批文件在界面上像被重新洗了一遍牌。

一开始我看到这个现象时非常疑惑：**数据明明一样，为什么遍历出来的顺序还会变？**

这篇博客就记录一下这个神奇发现背后的原因，以及最后是如何通过一个很小的排序修复，让文件列表重新稳定下来的。

---

## 一、问题现象

IntelliGit 的变更视图中有两个文件列表：

```text
已暂存
  -> 已经 git add 进入暂存区的文件

未暂存
  -> 工作区里还没有暂存的修改或未追踪文件
```

前端会定时刷新仓库状态。这样用户即使在外部编辑器里修改文件，切回 IntelliGit 后也能很快看到最新变化。

这个自动刷新逻辑位于 `MainApp.tsx` 中，核心代码大致是：

```tsx
const AUTO_REFRESH_INTERVAL = 3000

timerRef.current = setInterval(() => {
  refreshStatus()
}, AUTO_REFRESH_INTERVAL)
```

也就是说，只要当前打开了仓库，前端每隔 3 秒就会重新请求一次后端的 `staging.status`，把最新文件状态读回来。

按理说，如果这 3 秒内没有任何文件变化，那么后端返回的内容应该和上一次完全一样，前端列表也应该看起来完全一样。

但实际情况是：当变更文件数量较多时，每次自动刷新后，文件列表顺序都有概率发生变化。比如第一次是：

```text
src/main.ts
src/store/useAppStore.ts
sidecar/internal/git/staging.go
docs/requirements.md
```

过几秒刷新后，它可能变成：

```text
docs/requirements.md
sidecar/internal/git/staging.go
src/main.ts
src/store/useAppStore.ts
```

文件还是这些文件，状态也还是这些状态，但顺序变了。

这就非常迷惑。因为一般直觉里，“同一份数据”再次遍历时似乎就应该得到同样的顺序。可这一次，问题恰恰出在这个直觉上。

---

## 二、先看前端：它只是原样渲染

为了确认是不是前端主动打乱了顺序，我先看了 `ChangesView` 里的渲染逻辑。

前端从 Zustand Store 中拿到 `fileStatuses` 后，会根据文件状态分成两个数组：

```tsx
const staged = fileStatuses.filter(
  f => f.staging !== ' ' && f.staging !== '?'
)

const unstaged = fileStatuses.filter(
  f => f.worktree !== ' ' || f.staging === '?'
)
```

然后直接 `map` 渲染：

```tsx
staged.map(f => (
  <div key={`s-${f.path}`} className="ig-file-item">
    <span className="ig-file-path">{f.path}</span>
  </div>
))
```

未暂存列表也是一样：

```tsx
unstaged.map(f => (
  <div key={`u-${f.path}`} className="ig-file-item">
    <span className="ig-file-path">{f.path}</span>
  </div>
))
```

这里有两个重要结论：

1. 前端没有调用 `sort()`。
2. 前端只是按后端返回数组的顺序进行过滤和渲染。

`filter()` 会保留原数组中元素的相对顺序，它不会主动打乱数组。因此，如果界面顺序变了，大概率说明 `fileStatuses` 这个原始数组本身顺序已经变了。

继续往上追，`fileStatuses` 是在 `useAppStore.ts` 的 `refreshStatus()` 中更新的：

```ts
const response = await window.electronAPI.invokeGit('staging.status')

if (response.success) {
  set({ fileStatuses: (response.data as FileStatusInfo[]) || [] })
}
```

也就是说，前端没有额外处理排序，它完全信任后端传回来的顺序。

所以问题被进一步缩小到后端：**`staging.status` 每次返回的文件数组顺序为什么不稳定？**

---

## 三、真正的源头：go-git 的 Status 是一个 map

后端获取文件状态的函数在 `sidecar/internal/git/staging.go` 中。原来的代码逻辑非常简单：

```go
func (r *Repository) Status() ([]FileStatus, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}

	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}

	var result []FileStatus
	for path, s := range status {
		result = append(result, FileStatus{
			Path:     path,
			Staging:  toStatusCode(s.Staging),
			Worktree: toStatusCode(s.Worktree),
		})
	}
	return result, nil
}
```

表面上看，这段代码没有任何问题：

```text
调用 wt.Status()
  -> 遍历每个文件状态
  -> 转换成自己的 FileStatus
  -> 返回给前端
```

但关键就在这一行：

```go
for path, s := range status
```

这里的 `status` 并不是一个有序数组，而是 `go-git` 里的 `git.Status`。继续翻 go-git 的源码，可以看到它的定义：

```go
// Status represents the current status of a Worktree.
// The key of the map is the path of the file.
type Status map[string]*FileStatus
```

也就是说，`wt.Status()` 返回的本质是：

```go
map[string]*FileStatus
```

它是一个 map，key 是文件路径，value 是文件状态。

到这里，答案已经非常接近了：Go 语言中的 map 本来就不是有序容器。

---

## 四、我第一次真正意识到：内容一样，遍历顺序也可以不一样

这次最让我印象深的点就在这里。

以前知道 map 是“无序”的，但很多时候只是把它当成一个抽象概念：它不像数组那样有第 0 项、第 1 项、第 2 项。可是这次 Bug 让我第一次非常具体地感受到：**所谓无序，不只是说它没有业务意义上的顺序，而是说同一份内容在遍历时也不能期待它保持同样顺序。**

换句话说，就算 map 里面装的键值对完全一样：

```text
src/main.ts                  -> M
src/store/useAppStore.ts      -> M
docs/requirements.md          -> M
sidecar/internal/git/staging.go -> M
```

下一次执行：

```go
for path, s := range status
```

遍历出来的顺序也没有任何承诺。

它可能这次先吐出 `src/main.ts`，下次先吐出 `docs/requirements.md`。从 Go 语言的角度看，这完全合法，因为 map 的职责是根据 key 快速查找 value，而不是维护插入顺序或字典序。

这就解释了为什么文件少的时候问题不明显，文件一多就很容易看出来。

当只有一两个文件时，即使顺序随机，人眼也不一定能感知；但当有几十个文件时，每 3 秒刷新一次，如果后端每次都把 map 遍历结果直接 append 成数组返回，前端界面就会表现成一种非常明显的“列表跳动”。

这个 Bug 的完整链路可以写成：

```text
前端每 3 秒调用 refreshStatus()
  -> Electron IPC 调用 staging.status
  -> Go Sidecar 调用 wt.Status()
  -> go-git 返回 git.Status，也就是 map[string]*FileStatus
  -> 后端直接 range map 并 append 到 slice
  -> Go map 遍历顺序不稳定
  -> 后端每次返回的数组顺序可能不同
  -> 前端原样 filter + map 渲染
  -> 暂存区/未暂存区文件列表看起来随机换位
```

所以，这不是 React 的 key 出错，也不是 Zustand 状态异常，更不是 Git 文件真的被修改了。根因非常朴素：**后端把一个无序集合直接包装成了有序列表。**

---

## 五、为什么前端 key 没能解决这个问题

在排查过程中还有一个容易误会的点：React 列表不是已经写了 `key` 吗？

代码里确实有：

```tsx
<div key={`s-${f.path}`} className="ig-file-item">
```

以及：

```tsx
<div key={`u-${f.path}`} className="ig-file-item">
```

这些 key 是必要的，它们可以帮助 React 识别“这个 DOM 节点对应的是哪一个文件”。但是，key 只能帮助 React 在列表更新时复用节点，不能替我们决定列表应该按什么顺序排列。

如果后端这次返回：

```text
A, B, C, D
```

下一次返回：

```text
C, A, D, B
```

那么 React 会很认真地把这些节点移动到新的顺序。因为从 React 的角度看，新的数组顺序就是新的 UI 顺序。

所以 key 解决的是“元素身份”的问题，不解决“排序规则”的问题。

真正需要补上的，是一个明确、稳定、可重复的排序规则。

---

## 六、修复方式：返回前按 Path 排序

既然根因是后端返回数组顺序不稳定，最直接的修复就是在 `Status()` 返回前排序。

这次选择在 Go Sidecar 里修，而不是在前端渲染前修，原因也很简单：`staging.status` 是一个后端能力，前端只是它的一个消费者。只要后端保证这个接口返回稳定顺序，那么之后无论哪个视图、哪个模块复用它，都能拿到一致的数据。

修复后的代码如下：

```go
import (
	"errors"
	"fmt"
	"sort"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/format/index"
)
```

在组装完 `result` 后，增加一段排序：

```go
sort.Slice(result, func(i, j int) bool {
	return result[i].Path < result[j].Path
})
return result, nil
```

完整链路就变成了：

```text
wt.Status() 返回 map
  -> range map 得到临时 slice
  -> sort.Slice 按 Path 升序排序
  -> 返回稳定数组给前端
  -> 前端按稳定数组渲染
```

这样一来，即使 map 每次遍历出来的临时顺序不同，只要里面的文件集合没有变化，最终排序后的数组就会保持一致。

也就是说，map 可以无序，但接口返回给 UI 的数据必须有序。

---

## 七、修复后的验证

修复完成后，我对 Go Sidecar 跑了一遍测试：

```powershell
go test ./...
```

测试通过：

```text
ok  	intelligit-sidecar/internal/git
```

这个修复本身不复杂，但它改变的是数据契约的稳定性。之前 `Status()` 虽然返回的是 `[]FileStatus`，看起来像一个有顺序的列表，但实际上这个顺序只是 map 遍历时偶然产生的结果。现在加上显式排序后，这个数组才真正拥有了稳定的业务顺序。

---

## 八、这次问题的启发

这次 Bug 给我的启发非常具体：**当一个无序数据结构要跨过接口边界，变成 UI 上可见的列表时，一定要主动定义排序规则。**

后端内部使用 map 没有问题。map 很适合做状态收集，因为它可以用文件路径作为 key，快速合并和查询每个文件的状态。但只要它要被转换成数组返回给前端，就必须想清楚这个数组的顺序含义。

如果不排序，就等于把底层容器的不确定性暴露给了用户界面。用户看到的就不是“数据没变”，而是“界面自己动了”。

这次修复最后只加了几行代码：

```go
sort.Slice(result, func(i, j int) bool {
	return result[i].Path < result[j].Path
})
```

但它背后的教训很值得记住：

```text
map 适合做查找
slice 适合做展示
从 map 到 slice 的那一步，必须补上排序
```

我也是第一次这么直观地意识到：原来真的会出现“内容完全一样，但遍历顺序就是不一样”的情况。

这个发现很小，但很真实。它提醒我，很多看起来玄学的 UI 抖动，最后可能都来自一个非常底层、非常朴素的数据结构特性。只要顺着数据链路一点点往下追，所谓“随机变化”最终也会变成可以解释、可以修复的工程问题。
