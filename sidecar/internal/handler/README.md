# internal/handler

此包负责把协议 command 映射到 Git facade 调用。handler 层只处理协议边界，不实现底层 Git 策略。

## 文件职责

```text
commands.go        # command 常量
contract_*.go      # payload/result DTO
*_handlers.go      # 按业务域拆分的 handler
registry.go        # RegisterAll 总入口
router.go          # command 分发
context.go         # payload bind、当前 repo 注入
notifier.go        # progress/event 通知
validation.go      # 通用校验
```

## 新增命令流程

1. 在 `commands.go` 增加常量。
2. 在对应 `contract_*.go` 定义 payload/result，避免匿名 struct 和临时 map 返回。
3. 在对应业务域 handler 文件实现函数。
4. 在 `register*Handlers` 注册。
5. 更新 `registry_test.go`，确保命令被注册。
6. 同步更新前端 Git command map。
