# Resources

此目录用于存放编译后的 Go Sidecar 二进制文件。

## 使用说明

1. 在 `sidecar/` 目录下编译 Go 程序：

```bash
# Windows
cd sidecar && go build -o ../resources/intelligit-sidecar.exe ./cmd/sidecar

# macOS / Linux
cd sidecar && go build -o ../resources/intelligit-sidecar ./cmd/sidecar
```

2. 编译完成后，二进制文件会出现在此目录
3. `electron-builder` 已配置 `extraResources`，打包时会自动将此处的二进制文件复制到应用程序目录

## 注意事项

- `icon.png` 是 Electron 应用的图标资源，由 electron-vite 自动使用
- Go 二进制文件（`intelligit-sidecar` / `intelligit-sidecar.exe`）不应提交到 Git 仓库
