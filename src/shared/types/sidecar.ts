/**
 * @file Sidecar 通信协议的共享类型定义
 * @description 定义主进程 <-> Sidecar <-> 渲染进程之间的通信数据结构。
 *              所有层（main / preload / renderer）共用此类型，确保端到端类型安全。
 */

// ─── Sidecar 请求 / 响应 ──────────────────────────────────────────────────────

/** 发往 Sidecar 的请求体 */
export interface SidecarRequest {
  /** 唯一请求 ID，用于匹配异步响应 */
  id: string
  /** Git 命令名称，如 "status" / "log" / "commit" */
  command: string
  /** 命令携带的载荷 */
  payload?: Record<string, unknown>
}

/** Sidecar 返回的响应体 */
export interface SidecarResponse {
  /** 对应请求的 ID */
  id: string
  /** 是否成功 */
  success: boolean
  /** 成功时的数据 */
  data?: unknown
  /** 失败时的错误信息 */
  error?: string
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
}
