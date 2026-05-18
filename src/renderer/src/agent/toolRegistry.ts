import type { RegisteredTool, ToolDefinition } from './types'

// ─── Tool Registry ────────────────────────────────────────────────────────────

class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools = new Map<string, RegisteredTool<any, any>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register<TInput, TOutput>(tool: RegisteredTool<TInput, TOutput>): void {
    this.tools.set(tool.definition.name, tool)
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition)
  }

  listByNames(names: string[]): ToolDefinition[] {
    return names.flatMap((name) => {
      const tool = this.tools.get(name)
      return tool ? [tool.definition] : []
    })
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool "${name}" 未注册`)
    return tool.execute(args)
  }
}

export const toolRegistry = new ToolRegistry()

// ─── 预置 Git Tool 定义（由 P1 工作流绑定真实 execute） ──────────────────────
// 此处提前声明 definition，P1 工作流注册时注入 execute 实现。

export const GIT_TOOL_NAMES = {
  GET_STATUS: 'git.getStatus',
  GET_DIFF: 'git.getDiff',
  GET_STAGED_DIFF: 'git.getStagedDiff',
  STAGE_FILE: 'git.stageFile',
  UNSTAGE_FILE: 'git.unstageFile',
  STAGE_ALL: 'git.stageAll',
  CREATE_COMMIT: 'git.createCommit',
  GET_BRANCH_INFO: 'git.getBranchInfo',
  GET_CONFLICT_FILES: 'git.getConflictFiles',
  GET_TRIPLET_CONTENT: 'git.getTripletContent',
  APPLY_PATCH: 'git.applyPatch',
  CONTINUE_MERGE: 'git.continueMerge',
  ABORT_MERGE: 'git.abortMerge'
} as const

export type GitToolName = (typeof GIT_TOOL_NAMES)[keyof typeof GIT_TOOL_NAMES]

export const GIT_TOOL_DEFINITIONS: Record<GitToolName, ToolDefinition> = {
  'git.getStatus': {
    name: 'git.getStatus',
    description: '获取当前仓库工作区与暂存区的文件状态列表',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  'git.getDiff': {
    name: 'git.getDiff',
    description: '获取工作区（未暂存）的 unified diff，可选指定文件路径',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '指定文件路径（可选，留空获取全量 diff）' }
      }
    }
  },
  'git.getStagedDiff': {
    name: 'git.getStagedDiff',
    description: '获取暂存区的 unified diff，可选指定文件路径',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '指定文件路径（可选）' }
      }
    }
  },
  'git.stageFile': {
    name: 'git.stageFile',
    description: '将指定文件加入暂存区',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '要暂存的文件路径' }
      },
      required: ['filePath']
    }
  },
  'git.unstageFile': {
    name: 'git.unstageFile',
    description: '将指定文件从暂存区移出',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '要取消暂存的文件路径' }
      },
      required: ['filePath']
    }
  },
  'git.stageAll': {
    name: 'git.stageAll',
    description: '将所有变更文件加入暂存区',
    parameters: { type: 'object', properties: {} }
  },
  'git.createCommit': {
    name: 'git.createCommit',
    description: '使用指定提交信息创建 Commit',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '提交信息（Conventional Commits 格式）' }
      },
      required: ['message']
    }
  },
  'git.getBranchInfo': {
    name: 'git.getBranchInfo',
    description: '获取当前分支、本地分支列表及 ahead/behind 信息',
    parameters: { type: 'object', properties: {} }
  },
  'git.getConflictFiles': {
    name: 'git.getConflictFiles',
    description: '获取当前处于冲突状态的文件列表',
    parameters: { type: 'object', properties: {} }
  },
  'git.getTripletContent': {
    name: 'git.getTripletContent',
    description: '获取指定冲突文件的 ancestor / ours / theirs 三方内容',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '冲突文件路径' }
      },
      required: ['filePath']
    }
  },
  'git.applyPatch': {
    name: 'git.applyPatch',
    description: '将 unified diff patch 应用到工作区',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'unified diff 格式的 patch 内容' }
      },
      required: ['patch']
    }
  },
  'git.continueMerge': {
    name: 'git.continueMerge',
    description: '所有冲突解决后继续 merge 操作',
    parameters: { type: 'object', properties: {} }
  },
  'git.abortMerge': {
    name: 'git.abortMerge',
    description: '取消当前 merge 操作，恢复到 merge 前状态',
    parameters: { type: 'object', properties: {} }
  }
}
