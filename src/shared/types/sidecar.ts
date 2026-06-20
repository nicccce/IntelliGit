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
export interface SidecarResponse<TData = unknown> {
  /** 对应请求的 ID */
  id: string
  /** 是否成功 */
  success: boolean
  /** 成功时的数据 */
  data?: TData
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

export interface SidecarPingResult {
  ok: boolean
  protocolVersion: number
}

// ─── LLM 配置（持久化存储） ───────────────────────────────────────────────────

/** LLM 服务商类型 */
export type LlmProvider = 'openai' | 'anthropic'

/** LLM Provider 配置 */
export interface LlmConfig {
  /** 服务商类型：openai 兼容（含 DeepSeek / 通义等）或 Anthropic */
  provider: LlmProvider
  /** API Key */
  apiKey: string
  /** 自定义 Base URL（OpenAI 兼容模式下可覆盖默认地址） */
  baseUrl?: string
  /** 模型名称，如 gpt-4o / claude-3-5-sonnet / deepseek-chat */
  modelName: string
  /** 采样温度 0-2，默认 0.2 */
  temperature?: number
  /** 最大输出 Token 数 */
  maxTokens?: number
}

export interface LlmProxyRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface LlmProxyResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

// ─── Agent IPC 请求 / 响应 ────────────────────────────────────────────────────

/** 多轮对话中的历史消息（不含当前轮） */
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentRunRequest {
  config: LlmConfig
  systemPrompt: string
  userMessage: string
  /** 历史对话消息（多轮时传入，不含当前轮的 userMessage） */
  messages?: ConversationMessage[]
  /** 要启用的 Tool 名称列表（空或不传 = 不使用 Tool） */
  tools?: string[]
  /** 最大工具调用轮次，默认 5 */
  maxIterations?: number
}

export interface AgentRunResponse {
  success: boolean
  rawOutput?: string
  error?: string
}

export interface AgentPingResponse {
  ok: boolean
  error?: string
}

// ─── 仓库配置（持久化存储） ───────────────────────────────────────────────────

/** 单个仓库的配置信息 */
export interface RepoConfig {
  /** 仓库唯一标识（使用路径） */
  path: string
  /** 仓库显示名称 */
  name: string
  /** 远程仓库形式：无 / HTTP(S) / SSH */
  remoteType?: 'none' | 'http' | 'ssh'
  /** HTTP(S) 远程仓库地址 */
  httpRemoteUrl?: string
  /** SSH 远程仓库地址 */
  sshRemoteUrl?: string
  /** Commit 作者名称，用于写入提交历史 */
  commitAuthorName?: string
  /** Commit 作者邮箱，用于 GitHub 贡献归属 */
  commitAuthorEmail?: string
  /** HTTP(S) 认证用户名 */
  authUsername?: string
  /** HTTP(S) 认证密码 / Token */
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
  /** LLM Provider 配置（可选，未配置时 AI 功能不可用） */
  llmConfig?: LlmConfig
}

// ─── NLP Git 助手类型 ─────────────────────────────────────────────────────────

export interface GitExecRequest {
  repoPath: string
  args: string[]
}

export interface GitExecResponse {
  success: boolean
  stdout?: string
  stderr?: string
  error?: string
}

export interface NlOperation {
  command: string
  args?: string[]
  description: string
  riskLevel: 'safe' | 'high' | 'extreme'
  riskReason?: string
}

export interface NlCommandPlan {
  intent: string
  operations: NlOperation[]
  requiresWorkflow: 'commit' | 'conflict' | null
  summary: string
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
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  /** 检查目录是否存在 */
  CHECK_DIR_EXISTS: 'check:dirExists',
  /** 检查目录是否为空 */
  CHECK_DIR_EMPTY: 'check:dirEmpty',
  /** 渲染进程 -> 主进程：代理 LLM HTTP 请求（已弃用，保留兼容） */
  LLM_PROXY: 'llm:proxy',
  /** 渲染进程 -> 主进程：在 Main 进程执行 Agent 任务 */
  AGENT_RUN_TASK: 'agent:runTask',
  /** 渲染进程 -> 主进程：检测 LLM 连通性 */
  AGENT_PING_LLM: 'agent:pingLlm',
  /** 渲染进程 -> 主进程：在仓库目录执行 git CLI 命令 */
  GIT_EXEC: 'git:exec'
} as const

// ─── Renderer 侧暴露的 API 类型 ──────────────────────────────────────────────

/** Electron 渲染入口运行模式 */
export type ElectronMode = 'main' | 'test'

/** 由 preload 脚本暴露到 window 上的 API 接口 */
export interface ElectronAPI {
  /** 调用 Git 命令并等待结果 */
  invokeGit: (command: string, payload?: Record<string, unknown>) => Promise<SidecarResponse>
  /** 监听 Sidecar 通知事件 */
  onSidecarNotification: (callback: (notification: SidecarNotification) => void) => () => void
  /** 读取持久化配置 */
  loadConfig: () => Promise<AppConfig>
  /** 保存持久化配置 */
  saveConfig: (config: AppConfig) => Promise<void>
  /** 打开文件夹选择对话框，返回选中路径或 null */
  openFolderDialog: () => Promise<string | null>
  /** 检查目录是否存在 */
  checkDirExists: (path: string) => Promise<boolean>
  /** 检查目录是否为空 */
  checkDirEmpty: (path: string) => Promise<boolean>
  /** 代理 LLM HTTP 请求（已弃用） */
  proxyLlmRequest: (request: LlmProxyRequest) => Promise<LlmProxyResponse>
  /** 在 Main 进程执行 Agent 任务（使用 Vercel AI SDK） */
  runAgentTask: (request: AgentRunRequest) => Promise<AgentRunResponse>
  /** 检测 LLM 连通性 */
  pingLlmConfig: (config: LlmConfig) => Promise<AgentPingResponse>
  /** 在仓库目录执行 git CLI 命令（供 NLP 助手使用） */
  executeGitCommand: (request: GitExecRequest) => Promise<GitExecResponse>
  /** 当前运行模式（test 或 main） */
  mode: ElectronMode
}
