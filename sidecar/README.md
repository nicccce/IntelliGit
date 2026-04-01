# Sidecar — Go 后端

## 概述

此目录存放 Go 语言编写的 Sidecar 进程源码。Sidecar 负责所有底层 Git 操作，
通过 `libgit2` 和 `Git CLI` 混合驱动，与 Electron 主进程通过 **stdin/stdout JSON** 协议通信。

## 通信协议

### 请求格式（stdin，每行一个 JSON）

```json
{
  "id": "req_1712000000000_1",
  "command": "status",
  "payload": { "repoPath": "/path/to/repo" }
}
```

### 响应格式（stdout，每行一个 JSON）

```json
{
  "id": "req_1712000000000_1",
  "success": true,
  "data": { "files": [...] }
}
```

## 构建

```bash
cd sidecar
go build -o ../resources/intelligit-sidecar ./cmd/sidecar
```

## 目录结构（建议）

```
sidecar/
├── cmd/
│   └── sidecar/
│       └── main.go       # 入口，启动 stdin/stdout 循环
├── internal/
│   ├── protocol/         # JSON 协议解析
│   ├── git/              # Git 操作封装 (libgit2 + CLI)
│   └── handler/          # 命令路由与处理
├── go.mod
└── go.sum
```
