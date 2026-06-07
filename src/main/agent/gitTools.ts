import { tool, jsonSchema } from 'ai'
import type { Tool } from 'ai'
import type { SidecarManager } from '../core/SidecarManager'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>

// ─── Git Tools for Vercel AI SDK (v6) ────────────────────────────────────────
// 使用 jsonSchema() 代替 zod，避免 zod v4 与 ai v6 内部类型不兼容的问题。

function buildGitTools(sidecarManager: SidecarManager) {
  return {
    'git.getStatus': tool({
      description: '获取当前仓库工作区与暂存区的文件状态列表',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => sidecarManager.send('staging.status')
    }),

    'git.getDiff': tool({
      description: '获取工作区（未暂存）的 unified diff，可选指定文件路径',
      inputSchema: jsonSchema<{ filePath?: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '指定文件路径（可选）' } }
      }),
      execute: async ({ filePath }) =>
        sidecarManager.send('diff.workdir', filePath ? { path: filePath } : undefined)
    }),

    'git.getStagedDiff': tool({
      description: '获取暂存区的 unified diff，可选指定文件路径',
      inputSchema: jsonSchema<{ filePath?: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '指定文件路径（可选）' } }
      }),
      execute: async ({ filePath }) =>
        sidecarManager.send('diff.staged', filePath ? { path: filePath } : undefined)
    }),

    'git.getRawDiff': tool({
      description: '获取工作区（未暂存）的原始 unified diff 文本，可选指定文件路径',
      inputSchema: jsonSchema<{ filePath?: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '指定文件路径（可选）' } }
      }),
      execute: async ({ filePath }) =>
        sidecarManager.send('diff.workdirRaw', filePath ? { path: filePath } : undefined)
    }),

    'git.getRawStagedDiff': tool({
      description: '获取暂存区的原始 unified diff 文本，可选指定文件路径',
      inputSchema: jsonSchema<{ filePath?: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '指定文件路径（可选）' } }
      }),
      execute: async ({ filePath }) =>
        sidecarManager.send('diff.stagedRaw', filePath ? { path: filePath } : undefined)
    }),

    'git.stageFile': tool({
      description: '将指定文件加入暂存区',
      inputSchema: jsonSchema<{ filePath: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '要暂存的文件路径' } },
        required: ['filePath']
      }),
      execute: async ({ filePath }) => sidecarManager.send('staging.add', { path: filePath })
    }),

    'git.unstageFile': tool({
      description: '将指定文件从暂存区移出',
      inputSchema: jsonSchema<{ filePath: string }>({
        type: 'object',
        properties: { filePath: { type: 'string', description: '要取消暂存的文件路径' } },
        required: ['filePath']
      }),
      execute: async ({ filePath }) => sidecarManager.send('staging.remove', { path: filePath })
    }),

    'git.stageAll': tool({
      description: '将所有变更文件加入暂存区',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => sidecarManager.send('staging.addAll')
    }),

    'git.createCommit': tool({
      description: '使用指定提交信息创建 Commit',
      inputSchema: jsonSchema<{ message: string }>({
        type: 'object',
        properties: { message: { type: 'string', description: '提交信息（Conventional Commits 格式）' } },
        required: ['message']
      }),
      execute: async ({ message }) => sidecarManager.send('commit.create', { message })
    }),

    'git.getCommitLog': tool({
      description: '获取当前分支提交历史',
      inputSchema: jsonSchema<{ max?: number; from?: string }>({
        type: 'object',
        properties: {
          max: { type: 'number', description: '最大返回数量' },
          from: { type: 'string', description: '起始引用或提交哈希（可选）' }
        }
      }),
      execute: async ({ max, from }) => {
        const payload: Record<string, unknown> = {}
        if (max !== undefined) payload.max = max
        if (from !== undefined) payload.from = from
        return sidecarManager.send('commit.log', Object.keys(payload).length ? payload : undefined)
      }
    }),

    'git.getCommitDetail': tool({
      description: '获取指定提交的详情',
      inputSchema: jsonSchema<{ hash: string }>({
        type: 'object',
        properties: { hash: { type: 'string', description: '提交哈希' } },
        required: ['hash']
      }),
      execute: async ({ hash }) => sidecarManager.send('commit.get', { hash })
    }),

    'git.getBranchInfo': tool({
      description: '获取当前分支、本地分支列表及 ahead/behind 信息',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => {
        const current = await sidecarManager.send('branch.current')
        const branches = await sidecarManager.send('branch.list')
        const remotes = await sidecarManager.send('branch.listRemote')
        const currentData = current.data as { branch?: string } | undefined
        const aheadBehind = currentData?.branch
          ? await sidecarManager.send('branch.aheadBehind', { branch: currentData.branch })
          : undefined
        return { current, branches, remotes, aheadBehind }
      }
    }),

    'git.getMergeStatus': tool({
      description: '判断当前仓库是否处于 merge 状态，并返回 MERGE_HEAD 与冲突文件',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => sidecarManager.send('merge.status')
    }),

    'git.getConflictFiles': tool({
      description: '获取当前处于冲突状态的文件列表',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => {
        const status = await sidecarManager.send('merge.status')
        const data = status.data as { conflictedFiles?: string[] } | undefined
        return data?.conflictedFiles ?? []
      }
    }),

    'git.applyPatch': tool({
      description: '将 unified diff patch 应用到工作区',
      inputSchema: jsonSchema<{ patch: string }>({
        type: 'object',
        properties: { patch: { type: 'string', description: 'unified diff 格式的 patch 内容' } },
        required: ['patch']
      }),
      execute: async ({ patch }) => sidecarManager.send('staging.applyPatch', { patch })
    }),

    'git.unstageHunk': tool({
      description: '通过反向 patch 从暂存区取消指定 hunk',
      inputSchema: jsonSchema<{ patch: string }>({
        type: 'object',
        properties: { patch: { type: 'string', description: '用于取消暂存的 patch 内容' } },
        required: ['patch']
      }),
      execute: async ({ patch }) => sidecarManager.send('staging.unstageHunk', { patch })
    }),

    'git.continueMerge': tool({
      description: '所有冲突解决后继续 merge 操作，可选提供合并提交信息',
      inputSchema: jsonSchema<{ message?: string }>({
        type: 'object',
        properties: { message: { type: 'string', description: '合并提交信息（可选）' } }
      }),
      execute: async ({ message }) =>
        sidecarManager.send('merge.continue', message ? { message } : undefined)
    }),

    'git.abortMerge': tool({
      description: '取消当前 merge 操作，恢复到 merge 前状态',
      inputSchema: jsonSchema<Record<string, never>>({}),
      execute: async () => sidecarManager.send('merge.abort')
    })
  }
}

/**
 * 根据 tool 名称列表返回 Vercel AI SDK 格式的 tools 对象。
 * 名称不存在则跳过。
 */
export function getGitToolsForTask(
  sidecarManager: SidecarManager,
  names: string[]
): Record<string, AnyTool> {
  const all = buildGitTools(sidecarManager) as Record<string, AnyTool>
  const result: Record<string, AnyTool> = {}
  for (const name of names) {
    if (name in all) {
      result[name] = all[name]
    }
  }
  return result
}
