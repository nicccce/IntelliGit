/**
 * @file SidecarManager — Go Sidecar 进程管理器
 * @description 负责启动 / 重启 / 销毁 Go 侧车进程，并封装基于 stdin/stdout 的
 *              双向 JSON 通信协议。每条请求通过唯一 ID 与响应配对，支持超时。
 */

import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { SidecarRequest, SidecarResponse } from '../../shared/types'

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000

/** 待处理请求的回调 */
interface PendingRequest {
  resolve: (value: SidecarResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SidecarManager {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private buffer = '' // 用于拼接 stdout 分片数据
  private requestCounter = 0

  // ─── 生命周期 ────────────────────────────────────────────────────────

  /** 启动 Sidecar 进程 */
  start(): void {
    if (this.process) {
      console.warn('[SidecarManager] Sidecar 已在运行，跳过重复启动')
      return
    }

    const binaryPath = this.resolveBinaryPath()
    console.log(`[SidecarManager] 启动 Sidecar: ${binaryPath}`)

    this.process = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // ── stdout：按行解析 JSON 响应 ─────────────────────────────────────
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
    })
  }

  /** 优雅关闭 Sidecar 进程 */
  stop(): void {
    if (!this.process) return
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
        const response: SidecarResponse = JSON.parse(trimmed)
        this.handleResponse(response)
      } catch {
        console.warn('[SidecarManager] 无法解析 stdout 行:', trimmed)
      }
    }
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
}
