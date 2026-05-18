// ─── 结构化输出解析 ───────────────────────────────────────────────────────────

/**
 * 从 LLM 输出文本中提取 JSON 对象。
 * 依次尝试：
 * 1. markdown 代码块 ```json ... ```
 * 2. 第一个 { ... } 块
 * 3. 整体 JSON.parse
 */
export function extractJson(text: string): unknown {
  // 1. markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // fall through
    }
  }

  // 2. first brace pair
  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0])
    } catch {
      // fall through
    }
  }

  // 3. whole text
  try {
    return JSON.parse(text.trim())
  } catch {
    return null
  }
}

// ─── 简单 Schema 校验 ─────────────────────────────────────────────────────────

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
}

export function validateSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const obj = value as Record<string, unknown>
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) return false
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in obj && !validateSchema(obj[key], subSchema)) return false
      }
    }
    return true
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false
    if (schema.items) {
      return value.every((item) => validateSchema(item, schema.items!))
    }
    return true
  }

  if (schema.enum) {
    return schema.enum.includes(value)
  }

  if (schema.type === 'string') return typeof value === 'string'
  if (schema.type === 'number') return typeof value === 'number'
  if (schema.type === 'boolean') return typeof value === 'boolean'

  return false
}

/**
 * 从 LLM 原始输出中解析并校验结构化数据。
 * @returns 解析成功的对象，或 null（解析/校验失败）
 */
export function parseStructured<T>(rawOutput: string, schema: JsonSchema): T | null {
  const parsed = extractJson(rawOutput)
  if (parsed === null) return null
  if (!validateSchema(parsed, schema)) return null
  return parsed as T
}

// ─── 常用 Schema 定义 ─────────────────────────────────────────────────────────

export const COMMIT_MESSAGE_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['type', 'subject'],
  properties: {
    type: {
      type: 'string',
      enum: ['feat', 'fix', 'refactor', 'style', 'docs', 'test', 'chore', 'perf']
    },
    scope: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    breaking: { type: 'boolean' }
  }
}

export const COMMIT_GROUPS_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'summary', 'files'],
        properties: {
          type: { type: 'string' },
          scope: { type: 'string' },
          summary: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
}

export const CONFLICT_RISK_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['risks', 'summary'],
  properties: {
    risks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'type', 'description'],
        properties: {
          level: { type: 'string', enum: ['low', 'medium', 'high'] },
          type: { type: 'string' },
          description: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          symbols: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    summary: { type: 'string' }
  }
}

export const CONFLICT_RESOLVE_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['strategy', 'explanation'],
  properties: {
    strategy: {
      type: 'string',
      enum: ['take_ours', 'take_theirs', 'merge_both', 'manual']
    },
    explanation: { type: 'string' },
    resolvedContent: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } }
  }
}

export const NL_INTENT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['intent', 'operations', 'summary'],
  properties: {
    intent: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'description', 'riskLevel'],
        properties: {
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          riskLevel: { type: 'string', enum: ['safe', 'high', 'extreme'] },
          riskReason: { type: 'string' }
        }
      }
    },
    requiresWorkflow: { type: 'string' },
    summary: { type: 'string' }
  }
}
