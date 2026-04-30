> 本文为山东大学软件学院创新实训项目博客

# Sidecar 构建链路与 npm 脚本调整记录

这次我主要整理了 IntelliGit 里 Go Sidecar 和 Electron 构建流程之间的关系。最开始只是因为运行时 sidecar 二进制没有跟着源码更新，导致前端调用新命令失败；但我顺着问题查下去以后，发现这里其实需要把 npm 脚本的职责重新梳理清楚。

我最后做的事情，是新增一个 `build:sidecar` 流程，让 `npm run dev` 和 `npm run build` 在启动或构建前都能尽量准备好最新的 sidecar 二进制，同时又不强制所有前端开发者都安装 Go。

---

## 一、Electron 实际运行的 sidecar

项目里有 Go 源码，也有编译后的二进制。源码在：

```text
sidecar/
```

但 Electron 启动时并不会直接运行源码，也不会运行我临时编译在 `sidecar/cmd/sidecar/` 下的 exe。真正被主进程启动的是 `resources` 目录里的二进制。

我在 `src/main/core/SidecarManager.ts` 里确认了这个逻辑：

```ts
private resolveBinaryPath(): string {
  const binaryName =
    process.platform === 'win32'
      ? 'intelligit-sidecar.exe'
      : 'intelligit-sidecar'

  if (is.dev) {
    return join(app.getAppPath(), 'resources', binaryName)
  }

  return join(process.resourcesPath, binaryName)
}
```

所以在开发环境下，实际运行的是：

```text
resources/intelligit-sidecar.exe
```

这也解释了为什么 Go 源码改了以后，软件不一定立刻表现出新逻辑。只改源码是不够的，我还必须重新编译并覆盖 `resources/intelligit-sidecar.exe`。

---

## 二、不能硬写 go build 的原因

一开始我想到的最直接方案是把编译命令写进 `package.json`：

```json
"build:sidecar": "cd sidecar && go build -o ../resources/intelligit-sidecar.exe ./cmd/sidecar"
```

然后让 `dev` 和 `build` 都先执行它。

这个方案能解决“旧二进制没更新”的问题，但它有一个明显缺点：不是所有开发者本地都有 Go 环境。有些人可能只是做前端 UI，或者只是跑 Electron 壳子，如果每次 `npm run dev` 都强制要求 Go，那项目的启动门槛就变高了。

所以我没有采用硬写 `go build` 的方式，而是新增了一个 Node 脚本：

```text
scripts/build-sidecar.mjs
```

这个脚本负责更温和地处理 sidecar 构建。

---

## 三、build-sidecar 脚本策略

我给 `scripts/build-sidecar.mjs` 设计了四种情况：

1. 如果设置了 `INTELLIGIT_SKIP_SIDECAR_BUILD=1`，就跳过 Go 编译。
2. 如果本机有 Go，就重新编译 sidecar 到 `resources/`。
3. 如果本机没有 Go，但 `resources` 里已经有 sidecar 二进制，就打印 warning 后继续。
4. 如果本机没有 Go，而且也没有现成二进制，才报错退出。

核心路径处理是跨平台的：

```js
const binaryName =
  process.platform === 'win32'
    ? 'intelligit-sidecar.exe'
    : 'intelligit-sidecar'

const outputPath = join(rootDir, 'resources', binaryName)
```

跳过构建的逻辑是：

```js
if (process.env.INTELLIGIT_SKIP_SIDECAR_BUILD === '1') {
  if (existsSync(outputPath)) {
    console.warn(`[build:sidecar] Skipping Go build; using existing ${outputPath}`)
    process.exit(0)
  }

  console.error('[build:sidecar] Sidecar build was skipped, but no sidecar binary exists in resources/.')
  process.exit(1)
}
```

检测 Go 环境时，我没有依赖 npm 或 shell 特性，而是直接执行：

```js
const goVersion = spawnSync('go', ['version'], { stdio: 'ignore' })
```

如果 Go 不存在，但二进制存在，我就继续：

```js
if (goVersion.error || goVersion.status !== 0) {
  if (existsSync(outputPath)) {
    console.warn(`[build:sidecar] Go was not found; using existing ${outputPath}`)
    process.exit(0)
  }

  console.error('[build:sidecar] Go was not found and no sidecar binary exists in resources/.')
  process.exit(1)
}
```

真正编译时，我让 Go 在 `sidecar` 目录下执行：

```js
spawnSync(
  'go',
  ['build', '-o', outputPath, './cmd/sidecar'],
  {
    cwd: sidecarDir,
    stdio: 'inherit'
  }
)
```

这样以后只要有 Go 环境，开发和构建都会尽量刷新 sidecar；没有 Go 的开发者也不会因为这个脚本直接卡死。

---

## 四、package.json 脚本含义调整

我在 `package.json` 里新增了：

```json
"build:sidecar": "node scripts/build-sidecar.mjs"
```

然后把开发入口和构建入口都串上它：

```json
"dev": "npm run build:sidecar && electron-vite dev",
"dev:test": "npm run build:sidecar && cross-env ELECTRON_MODE=test electron-vite dev",
"dev:main": "npm run build:sidecar && cross-env ELECTRON_MODE=main electron-vite dev",
"build": "npm run build:sidecar && npm run typecheck && electron-vite build"
```

这样我以后改完 Go Sidecar 源码，再跑 `npm run dev` 或 `npm run build` 时，就不会那么容易忘记刷新运行时二进制。

同时我也重新明确了几个命令的职责。

### `npm run dev`

这个命令是开发启动。现在它会先准备 sidecar，然后启动 Electron Vite：

```text
build:sidecar -> electron-vite dev
```

### `npm run build`

这个命令不是安装包构建。它是应用代码的生产构建，主要输出到：

```text
out/
```

它现在会执行：

```text
build:sidecar -> typecheck -> electron-vite build
```

所以我现在对 `npm run build` 的理解是：它负责把主进程、preload 和 renderer 都构建出来，但不负责生成 `dist` 里的安装包。

### `npm run build:unpack`

这个命令会生成免安装版目录：

```text
dist/win-unpacked
```

它适合我本地验证打包后的软件是否能运行，尤其适合检查 `resources/intelligit-sidecar.exe` 有没有被带进最终目录。

### `npm run build:win`

这个命令才是 Windows 分发构建，会在 `dist/` 里生成 Windows 平台产物。简单说：

```text
npm run build         = 构建代码，输出 out/
npm run build:unpack  = 本地免安装版，输出 dist/win-unpacked/
npm run build:win     = Windows 分发包，输出 dist/
```

---

## 五、本地打包的 winCodeSign 问题

我在跑：

```powershell
npm run build:unpack
```

时，Electron Builder 已经完成了 Vite 构建，但失败在 `winCodeSign` 工具包解压阶段。错误大概是：

```text
ERROR: Cannot create symbolic link
```

它要解压的包里有 macOS 目录和符号链接，比如：

```text
libcrypto.dylib
libssl.dylib
```

当前 Windows 用户没有创建符号链接的权限，所以解压失败。

这个问题和应用代码本身没关系，是 electron-builder 在处理 Windows 签名工具链。我不想为了本地 `win-unpacked` 验证去要求开发者开启额外权限，所以我把本地打包脚本改成 unsigned 构建：

```json
"build:unpack": "npm run build && cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --dir -c.win.signAndEditExecutable=false",
"build:win": "npm run build && cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win -c.win.signAndEditExecutable=false"
```

这里有两个点：

1. `CSC_IDENTITY_AUTO_DISCOVERY=false` 禁用证书身份自动发现。
2. `-c.win.signAndEditExecutable=false` 跳过 Windows exe 签名和资源编辑流程。

我没有把 `signAndEditExecutable: false` 固定写进 `electron-builder.yml`，因为那会影响正式配置里的 exe 元数据和图标处理。放在 npm 脚本里作为本地打包覆盖参数，更符合我现在的用途。

---

## 六、dist 文件占用问题

在签名工具问题解决后，我再次跑 `build:unpack`，又遇到了：

```text
remove E:\IntelliGit\dist\win-unpacked\d3dcompiler_47.dll: Access is denied.
```

这个错误说明 electron-builder 想清空旧的 `dist/win-unpacked`，但里面的文件正在被进程占用。

我查了一下进程，发现确实有旧的打包版程序还在运行：

```text
intelligit.exe
intelligit-sidecar.exe
```

它们都来自：

```text
E:\IntelliGit\dist\win-unpacked
```

所以这个问题的处理方式不是改代码，而是先关掉旧的打包版 IntelliGit，再重新跑：

```powershell
npm run build:unpack
```

这也让我确认了一个本地打包习惯：重新打 `win-unpacked` 前，要先确保旧的 `dist/win-unpacked/intelligit.exe` 和它启动的 sidecar 都已经退出。

---

## 七、这次构建链路调整后的结果

这次调整后，我把 Go Sidecar 从“需要人工记得编译”的隐性步骤，变成了 npm 脚本里明确的一步。现在只要我跑常用开发和构建命令，项目都会先尝试准备 sidecar。

同时我也没有牺牲前端开发者的便利性：没有 Go 环境时，只要 `resources` 里已有二进制，项目仍然可以启动。

最终我对这块链路的理解变成了：

```text
Go 源码
  -> build:sidecar
  -> resources/intelligit-sidecar.exe
  -> Electron dev 启动
  -> electron-builder extraResources
  -> dist/win-unpacked/resources/intelligit-sidecar.exe
```

这个链路清楚以后，后面再遇到“源码明明改了但运行没变化”的问题，我就会优先检查当前 Electron 实际运行的 sidecar 二进制是不是最新的。
