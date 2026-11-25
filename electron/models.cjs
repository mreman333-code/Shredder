const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** Every model format Unity imports, plus Blender's own archive. */
const MODEL_EXTENSIONS = [
  'glb',
  'gltf',
  'fbx',
  'obj',
  'dae',
  '3ds',
  'stl',
  'ply',
  '3mf',
  'dxf',
  'blend',
]

const MODEL_FILTERS = [
  { name: '3D models', extensions: MODEL_EXTENSIONS },
  { name: 'All files', extensions: ['*'] },
]

function isBlenderArchive(buffer) {
  const magic = buffer.subarray(0, 7).toString('latin1')
  if (magic === 'BLENDER') return true
  // Compressed .blend archives are plain gzip streams.
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

function blenderCandidates() {
  const candidates = []
  if (process.env.SHREDDER_BLENDER) candidates.push(process.env.SHREDDER_BLENDER)
  for (const root of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
    if (!root) continue
    const foundation = path.join(root, 'Blender Foundation')
    try {
      for (const entry of fs.readdirSync(foundation)) {
        const exe = path.join(foundation, entry, 'blender.exe')
        if (fs.existsSync(exe)) candidates.push(exe)
      }
    } catch {
      // Not installed in the standard location.
    }
  }
  candidates.push('blender')
  return candidates
}

function findBlender() {
  for (const candidate of blenderCandidates()) {
    if (candidate === 'blender') {
      const probe = spawnSync('blender', ['--version'], { encoding: 'utf8', timeout: 20000 })
      if (!probe.error && probe.status === 0) return 'blender'
      continue
    }
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Blender archives are a scene database, not a mesh format. When Blender is
 * installed we ask it to export the open scene to GLB in a temp folder, then
 * import that with the normal glTF path.
 */
function exportBlendToGlb(blendPath) {
  const blender = findBlender()
  if (!blender) {
    throw new Error(
      'Blender was not found, so Shredder cannot read .blend archives. Install Blender, set SHREDDER_BLENDER to blender.exe, or export the model from Blender as GLB, FBX or OBJ.',
    )
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shredder-blend-'))
  const out = path.join(work, 'model.glb')
  const result = spawnSync(
    blender,
    [
      '--background',
      '--factory-startup',
      blendPath,
      '--python',
      path.join(__dirname, 'blender-export.py'),
      '--',
      out,
    ],
    { encoding: 'utf8', timeout: 10 * 60 * 1000, windowsHide: true },
  )
  if (result.error) {
    fs.rmSync(work, { recursive: true, force: true })
    throw new Error(`Blender could not be started: ${result.error.message}`)
  }
  if (!fs.existsSync(out)) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim().split(/\r?\n/).slice(-4).join(' ')
    fs.rmSync(work, { recursive: true, force: true })
    throw new Error(`Blender did not export the scene to GLB. ${detail}`.trim())
  }
  return { file: out, work }
}

async function readModel(target) {
  const resolved = path.resolve(target)
  const extension = path.extname(resolved).slice(1).toLowerCase()
  if (!MODEL_EXTENSIONS.includes(extension)) {
    throw new Error(`".${extension}" is not a model format Shredder can import`)
  }
  const bytes = await fsp.readFile(resolved)
  if (extension === 'blend') {
    if (!isBlenderArchive(bytes)) {
      throw new Error(
        'That .blend file is a Shredder project rather than a Blender archive. Use File > Open Project.',
      )
    }
    const converted = exportBlendToGlb(resolved)
    try {
      const glb = await fsp.readFile(converted.file)
      return {
        path: resolved,
        name: `${path.basename(resolved, path.extname(resolved))}.glb`,
        base64: glb.toString('base64'),
        converted: true,
      }
    } finally {
      fs.rmSync(converted.work, { recursive: true, force: true })
    }
  }
  return { path: resolved, name: path.basename(resolved), base64: bytes.toString('base64') }
}

function registerModels({ ipcMain, dialog, getWindow }) {
  const showOpen = (options) => {
    const win = getWindow?.()
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
  }

  ipcMain.handle('models:read', (_event, target) => readModel(String(target ?? '')))
  ipcMain.handle('models:open-dialog', async () => {
    const result = await showOpen({
      title: 'Import a 3D model',
      properties: ['openFile'],
      filters: MODEL_FILTERS,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readModel(result.filePaths[0])
  })
}

module.exports = { registerModels, readModel, MODEL_EXTENSIONS, MODEL_FILTERS, findBlender }
