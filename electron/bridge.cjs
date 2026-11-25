const http = require('node:http')

const MAX_BODY = 4 * 1024 * 1024
/** Calls without an explicit session id are grouped until this much idle time. */
const SESSION_GAP_MS = 2 * 60 * 1000

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Request body must be JSON'))
      }
    })
    req.on('error', reject)
  })
}

function openAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }))
}

/**
 * MCP clients send a stable per-process id, so every call from one model run
 * can be reverted together. Plain HTTP callers may send one too; otherwise
 * calls are grouped until a short idle gap starts a new session.
 */
function sessionFor(req, body, rolling) {
  const header = req.headers['x-shredder-session']
  const fromHeader = typeof header === 'string' ? header.trim() : ''
  const fromBody = typeof body?.session === 'string' ? body.session.trim() : ''
  const provided = (fromHeader || fromBody).slice(0, 120)
  if (provided) return provided

  const now = Date.now()
  if (!rolling.id || now - rolling.at > SESSION_GAP_MS) {
    rolling.id = `http-${now.toString(36)}`
  }
  rolling.at = now
  return rolling.id
}

/**
 * Loopback HTTP API that forwards tool calls to the running Shredder window.
 * Only bound to 127.0.0.1 and it refuses requests that carry a browser Origin,
 * so web pages cannot drive the app.
 */
function startBridge({ request, tools, port = 3927, host = '127.0.0.1', isPaused = () => false }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const rolling = { id: '', at: 0 }

  const server = http.createServer(async (req, res) => {
    if (req.headers.origin) {
      json(res, 403, { ok: false, error: 'Browser origins cannot drive the Shredder bridge' })
      return
    }

    const { pathname } = new URL(req.url, `http://${host}:${port}`)

    if (req.method === 'GET' && (pathname === '/ai' || pathname === '/ai/health')) {
      json(res, 200, {
        ok: true,
        app: 'Shredder',
        paused: Boolean(isPaused()),
        tools: tools.map((tool) => tool.name),
      })
      return
    }

    if (req.method === 'GET' && pathname === '/ai/tools') {
      json(res, 200, { tools: openAiTools(tools) })
      return
    }

    if (req.method === 'POST' && pathname === '/ai/call') {
      if (isPaused()) {
        json(res, 423, {
          ok: false,
          error: 'Shredder is paused. Resume the AI bridge in the app’s AI panel.',
        })
        return
      }

      let body
      try {
        body = await readJson(req)
      } catch (error) {
        json(res, 400, { ok: false, error: error.message })
        return
      }

      const name =
        typeof body.tool === 'string' ? body.tool : typeof body.name === 'string' ? body.name : ''
      const args =
        body.arguments && typeof body.arguments === 'object'
          ? body.arguments
          : body.args && typeof body.args === 'object'
            ? body.args
            : {}

      if (!byName.has(name)) {
        json(res, 404, {
          ok: false,
          error: `Unknown tool "${name}". Available: ${[...byName.keys()].join(', ')}`,
        })
        return
      }

      const session = sessionFor(req, body, rolling)
      try {
        const result = await request(name, args, { session })
        json(res, 200, { ok: true, session, result })
      } catch (error) {
        json(res, 400, { ok: false, session, error: error?.message ?? String(error) })
      }
      return
    }

    json(res, 404, { ok: false, error: 'Not found. Use GET /ai/tools or POST /ai/call.' })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })
}

module.exports = { startBridge }
