# AI Commit 模块

> **负责人**：待分配

## 职责

基于 AI 语义分析自动生成高质量的 Git Commit Message。

## 预期功能

- 分析 `git diff` 的变更内容
- 调用 LLM 生成符合 Conventional Commits 规范的描述
- 支持用户编辑与确认

## 接口约定

本模块将通过 `SidecarManager` 与 Go 后端通信获取 diff 数据，
并在主进程内调用 AI 服务生成 commit message。
