/**
 * @file Sidecar 通信协议的共享类型定义
 * @description 定义主进程 <-> Sidecar <-> 渲染进程之间的通信数据结构。
 *              所有层（main / preload / renderer）共用此类型，确保端到端类型安全。
 */

// ─── Sidecar 请求 / 响应 ──────────────────────────────────────────────────────

/** 发往 Sidecar 的请求体 */
export interface SidecarRequest {
  /** JSON-RPC 协议版本 */
  jsonrpc: '2.0'
  /** 唯一请求 ID，用于匹配异步响应 */
  id: string
  /** 方法名，如 "git/status" */
  method: string
  /** 方法参数 */
  params?: Record<string, unknown>
}

/** JSON-RPC 错误对象 */
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

/** Sidecar 返回的响应体 */
export interface SidecarResponse {
  /** JSON-RPC 协议版本 */
  jsonrpc: '2.0'
  /** 对应请求的 ID */
  id: string
  /** 成功结果 */
  result?: unknown
  /** 失败错误 */
  error?: JsonRpcError
}

// ─── IPC 通道常量 ─────────────────────────────────────────────────────────────

/** IPC 通道名称集中管理 */
export const IPC_CHANNELS = {
  /** 渲染进程 -> 主进程：执行 Git 命令 */
  GIT_COMMAND: 'git:command'
} as const

// ─── Renderer 侧暴露的 API 类型 ──────────────────────────────────────────────

/** 由 preload 脚本暴露到 window 上的 API 接口 */
export interface ElectronAPI {
  /** 调用 Git 命令并等待结果 */
  invokeGit: (command: string, payload?: Record<string, unknown>) => Promise<SidecarResponse>
  /** 当前运行模式 */
  mode: string
}
