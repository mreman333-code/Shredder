/** Shape of one logged bridge/MCP call, shown in the AI panel. */
export interface AiLogEntry {
  id: string
  session: string
  tool: string
  args: Record<string, unknown>
  status: 'ok' | 'error'
  summary: string
  at: number
  ms: number
}

/** A model session the log can be reverted as a unit. */
export interface AiSessionView {
  id: string
  fileId: string | null
  startedAt: number
  calls: number
  reverted: boolean
}

/**
 * Compact, log-safe summary of a tool result. Exported GLBs carry megabytes of
 * base64 that must never be kept in the activity log.
 */
export function summarizeAiResult(value: unknown): string {
  if (value === undefined) return 'done'
  if (value && typeof value === 'object') {
    const record = { ...(value as Record<string, unknown>) }
    if (typeof record.base64 === 'string') {
      const length = record.base64.length
      delete record.base64
      return `${JSON.stringify(record)} · ${length.toLocaleString()} base64 chars (not kept)`
    }
    const text = JSON.stringify(record)
    return text.length > 400 ? `${text.slice(0, 400)}…` : text
  }
  return String(value)
}

export function formatAiArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args ?? {})
  return text === '{}' ? '(no arguments)' : text
}

export function aiSessionLabel(id: string): string {
  if (id.startsWith('mcp-')) return 'MCP session'
  if (id.startsWith('http-')) return 'HTTP session'
  return id
}
