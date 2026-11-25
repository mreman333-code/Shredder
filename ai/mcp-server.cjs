#!/usr/bin/env node
/**
 * Shredder MCP server (stdio). Works with any MCP client:
 * Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, ChatGPT connectors, etc.
 *
 * It forwards tool calls to the running Shredder desktop app over loopback HTTP.
 * Start Shredder first; this process only speaks MCP on stdin/stdout.
 */
const readline = require('node:readline')
const { TOOLS } = require('./tools.cjs')

const BASE_URL = (process.env.SHREDDER_URL || 'http://127.0.0.1:3927').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.SHREDDER_TIMEOUT_MS || 30000)
/** Groups this client's calls so the app can revert one model session as a unit. */
const SESSION_ID =
  process.env.SHREDDER_SESSION || `mcp-${process.pid.toString(36)}-${Date.now().toString(36)}`

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function note(...parts) {
  process.stderr.write(`[shredder-mcp] ${parts.join(' ')}\n`)
}

async function callBridge(name, args) {
  const response = await fetch(`${BASE_URL}/ai/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shredder-session': SESSION_ID,
    },
    body: JSON.stringify({ tool: name, arguments: args ?? {} }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Shredder returned HTTP ${response.status}`)
  }
  return payload.result
}

function toolText(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

async function handle(message) {
  const { id, method, params } = message

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'shredder', version: '1.0.0' },
        },
      }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      }
    case 'tools/call': {
      const name = params?.name
      if (!TOOLS.some((tool) => tool.name === name)) {
        return { jsonrpc: '2.0', id, result: toolText(`Unknown tool "${name}"`, true) }
      }
      try {
        return { jsonrpc: '2.0', id, result: toolText(await callBridge(name, params?.arguments)) }
      } catch (error) {
        const reason = error?.message ?? String(error)
        return {
          jsonrpc: '2.0',
          id,
          result: toolText(
            `Shredder call failed: ${reason}. Is the Shredder desktop app running?`,
            true,
          ),
        }
      }
    }
    default:
      if (id === undefined) return null
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

const reader = readline.createInterface({ input: process.stdin, terminal: false })

reader.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })
    return
  }
  try {
    const response = await handle(message)
    if (response) send(response)
  } catch (error) {
    note('unhandled error:', error?.stack || String(error))
    if (message?.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } })
    }
  }
})

note(`MCP ready. Forwarding to ${BASE_URL}`)
