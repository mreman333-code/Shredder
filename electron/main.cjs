const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { startBridge } = require('./bridge.cjs')
const { registerProjects } = require('./projects.cjs')
const { registerModels } = require('./models.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '..', 'build', 'icon.ico')
const AI_PORT = Number(process.env.SHREDDER_AI_PORT || 3927)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

/** @type {BrowserWindow | null} */
let win = null
const pending = new Map()

/** @type {{ state: 'starting' | 'ready' | 'error', url: string, port: number, tools: number, error?: string }} */
let bridgeStatus = {
  state: 'starting',
  url: `http://127.0.0.1:${AI_PORT}`,
  port: AI_PORT,
  tools: 0,
}

function publishBridgeStatus(next) {
  bridgeStatus = next
  if (win && !win.isDestroyed()) win.webContents.send('ai:status', bridgeStatus)
}

let aiPaused = false

ipcMain.handle('ai:status', () => bridgeStatus)

ipcMain.handle('ai:set-paused', (_event, paused) => {
  aiPaused = Boolean(paused)
  publishBridgeStatus({ ...bridgeStatus, paused: aiPaused })
  return aiPaused
})

ipcMain.on('ai:response', (_event, message) => {
  if (!message || typeof message.id !== 'string') return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  clearTimeout(entry.timer)
  if (message.ok) entry.resolve(message.result)
  else entry.reject(new Error(message.error || 'The Shredder window rejected the request'))
})

function requestRenderer(tool, args, meta = {}, timeoutMs = 20000) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.reject(new Error('Open the Shredder window before calling its tools'))
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Shredder did not answer within 20 seconds'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    win.webContents.send('ai:request', {
      id,
      tool,
      args: args ?? {},
      session: typeof meta.session === 'string' ? meta.session : undefined,
    })
  })
}

function loadTools() {
  const toolsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ai', 'tools.cjs')
    : path.join(__dirname, '..', 'ai', 'tools.cjs')
  return require(toolsPath).TOOLS
}

function serveAppFile(request) {
  const { pathname } = new URL(request.url)
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  const filePath = path.resolve(DIST, `.${relative}`)
  if (!filePath.startsWith(path.resolve(DIST))) {
    return new Response('Not found', { status: 404 })
  }
  try {
    const data = fs.readFileSync(filePath)
    const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    return new Response(data, { headers: { 'content-type': type } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

// Closing the window asks about saving first. The page performs the write, so
// the window only closes after it reports success (or the user declines).
let allowClose = false
let closePromptOpen = false
/** @type {{ requestId: string, finish: (status: 'saved' | 'failed' | 'unavailable') => void } | null} */
let saveRequest = null

ipcMain.on('app:save-before-close-done', (_event, message) => {
  if (!message || typeof message.requestId !== 'string') return
  if (!saveRequest || saveRequest.requestId !== message.requestId) return
  saveRequest.finish(message.ok ? 'saved' : 'failed')
})

function requestFinalSave(timeoutMs = 8000) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.resolve('unavailable')
  }
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve) => {
    let timer
    const finish = (status) => {
      clearTimeout(timer)
      if (saveRequest && saveRequest.requestId === requestId) saveRequest = null
      resolve(status)
    }
    timer = setTimeout(() => {
      console.warn('[shredder] the window did not confirm the final save in time')
      finish('unavailable')
    }, timeoutMs)
    saveRequest = { requestId, finish }
    win.webContents.send('app:save-before-close', requestId)
  })
}

async function askBeforeClose() {
  if (closePromptOpen) return
  if (!win || win.isDestroyed()) {
    allowClose = true
    app.quit()
    return
  }
  closePromptOpen = true
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Save and close', 'Close without saving', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Save before closing?',
      message: 'Save your progress before closing Shredder?',
      detail:
        'Your projects are kept in the Shredder library, so saving takes a moment. Cancel keeps the window open.',
    })
    if (!win || win.isDestroyed()) {
      allowClose = true
      return
    }
    // Cancel: the window stays open exactly as it was.
    if (response === 2) {
      win.focus()
      return
    }
    if (response === 0) {
      const status = await requestFinalSave()
      if (!win || win.isDestroyed()) {
        allowClose = true
        return
      }
      if (status === 'failed') {
        await dialog.showMessageBox(win, {
          type: 'error',
          buttons: ['OK'],
          noLink: true,
          title: 'Could not save',
          message: 'Shredder could not save your progress, so the window stays open.',
          detail: 'Check that the project folder is writable, then try closing again.',
        })
        win.focus()
        return
      }
    }
    allowClose = true
    win.close()
  } catch (error) {
    console.error('[shredder] save-before-close prompt failed:', error)
  } finally {
    closePromptOpen = false
  }
}

function createWindow() {
  // A window that opens later (macOS activate) must ask about saving again.
  allowClose = false
  saveRequest = null
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#141416',
    title: 'Shredder',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })
  // Every close (X button, Alt+F4, quit) asks to save first.
  win.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    void askBeforeClose()
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[shredder] failed to load ${url} (${code}): ${description}`)
  })

  // Dropping a file on the window would otherwise navigate to that file and
  // replace the app with it. Imports run in the page, so only reloads inside
  // the app's own origin are allowed to navigate.
  win.webContents.on('will-navigate', (event, url) => {
    const current = win?.webContents.getURL() ?? ''
    let sameOrigin = false
    try {
      sameOrigin = new URL(url).origin === new URL(current).origin
    } catch {
      sameOrigin = false
    }
    if (sameOrigin) return
    event.preventDefault()
    console.warn(`[shredder] blocked navigation to ${url}`)
  })

  const devUrl = process.env.SHREDDER_DEV_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadURL('app://shredder/index.html')
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.shredder.app')
  app.setName('Shredder')

  protocol.handle('app', serveAppFile)
  registerProjects({ ipcMain, app, dialog, shell, getWindow: () => win ?? undefined })
  registerModels({ ipcMain, dialog, getWindow: () => win ?? undefined })
  createWindow()

  const tools = loadTools()
  startBridge({
    port: AI_PORT,
    tools,
    request: requestRenderer,
    isPaused: () => aiPaused,
  })
    .then(() => {
      publishBridgeStatus({
        state: 'ready',
        url: `http://127.0.0.1:${AI_PORT}`,
        port: AI_PORT,
        tools: tools.length,
        paused: aiPaused,
      })
      console.log(
        `[shredder] AI bridge: http://127.0.0.1:${AI_PORT} (${tools.length} tools, MCP server: resources/ai/mcp-server.cjs)`,
      )
    })
    .catch((error) => {
      publishBridgeStatus({
        state: 'error',
        url: `http://127.0.0.1:${AI_PORT}`,
        port: AI_PORT,
        tools: 0,
        error: error?.message ?? String(error),
      })
      console.error('[shredder] AI bridge failed to start:', error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
