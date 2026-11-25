// Verifies the installer artifact and the manifest written by make-installer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'release', 'installer.json')

assert.ok(fs.existsSync(manifestPath), 'release/installer.json is missing — run npm run installer:win')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const installer = path.join(root, manifest.installer)

assert.equal(manifest.installDir, 'C:\\Shredder', 'the install path is fixed for the MCP config')
assert.ok(fs.existsSync(installer), `${manifest.installer} is missing`)
const bytes = fs.readFileSync(installer)
assert.equal(bytes.subarray(0, 2).toString('latin1'), 'MZ', 'the installer is a Windows executable')
assert.ok(bytes.length > 20 * 1024 * 1024, 'the installer contains the Electron payload')
assert.ok(bytes.includes(Buffer.from('NullsoftInst', 'latin1')), 'the executable is an NSIS installer')

const icon = fs.readFileSync(path.join(root, manifest.icon))
assert.equal(icon.readUInt16LE(0), 0, 'icon header reserved')
assert.equal(icon.readUInt16LE(2), 1, 'icon type')
assert.ok(icon.readUInt16LE(4) >= 5, 'the icon has multiple sizes')

console.log(
  `installer OK: ${manifest.installer} (${(bytes.length / 1024 / 1024).toFixed(1)} MB, ` +
    `install dir ${manifest.installDir}, ${icon.readUInt16LE(4)} icon sizes, ` +
    `${manifest.signed ? 'signed' : 'unsigned'})`,
)
