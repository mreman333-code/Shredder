/**
 * Headless check of the AI bridge and MCP server, without opening Electron.
 * Starts the real bridge with a stub tool handler, exercises every endpoint and
 * the failure paths, then speaks MCP over stdio to the shipped server.
 *
 * Usage: node scripts/connector-test.cjs   (exit code 1 on any failure)
 */
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.join(__dirname, '..')
const { startBridge } = require(path.join(root, 'electron', 'bridge.cjs'))
const { TOOLS } = require(path.join(root, 'ai', 'tools.cjs'))

const PORT = 3931
const base = `http://127.0.0.1:${PORT}`
const failures = []
const sessions = []
let paused = false

function check(condition, label) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

function mcpClient(child) {
  let buffer = ''
  const pending = new Map()
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      clearTimeout(entry.timer)
      entry.resolve(message)
    }
  })

  return {
    request(id, method, params) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`MCP request timed out: ${method}`))
        }, 10000)
        pending.set(id, { resolve, timer })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
  }
}

async function main() {
  const server = await startBridge({
    port: PORT,
    tools: TOOLS,
    isPaused: () => paused,
    request: async (tool, args, meta) => {
      sessions.push(meta?.session)
      return { echoedTool: tool, echoedArgs: args, file: 'Player.blend' }
    },
  })

  try {
    const health = await (await fetch(`${base}/ai/health`)).json()
    check(health.ok === true && health.app === 'Shredder', 'health reports the app')
    check(health.tools.length === TOOLS.length, `health lists ${TOOLS.length} tools`)
    const alias = await (await fetch(`${base}/ai`)).json()
    check(alias.ok === true, '/ai works as a health alias')

    const toolList = await (await fetch(`${base}/ai/tools`)).json()
    check(toolList.tools.length === TOOLS.length, `tool schemas: ${toolList.tools.length}`)
    check(
      toolList.tools.every(
        (tool) =>
          tool.type === 'function' &&
          typeof tool.function?.name === 'string' &&
          tool.function.parameters?.type === 'object',
      ),
      'tools are OpenAI-style function definitions',
    )
    check(
      toolList.tools.some((tool) => tool.function.name === 'add_character') &&
        toolList.tools.some((tool) => tool.function.name === 'export_glb'),
      'add_character and export_glb are exposed',
    )

    const call = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'add_character', arguments: { preset: 'Scout' } }),
    })
    const callBody = await call.json()
    check(call.status === 200 && callBody.ok === true, 'tool call succeeds')
    check(
      callBody.result.echoedTool === 'add_character' &&
        callBody.result.echoedArgs.preset === 'Scout',
      'arguments reach the app unchanged',
    )
    check(
      typeof sessions[0] === 'string' && sessions[0].length > 0,
      'calls without a session header still get grouped',
    )

    const explicit = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shredder-session': 'test-session' },
      body: JSON.stringify({ tool: 'get_scene', arguments: {} }),
    })
    const explicitBody = await explicit.json()
    check(
      explicit.status === 200 && explicitBody.session === 'test-session',
      'session id is echoed back',
    )
    check(sessions.includes('test-session'), 'session id reaches the app')

    paused = true
    const pausedCall = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'get_scene' }),
    })
    check(pausedCall.status === 423, 'paused bridge refuses calls')
    const pausedHealth = await (await fetch(`${base}/ai/health`)).json()
    check(pausedHealth.paused === true, 'health reports the paused state')
    paused = false
    const resumed = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'get_scene' }),
    })
    check(resumed.status === 200, 'resuming accepts calls again')

    const unknown = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'nope' }),
    })
    const unknownBody = await unknown.json()
    check(unknown.status === 404, 'unknown tool returns 404')
    check(/get_scene/.test(unknownBody.error), 'unknown tool lists the available tools')

    const browser = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test' },
      body: JSON.stringify({ tool: 'get_scene' }),
    })
    check(browser.status === 403, 'browser origins are refused')

    const malformed = await fetch(`${base}/ai/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    })
    check(malformed.status === 400, 'invalid JSON returns 400')

    const missing = await fetch(`${base}/ai/nope`)
    check(missing.status === 404, 'unknown route returns 404')

    let conflict = ''
    try {
      await startBridge({ port: PORT, tools: TOOLS, request: async () => null })
    } catch (error) {
      conflict = error?.code ?? error?.message ?? String(error)
    }
    check(/EADDRINUSE/.test(String(conflict)), 'a second bridge on the port is refused')

    // ---- MCP over stdio, talking to the bridge above -------------------------
    const child = spawn(process.execPath, [path.join(root, 'ai/mcp-server.cjs')], {
      env: { ...process.env, SHREDDER_URL: base },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.on('data', () => {})
    child.on('error', (error) => check(false, `MCP server spawned (${error.message})`))
    const client = mcpClient(child)

    try {
      const init = await client.request(1, 'initialize', { protocolVersion: '2024-11-05' })
      check(init.result?.serverInfo?.name === 'shredder', 'MCP initialize handshake')
      check(init.result?.protocolVersion === '2024-11-05', 'MCP protocol version echoed')

      const list = await client.request(2, 'tools/list')
      check(list.result?.tools?.length === TOOLS.length, `MCP lists ${TOOLS.length} tools`)
      check(
        list.result?.tools?.every((tool) => tool.inputSchema?.type === 'object'),
        'MCP tools carry input schemas',
      )

      const result = await client.request(3, 'tools/call', {
        name: 'get_scene',
        arguments: {},
      })
      const text = result.result?.content?.[0]?.text ?? ''
      check(/get_scene/.test(text) && /Player\.blend/.test(text), 'MCP tool call reaches the app')
      check(
        sessions.some((session) => typeof session === 'string' && session.startsWith('mcp-')),
        'MCP calls carry a session id',
      )

      const badTool = await client.request(4, 'tools/call', { name: 'nope', arguments: {} })
      check(badTool.result?.isError === true, 'MCP rejects an unknown tool')

      // A model calling while the app is closed must get a useful message.
      server.close()
      const offline = await client.request(5, 'tools/call', {
        name: 'get_scene',
        arguments: {},
      })
      check(offline.result?.isError === true, 'MCP reports a closed app as an error')
      check(
        /Shredder desktop app running/.test(offline.result?.content?.[0]?.text ?? ''),
        'closed app error says to start Shredder',
      )
    } finally {
      child.kill()
    }
  } finally {
    if (server.listening) server.close()
  }
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) failed`)
      process.exit(1)
    }
    console.log('\nbridge OK')
  })
  .catch((error) => {
    console.error('FAILED', error)
    process.exit(1)
  })
