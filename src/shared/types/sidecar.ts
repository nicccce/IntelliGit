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
  /** Git 命令名称，如 "staging.status" / "commit.log" */
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

// ─── 通知消息（Go → Node 推送） ──────────────────────────────────────────────

/** Sidecar 主动推送的通知消息 */
export interface SidecarNotification {
  /** 固定为 "notification"，用于区分 Response */
  type: 'notification'
  /** 事件名称，如 "progress" */
  event: string
  /** 事件数据 */
  data?: unknown
}

/** 进度推送的数据载荷 */
export interface ProgressData {
  /** 关联的请求 ID，前端可据此将进度与特定操作关联 */
  requestId: string
  /** 进度文本（如 go-git 输出的 "Counting objects: 50%"） */
  message: string
}

// ─── 仓库配置（持久化存储） ───────────────────────────────────────────────────

/** 单个仓库的配置信息 */
export interface RepoConfig {
  /** 仓库唯一标识（使用路径） */
  path: string
  /** 仓库显示名称 */
  name: string
  /** 认证用户名 */
  authUsername?: string
  /** 认证密码 / Token */
  authPassword?: string
  /** SSH 密钥路径 */
  sshKeyPath?: string
  /** SSH 密钥密码 */
  sshPassword?: string
}

/** 全局应用配置 */
export interface AppConfig {
  /** 已添加的仓库列表 */
  repos: RepoConfig[]
  /** 当前活跃仓库路径 */
  currentRepoPath: string | null
}

// ─── IPC 通道常量 ─────────────────────────────────────────────────────────────

/** IPC 通道名称集中管理 */
export const IPC_CHANNELS = {
  /** 渲染进程 -> 主进程：执行 Git 命令 */
  GIT_COMMAND: 'git:command',
  /** 主进程 -> 渲染进程：Sidecar 通知转发 */
  SIDECAR_NOTIFICATION: 'sidecar:notification',
  /** 读取应用配置 */
  CONFIG_LOAD: 'config:load',
  /** 保存应用配置 */
  CONFIG_SAVE: 'config:save',
  /** 打开文件夹选择对话框 */
  DIALOG_OPEN_FOLDER: 'dialog:openFolder'
} as const

// ─── Renderer 侧暴露的 API 类型 ──────────────────────────────────────────────

/** 由 preload 脚本暴露到 window 上的 API 接口 */
export interface ElectronAPI {
  /** 调用 Git 命令并等待结果 */
  invokeGit: (command: string, payload?: Record<string, unknown>) => Promise<SidecarResponse>
  /** 监听 Sidecar 通知事件 */
  onSidecarNotification: (
    callback: (notification: SidecarNotification) => void
  ) => () => void
  /** 读取持久化配置 */
  loadConfig: () => Promise<AppConfig>
  /** 保存持久化配置 */
  saveConfig: (config: AppConfig) => Promise<void>
  /** 打开文件夹选择对话框，返回选中路径或 null */
  openFolderDialog: () => Promise<string | null>
  /** 当前运行模式（test 或 main） */
  mode?: string
}
