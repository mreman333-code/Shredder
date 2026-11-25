#!/usr/bin/env node
/**
 * Packages the Windows desktop build: release/Shredder-win32-x64/Shredder.exe
 *
 * Replaces `electron-packager`, which exits silently on some Node versions.
 * Steps: fetch the official Electron win32-x64 zip (cached + SHA256 verified),
 * extract it, rename electron.exe, then copy the app and AI bridge files in.
 *
 * Usage: npm run dist:win   (runs the renderer build first)
 * Needs: dist/ to exist, so `npm run build` has already run.
 *
 * The assembly step is exported so `scripts/package-test.mjs` can exercise it
 * against a fixture archive without downloading Electron.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutDir = path.join(projectRoot, 'release', 'Shredder-win32-x64')
const cacheDir = path.join(projectRoot, '.cache')
const artifactUrlFor = (version) =>
  `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`

export const APP_NAME = 'Shredder'
export const PLATFORM = 'win32'
export const ARCH = 'x64'

const cliLog = (message) => console.log(`[dist:win] ${message}`)

// ---------------------------------------------------------------- downloads

async function fetchBuffer(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function sha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function expectedChecksum(version, name, log) {
  try {
    const shasums = await fetchBuffer(
      `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`,
    )
    const line = shasums
      .toString('utf8')
      .split('\n')
      .find((row) => row.trim().endsWith(`*${name}`) || row.trim().endsWith(` ${name}`))
    if (!line) throw new Error('no checksum line for the artifact')
    return line.trim().split(/\s+/)[0]
  } catch (error) {
    // Publishing the checksum is optional for a build; the size check still applies.
    log(`warning: could not fetch checksums (${error.message})`)
    return null
  }
}

async function electronArchive({ version, log }) {
  const artifact = `electron-v${version}-${PLATFORM}-${ARCH}.zip`
  const cached = path.join(cacheDir, artifact)
  const expected = await expectedChecksum(version, artifact, log)

  if (fs.existsSync(cached) && fs.statSync(cached).size > 50 * 1024 * 1024) {
    if (!expected || (await sha256(cached)) === expected) {
      log(`using cached ${path.relative(projectRoot, cached)}`)
      return cached
    }
    log('cached Electron archive failed its checksum, downloading again')
    fs.rmSync(cached, { force: true })
  }

  fs.mkdirSync(cacheDir, { recursive: true })
  const temp = `${cached}.download`
  log(`downloading Electron ${version} (${PLATFORM}-${ARCH})`)
  const response = await fetch(artifactUrlFor(version), { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} for ${artifact}`)
  }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(temp)
    const reader = response.body.getReader()
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) return out.end(resolve)
        out.write(Buffer.from(value), (error) => (error ? reject(error) : pump()))
      }, reject)
    out.on('error', reject)
    pump()
  })

  const actual = await sha256(temp)
  if (expected && actual !== expected) {
    fs.rmSync(temp, { force: true })
    throw new Error(`checksum mismatch for ${artifact}: expected ${expected}, got ${actual}`)
  }
  if (fs.statSync(temp).size < 50 * 1024 * 1024) {
    fs.rmSync(temp, { force: true })
    throw new Error('downloaded Electron archive looks truncated')
  }
  fs.renameSync(temp, cached)
  log(`downloaded ${(fs.statSync(cached).size / 1024 / 1024).toFixed(1)} MB`)
  return cached
}

// ---------------------------------------------------------------- zip reader

/** Reads a zip's central directory. Electron archives have no zip64 entries. */
export function readZipEntries(buffer) {
  let eocd = -1
  const stop = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= stop; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory')
    const entry = {
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      nameLength: buffer.readUInt16LE(offset + 28),
      extraLength: buffer.readUInt16LE(offset + 30),
      commentLength: buffer.readUInt16LE(offset + 32),
      localOffset: buffer.readUInt32LE(offset + 42),
      name: '',
    }
    entry.name = buffer.toString('utf8', offset + 46, offset + 46 + entry.nameLength)
    entries.push(entry)
    offset += 46 + entry.nameLength + entry.extraLength + entry.commentLength
  }
  return entries
}

export function extractZip(zipPath, targetDir) {
  const buffer = fs.readFileSync(zipPath)
  const target = path.resolve(targetDir)
  const entries = readZipEntries(buffer)

  for (const entry of entries) {
    const destination = path.resolve(target, entry.name)
    if (destination !== target && !destination.startsWith(`${target}${path.sep}`)) {
      throw new Error(`refusing to extract outside the output folder: ${entry.name}`)
    }
    if (entry.name.endsWith('/')) {
      fs.mkdirSync(destination, { recursive: true })
      continue
    }
    if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
      throw new Error(`corrupt local header for ${entry.name}`)
    }
    const nameLength = buffer.readUInt16LE(entry.localOffset + 26)
    const extraLength = buffer.readUInt16LE(entry.localOffset + 28)
    const start = entry.localOffset + 30 + nameLength + extraLength
    const raw = buffer.subarray(start, start + entry.compressedSize)
    let data
    if (entry.method === 0) data = raw
    else if (entry.method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`)

    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, data)
  }
  return entries.length
}

// ------------------------------------------------------------------ layout

function copy(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`missing ${source}`)
  fs.cpSync(source, destination, { recursive: true })
}

/**
 * Extracts an Electron win32-x64 archive and assembles the Shredder layout in
 * `outDir`. Throws (rather than exiting) so callers can test it.
 */
export async function assemble({
  rootDir = projectRoot,
  outDir = defaultOutDir,
  zipPath,
  log = cliLog,
} = {}) {
  const distIndex = path.join(rootDir, 'dist', 'index.html')
  if (!fs.existsSync(distIndex)) {
    throw new Error('dist/index.html is missing — run "npm run build" first (npm run dist:win does this)')
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const archive =
    zipPath ?? (await electronArchive({ version: require('electron/package.json').version, log }))
  const entries = extractZip(archive, outDir)
  log(`extracted ${entries} Electron files into ${path.relative(projectRoot, outDir)}`)

  const electronExe = path.join(outDir, 'electron.exe')
  if (!fs.existsSync(electronExe)) throw new Error('electron.exe was not in the Electron archive')
  fs.renameSync(electronExe, path.join(outDir, `${APP_NAME}.exe`))
  fs.rmSync(path.join(outDir, 'resources', 'default_app.asar'), { force: true })

  const appDir = path.join(outDir, 'resources', 'app')
  fs.mkdirSync(appDir, { recursive: true })
  copy(path.join(rootDir, 'electron'), path.join(appDir, 'electron'))
  copy(path.join(rootDir, 'dist'), path.join(appDir, 'dist'))
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(appDir, 'package.json'))

  const aiDir = path.join(outDir, 'resources', 'ai')
  fs.mkdirSync(aiDir, { recursive: true })
  for (const file of ['tools.cjs', 'mcp-server.cjs', 'mcp.example.json', 'README.md']) {
    fs.copyFileSync(path.join(rootDir, 'ai', file), path.join(aiDir, file))
  }
  fs.copyFileSync(path.join(rootDir, 'ai', 'README.md'), path.join(outDir, 'README.md'))

  const iconSource = path.join(rootDir, 'build', 'icon.ico')
  if (!fs.existsSync(iconSource)) {
    if (process.platform !== 'win32') {
      throw new Error('build/icon.ico is missing — run scripts/make-icon.ps1 first')
    }
    const generated = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(rootDir, 'scripts', 'make-icon.ps1')],
      { stdio: 'inherit', cwd: rootDir },
    )
    if (generated.status !== 0 || !fs.existsSync(iconSource)) {
      throw new Error('could not generate build/icon.ico')
    }
  }
  fs.copyFileSync(iconSource, path.join(outDir, 'resources', 'icon.ico'))

  const missing = verifyLayout(outDir)
  if (missing.length > 0) {
    throw new Error(`packaged build is incomplete, missing: ${missing.join(', ')}`)
  }

  const exe = path.join(outDir, `${APP_NAME}.exe`)
  log(`built ${path.relative(projectRoot, exe)} (${(fs.statSync(exe).size / 1024 / 1024).toFixed(0)} MB)`)
  log(`run it from ${outDir}`)
  return outDir
}

/** Relative paths a usable packaged folder must contain. */
export const REQUIRED_FILES = [
  `${APP_NAME}.exe`,
  path.join('resources', 'app', 'package.json'),
  path.join('resources', 'app', 'electron', 'main.cjs'),
  path.join('resources', 'app', 'electron', 'preload.cjs'),
  path.join('resources', 'app', 'electron', 'projects.cjs'),
  path.join('resources', 'app', 'electron', 'models.cjs'),
  path.join('resources', 'app', 'electron', 'blender-export.py'),
  path.join('resources', 'icon.ico'),
  path.join('resources', 'app', 'dist', 'index.html'),
  path.join('resources', 'ai', 'tools.cjs'),
  path.join('resources', 'ai', 'mcp-server.cjs'),
  path.join('README.md'),
]

export function verifyLayout(outDir) {
  return REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(outDir, file)))
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  assemble().catch((error) => {
    console.error(`[dist:win] ${error?.message ?? String(error)}`)
    process.exit(1)
  })
}
