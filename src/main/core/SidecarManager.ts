/**
 * @file SidecarManager — Go Sidecar 进程管理器
 * @description 负责启动 / 重启 / 销毁 Go 侧车进程，并封装基于 stdin/stdout 的
 *              双向 JSON 通信协议。每条请求通过唯一 ID 与响应配对，支持超时。
 *              支持 Notification 事件通知（如进度推送），并提供 ES6 Proxy 无感调用。
 */

import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { EventEmitter } from 'events'
import type { SidecarRequest, SidecarResponse, SidecarNotification } from '../../shared/types'

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 自动重启配置 */
const RESTART_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000 // 指数退避基础延迟
}

/** 待处理请求的回调 */
interface PendingRequest {
  resolve: (value: SidecarResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private buffer = '' // 用于拼接 stdout 分片数据
  private requestCounter = 0
  private restartCount = 0
  private intentionalStop = false // 标记是否为主动关闭

  // ─── 生命周期 ────────────────────────────────────────────────────────

  /** 启动 Sidecar 进程 */
  start(): void {
    if (this.process) {
      console.warn('[SidecarManager] Sidecar 已在运行，跳过重复启动')
      return
    }

    this.intentionalStop = false
    const binaryPath = this.resolveBinaryPath()
    console.log(`[SidecarManager] 启动 Sidecar: ${binaryPath}`)

    this.process = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // ── stdout：按行解析 JSON 响应 / 通知 ───────────────────────────────
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8')
      this.processBuffer()
    })

    // ── stderr：日志输出 ───────────────────────────────────────────────
    this.process.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[Sidecar stderr] ${chunk.toString('utf-8').trim()}`)
    })

    // ── 异常退出处理 ──────────────────────────────────────────────────
    this.process.on('error', (err) => {
      console.error('[SidecarManager] 进程启动失败:', err.message)
      this.rejectAllPending(new Error(`Sidecar 进程启动失败: ${err.message}`))
      this.process = null
    })

    this.process.on('exit', (code, signal) => {
      console.warn(`[SidecarManager] 进程退出 code=${code} signal=${signal}`)
      this.rejectAllPending(new Error(`Sidecar 进程异常退出 (code=${code})`))
      this.process = null

      // 非主动关闭时尝试自动重启
      if (!this.intentionalStop) {
        this.tryAutoRestart()
      }
    })

    // 成功启动后重置重启计数
    this.restartCount = 0
  }

  /** 优雅关闭 Sidecar 进程 */
  stop(): void {
    if (!this.process) return
    this.intentionalStop = true
    console.log('[SidecarManager] 正在关闭 Sidecar...')
    this.process.kill('SIGTERM')
    this.rejectAllPending(new Error('Sidecar 已关闭'))
    this.process = null
  }

  /** Sidecar 是否正在运行 */
  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null
  }

  // ─── 通信 ────────────────────────────────────────────────────────────

  /** 向 Sidecar 发送请求并等待响应 */
  send(command: string, payload?: Record<string, unknown>): Promise<SidecarResponse> {
    return new Promise<SidecarResponse>((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        return reject(new Error('Sidecar 进程未就绪'))
      }

      const id = this.generateId()
      const request: SidecarRequest = { id, command, payload }

      // 超时处理
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`请求超时 (id=${id}, command=${command})`))
      }, DEFAULT_TIMEOUT_MS)

      this.pendingRequests.set(id, { resolve, reject, timer })

      // 写入 stdin，每条 JSON 以换行符分隔
      const line = JSON.stringify(request) + '\n'
      this.process.stdin.write(line, 'utf-8', (err) => {
        if (err) {
          clearTimeout(timer)
          this.pendingRequests.delete(id)
          reject(new Error(`写入 stdin 失败: ${err.message}`))
        }
      })
    })
  }

  /**
   * 创建 ES6 Proxy，实现"无感"调用。
   *
   * @example
   * ```ts
   * const git = sidecarManager.createProxy()
   *
   * // 像调用本地异步函数一样使用
   * const status = await git['staging.status']({ path: '/repo' })
   * const log = await git['commit.log']({ max: 20 })
   * ```
   *
   * 也可以使用点号风格的别名:
   * ```ts
   * const result = await git.invoke('staging.status', { path: '/repo' })
   * ```
   */
  createProxy(): Record<string, (payload?: Record<string, unknown>) => Promise<unknown>> {
    return new Proxy({} as Record<string, (payload?: Record<string, unknown>) => Promise<unknown>>, {
      get: (_target, method: string) => {
        if (method === 'invoke') {
          return (command: string, payload?: Record<string, unknown>) => {
            return this.send(command, payload).then((res) => {
              if (!res.success) throw new Error(res.error ?? '未知错误')
              return res.data
            })
          }
        }
        return (payload?: Record<string, unknown>) => {
          return this.send(method, payload).then((res) => {
            if (!res.success) throw new Error(res.error ?? '未知错误')
            return res.data
          })
        }
      }
    })
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────

  /** 解析 Sidecar 二进制文件路径 */
  private resolveBinaryPath(): string {
    const binaryName = process.platform === 'win32' ? 'intelligit-sidecar.exe' : 'intelligit-sidecar'

    if (is.dev) {
      // 开发环境：项目根目录下的 resources/
      return join(app.getAppPath(), 'resources', binaryName)
    }
    // 生产环境：extraResources 会将文件放到 process.resourcesPath
    return join(process.resourcesPath, binaryName)
  }

  /** 处理 stdout 缓冲区，按 \n 拆分并解析每行 JSON */
  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    // 最后一个元素可能是不完整的行，保留到下一次
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const msg = JSON.parse(trimmed)
        if (this.isNotification(msg)) {
          this.handleNotification(msg as SidecarNotification)
        } else {
          this.handleResponse(msg as SidecarResponse)
        }
      } catch {
        console.warn('[SidecarManager] 无法解析 stdout 行:', trimmed)
      }
    }
  }

  /** 判断消息是否为 Notification */
  private isNotification(msg: Record<string, unknown>): boolean {
    return msg.type === 'notification'
  }

  /** 处理 Notification 消息：通过 EventEmitter 分发 */
  private handleNotification(notification: SidecarNotification): void {
    // 发出通用事件
    this.emit('notification', notification)
    // 发出具体事件（如 'progress'）
    this.emit(notification.event, notification.data)
  }

  /** 根据 ID 匹配挂起的请求 */
  private handleResponse(response: SidecarResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      console.warn(`[SidecarManager] 收到未知 ID 的响应: ${response.id}`)
      return
    }

    clearTimeout(pending.timer)
    this.pendingRequests.delete(response.id)
    pending.resolve(response)
  }

  /** 拒绝所有挂起的请求（用于进程退出时） */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pendingRequests.delete(id)
    }
  }

  /** 生成自增唯一请求 ID */
  private generateId(): string {
    return `req_${Date.now()}_${++this.requestCounter}`
  }

  /** 尝试自动重启（指数退避） */
  private tryAutoRestart(): void {
    if (this.restartCount >= RESTART_CONFIG.maxRetries) {
      console.error(
        `[SidecarManager] 已达最大重启次数 (${RESTART_CONFIG.maxRetries})，停止重启`
      )
      this.emit('crash', { restartCount: this.restartCount })
      return
    }

    const delay = RESTART_CONFIG.baseDelayMs * Math.pow(2, this.restartCount)
    this.restartCount++
    console.warn(
      `[SidecarManager] ${delay}ms 后尝试第 ${this.restartCount} 次重启...`
    )

    setTimeout(() => {
      if (!this.intentionalStop && !this.process) {
        this.start()
      }
    }, delay)
  }
}
