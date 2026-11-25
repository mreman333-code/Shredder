// Builds release/Shredder-Setup-<version>.exe from the packaged folder.
// Vendors portable NSIS and rcedit into .cache/ so no system install is needed.
// Code signing is opt-in: set SHREDDER_SIGN_PFX (+ SHREDDER_SIGN_PASSWORD) to
// sign the app and the installer. Without a certificate SmartScreen still warns.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractZip } from './package-win.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const sourceDir = path.join(releaseDir, 'Shredder-win32-x64')
const cacheDir = path.join(root, '.cache')
const iconPath = path.join(root, 'build', 'icon.ico')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const installerPath = path.join(releaseDir, `Shredder-Setup-${version}.exe`)

const NSIS_VERSION = '3.10'
const NSIS_URL = `https://downloads.sourceforge.net/project/nsis/NSIS%203/${NSIS_VERSION}/nsis-${NSIS_VERSION}.zip`
const RCEDIT_URL = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe'

function log(message) {
  console.log(`[installer] ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function run(command, args, label) {
  log(label)
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root })
  if (result.error) fail(`${label}: ${result.error.message}`)
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`)
}

async function download(url, destination) {
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) return
  log(`download ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`download failed (${response.status} ${response.statusText}): ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, bytes)
  log(`cached ${path.relative(root, destination)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`)
}

function ensureIcon() {
  if (fs.existsSync(iconPath)) return
  if (process.platform !== 'win32') fail('build/icon.ico is missing; run scripts/make-icon.ps1 on Windows')
  run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'make-icon.ps1')],
    'generate app icon',
  )
  if (!fs.existsSync(iconPath)) fail('icon generation did not produce build/icon.ico')
}

async function ensureNsis() {
  const makensis = path.join(cacheDir, 'nsis', `nsis-${NSIS_VERSION}`, 'makensis.exe')
  if (fs.existsSync(makensis)) return makensis
  const archive = path.join(cacheDir, `nsis-${NSIS_VERSION}.zip`)
  await download(NSIS_URL, archive)
  extractZip(archive, path.join(cacheDir, 'nsis'))
  if (!fs.existsSync(makensis)) fail(`NSIS archive did not contain ${makensis}`)
  return makensis
}

async function ensureRcedit() {
  const rcedit = path.join(cacheDir, 'rcedit-x64.exe')
  await download(RCEDIT_URL, rcedit)
  return rcedit
}

function findSignTool() {
  if (process.env.SHREDDER_SIGNTOOL) {
    if (!fs.existsSync(process.env.SHREDDER_SIGNTOOL)) {
      fail(`SHREDDER_SIGNTOOL does not exist: ${process.env.SHREDDER_SIGNTOOL}`)
    }
    return process.env.SHREDDER_SIGNTOOL
  }
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  if (!fs.existsSync(kits)) return null
  const versions = fs
    .readdirSync(kits, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const versionDir of versions) {
    const candidate = path.join(kits, versionDir, 'x64', 'signtool.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function sign(file, signtool) {
  const pfx = path.resolve(root, process.env.SHREDDER_SIGN_PFX)
  if (!fs.existsSync(pfx)) fail(`signing certificate not found: ${pfx}`)
  const password = process.env.SHREDDER_SIGN_PASSWORD
  if (!password) fail('SHREDDER_SIGN_PASSWORD is required when SHREDDER_SIGN_PFX is set')
  const timestamp = process.env.SHREDDER_TIMESTAMP_URL || 'http://timestamp.digicert.com'
  run(
    signtool,
    ['sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', timestamp, '/f', pfx, '/p', password, file],
    `sign ${path.basename(file)}`,
  )
}

async function main() {
  if (process.platform !== 'win32') {
    fail('the Windows installer can only be built on Windows')
  }
  const appExe = path.join(sourceDir, 'Shredder.exe')
  if (!fs.existsSync(appExe)) {
    fail('release/Shredder-win32-x64 is missing — run "node scripts/package-win.mjs" first')
  }

  ensureIcon()
  const makensis = await ensureNsis()
  const rcedit = await ensureRcedit()

  run(
    rcedit,
    [
      appExe,
      '--set-icon',
      iconPath,
      '--set-file-version',
      version,
      '--set-product-version',
      version,
      '--set-version-string',
      'CompanyName',
      'Shredder',
      '--set-version-string',
      'FileDescription',
      'Shredder',
      '--set-version-string',
      'ProductName',
      'Shredder',
      '--set-version-string',
      'OriginalFilename',
      'Shredder.exe',
      '--set-version-string',
      'LegalCopyright',
      '© Shredder',
    ],
    'set Shredder.exe icon and version information',
  )

  const pfx = process.env.SHREDDER_SIGN_PFX
  const signtool = pfx ? findSignTool() : null
  if (pfx && !signtool) {
    fail('SHREDDER_SIGN_PFX is set but signtool.exe was not found (install the Windows SDK or set SHREDDER_SIGNTOOL)')
  }
  if (pfx) sign(appExe, signtool)

  run(
    makensis,
    [
      '/V3',
      `/DSOURCE=${sourceDir}`,
      `/DOUTFILE=${installerPath}`,
      `/DVERSION=${version}`,
      `/DAPPICON=${iconPath}`,
      path.join(root, 'scripts', 'installer.nsi'),
    ],
    'compile NSIS installer',
  )

  if (!fs.existsSync(installerPath)) fail('makensis finished without producing the installer')
  if (pfx) sign(installerPath, signtool)

  const manifest = {
    name: 'Shredder',
    version,
    installer: path.relative(root, installerPath),
    installDir: 'C:\\Shredder',
    source: path.relative(root, sourceDir),
    icon: path.relative(root, iconPath),
    signed: Boolean(pfx),
    bytes: fs.statSync(installerPath).size,
    builtAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(releaseDir, 'installer.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  log(`built ${path.relative(root, installerPath)} (${(manifest.bytes / 1024 / 1024).toFixed(1)} MB)`)
  if (!pfx) {
    log('not signed: Windows SmartScreen will show "Unknown publisher" until the installer is Authenticode-signed')
  }
}

main().catch((error) => {
  console.error(`[installer] ${error?.message ?? String(error)}`)
  process.exit(1)
})
