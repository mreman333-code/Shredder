/**
 * Headless check of the Windows packaging step.
 *
 * Builds a throwaway project folder and a fake Electron archive, then runs the
 * real `assemble` from package-win.mjs against them: no Electron download, no
 * window. Fails if the layout drifts (exe rename, default_app removal, app/AI
 * files, README) or if a missing dist is not reported.
 *
 * Usage: node scripts/package-test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assemble, readZipEntries, verifyLayout } from './package-win.mjs'

const failures = []
const check = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

// --- a minimal stored-zip writer, enough to stand in for Electron's archive ---
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  return (crc ^ -1) >>> 0
}
function createZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    locals.push(local, nameBuffer, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(nameBuffer.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([header, nameBuffer]))
    offset += 30 + nameBuffer.length + data.length
  }
  const directory = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shredder-package-'))
const fixture = path.join(temp, 'project')
const output = path.join(temp, 'out')
const write = (relative, content) => {
  const file = path.join(fixture, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

try {
  write('package.json', JSON.stringify({ name: 'shredder', main: 'electron/main.cjs' }))
  write('dist/index.html', '<script src="./assets/app.js"></script>')
  write('dist/assets/app.js', 'console.log(1)')
  for (const file of ['main.cjs', 'preload.cjs', 'bridge.cjs', 'projects.cjs'])
    write(`electron/${file}`, '// fixture')
  for (const file of ['tools.cjs', 'mcp-server.cjs', 'mcp.example.json', 'README.md']) {
    write(`ai/${file}`, '// fixture')
  }
  write('build/icon.ico', Buffer.from([0, 0, 1, 0, 0, 0]))

  const archive = path.join(temp, 'electron-v0.0.0-win32-x64.zip')
  fs.writeFileSync(
    archive,
    createZip([
      { name: 'electron.exe', data: Buffer.alloc(64, 7) },
      { name: 'resources/default_app.asar', data: Buffer.from('default app') },
      { name: 'version', data: Buffer.from('0.0.0') },
      { name: 'locales/en-US.pak', data: Buffer.from('locale') },
    ]),
  )
  check(readZipEntries(fs.readFileSync(archive)).length === 4, 'fixture archive is readable')

  await assemble({
    rootDir: fixture,
    outDir: output,
    zipPath: archive,
    log: () => {},
  })

  check(fs.existsSync(path.join(output, 'Shredder.exe')), 'electron.exe renamed to Shredder.exe')
  check(!fs.existsSync(path.join(output, 'electron.exe')), 'original electron.exe is gone')
  check(
    !fs.existsSync(path.join(output, 'resources', 'default_app.asar')),
    'default_app.asar removed',
  )
  check(
    fs.readFileSync(path.join(output, 'version'), 'utf8') === '0.0.0',
    'archive files kept',
  )
  check(
    fs.existsSync(path.join(output, 'resources', 'app', 'dist', 'assets', 'app.js')),
    'renderer dist copied',
  )
  check(
    fs.existsSync(path.join(output, 'resources', 'app', 'electron', 'main.cjs')),
    'main process copied',
  )
  check(
    fs.existsSync(path.join(output, 'resources', 'ai', 'mcp-server.cjs')),
    'MCP server copied',
  )
  check(fs.existsSync(path.join(output, 'README.md')), 'connector README copied')
  check(verifyLayout(output).length === 0, 'verifyLayout accepts the assembled folder')

  // A build without a renderer bundle must fail loudly instead of shipping empty.
  const emptyRoot = path.join(temp, 'empty')
  fs.mkdirSync(path.join(emptyRoot, 'electron'), { recursive: true })
  fs.writeFileSync(path.join(emptyRoot, 'package.json'), '{}')
  let errorMessage = ''
  try {
    await assemble({ rootDir: emptyRoot, outDir: path.join(temp, 'empty-out'), zipPath: archive })
  } catch (error) {
    errorMessage = error.message
  }
  check(/dist\/index\.html is missing/.test(errorMessage), 'missing dist is reported')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\npackaging OK')
