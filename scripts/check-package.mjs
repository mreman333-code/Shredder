/**
 * Verifies a packaged Windows folder (the CI gate after `npm run dist:win`).
 * Checks the layout, that the renderer references real asset files, that the
 * app entry points exist, and that the shipped bridge exposes every tool.
 *
 * Usage: node scripts/check-package.mjs [folder]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { verifyLayout } from './package-win.mjs'

const require = createRequire(import.meta.url)
const folder = path.resolve(process.argv[2] ?? 'release/Shredder-win32-x64')
const failures = []
const check = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

if (!fs.existsSync(folder)) {
  console.error(`[check:package] ${folder} does not exist — run "npm run dist:win" first`)
  process.exit(1)
}

const missing = verifyLayout(folder)
check(missing.length === 0, `required files present${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)

const exe = path.join(folder, 'Shredder.exe')
check(
  fs.existsSync(exe) && fs.statSync(exe).size > 50 * 1024 * 1024,
  'Shredder.exe is a full Electron binary',
)

const appDir = path.join(folder, 'resources', 'app')
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
check(pkg.main === 'electron/main.cjs', 'app package.json points at the main process')
check(
  fs.existsSync(path.join(appDir, 'electron', 'bridge.cjs')),
  'AI bridge ships with the app',
)
check(
  !fs.existsSync(path.join(folder, 'resources', 'default_app.asar')),
  'Electron default app removed',
)

const index = fs.readFileSync(path.join(appDir, 'dist', 'index.html'), 'utf8')
const assets = [...index.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((match) => match[1])
check(assets.length > 0, `index.html references ${assets.length} local asset(s)`)
check(
  assets.every((asset) => fs.existsSync(path.join(appDir, 'dist', asset))),
  'every referenced asset exists',
)

const tools = require(path.join(folder, 'resources', 'ai', 'tools.cjs')).TOOLS
check(Array.isArray(tools) && tools.length > 0, `shipped bridge exposes ${tools.length} tools`)
check(
  tools.every((tool) => tool.name && tool.inputSchema?.type === 'object'),
  'shipped tool schemas are intact',
)
check(
  fs.existsSync(path.join(folder, 'resources', 'ai', 'mcp-server.cjs')),
  'MCP server ships next to the tools',
)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\n${path.basename(folder)} OK`)
