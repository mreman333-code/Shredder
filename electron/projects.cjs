const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const { readModel, MODEL_EXTENSIONS } = require('./models.cjs')

const INDEX_FILE = 'library.json'
/** `shredder` is still accepted so projects saved before the rename open. */
const PROJECT_FORMATS = new Set(['shredder', 'miniblend'])
const isProjectFormat = (format) => PROJECT_FORMATS.has(String(format))
const PROJECT_FILTERS = [{ name: 'Shredder project', extensions: ['blend', 'mblend', 'json'] }]
const OPEN_FILTERS = [
  { name: 'Shredder projects and models', extensions: ['blend', 'mblend', 'json', ...MODEL_EXTENSIONS] },
  { name: 'All files', extensions: ['*'] },
]

function safeName(value, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.(blend|mblend)$/i, '')
    .trim()
  return cleaned || fallback
}

function projectFilename(value) {
  return `${safeName(value, 'Untitled')}.blend`
}

/**
 * Real files on disk: every project is a `.blend` JSON document inside
 * Documents/Shredder (organized by the in-app folders), or at an absolute path
 * the user picked with the native Save As dialog. `library.json` only records
 * ids, folder assignments and active selections.
 */
function createProjectStore({ app, dialog, getWindow }) {
  const root = (() => {
    const preferred = path.join(app.getPath('documents'), 'Shredder')
    try {
      // A library created before the rename is moved over on first launch so no
      // project disappears just because the app got its name.
      const legacy = path.join(app.getPath('documents'), 'MiniBlend')
      if (!fs.existsSync(preferred) && fs.existsSync(legacy)) {
        fs.cpSync(legacy, preferred, { recursive: true })
      }
      fs.mkdirSync(preferred, { recursive: true })
      return preferred
    } catch {
      // Documents can be missing or read-only (redirected profiles, locked
      // folders); the app data folder is always writable.
      const fallback = path.join(app.getPath('userData'), 'Shredder')
      fs.mkdirSync(fallback, { recursive: true })
      return fallback
    }
  })()
  const indexPath = path.join(root, INDEX_FILE)
  /** Serialized docs already on disk, so autosave only rewrites what changed. */
  const written = new Map()

  const ensureRoot = () => fs.mkdirSync(root, { recursive: true })

  function readIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      if (parsed && Array.isArray(parsed.files)) return parsed
    } catch {
      // First run or a corrupt index: start with an empty library.
    }
    return { version: 1, folders: [], files: [], activeFileId: null, activeFolderId: null }
  }

  async function writeAtomic(target, content) {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    await fsp.writeFile(temp, content, 'utf8')
    await fsp.rename(temp, target)
  }

  function libraryPath(folders, file) {
    const folder = folders.find((entry) => entry.id === file.folderId)
    return path.join(root, folder ? safeName(folder.name, 'Folder') : '', projectFilename(file.name))
  }

  async function load() {
    ensureRoot()
    const index = readIndex()
    const files = []
    for (const meta of index.files) {
      const target = meta.externalPath || meta.path
      if (!target) continue
      try {
        const doc = JSON.parse(await fsp.readFile(target, 'utf8'))
        if (!doc || !isProjectFormat(doc.format)) continue
        files.push({
          id: meta.id,
          name: meta.name,
          folderId: meta.folderId ?? null,
          externalPath: meta.externalPath ?? undefined,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          doc,
        })
        written.set(target, JSON.stringify(doc, null, 2))
      } catch {
        // A deleted or unreadable file drops out of the library; it is not recreated.
      }
    }
    return {
      root,
      folders: index.folders ?? [],
      files,
      activeFileId: index.activeFileId ?? null,
      activeFolderId: index.activeFolderId ?? null,
    }
  }

  async function save(payload) {
    ensureRoot()
    const folders = Array.isArray(payload?.folders) ? payload.folders : []
    const files = Array.isArray(payload?.files) ? payload.files : []
    const previous = readIndex()
    const managedBefore = (previous.files ?? [])
      .map((meta) => meta.path)
      .filter((target) => typeof target === 'string' && target.startsWith(`${root}${path.sep}`))

    const used = new Set()
    const meta = []
    for (const file of files) {
      if (!file || !file.doc || !isProjectFormat(file.doc.format)) continue
      const target = file.externalPath
        ? path.resolve(file.externalPath)
        : libraryPath(folders, file)
      const content = JSON.stringify(file.doc, null, 2)
      if (written.get(target) !== content) {
        await writeAtomic(target, content)
        written.set(target, content)
      }
      used.add(target)
      meta.push({
        id: file.id,
        name: file.name,
        folderId: file.folderId ?? null,
        externalPath: file.externalPath ?? null,
        path: target,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      })
    }

    // Files removed from the library, renamed, or moved between folders leave a
    // stale managed copy behind; delete it. Paths outside the library are never
    // touched.
    for (const stalePath of managedBefore) {
      if (!used.has(stalePath)) {
        await fsp.rm(stalePath, { force: true }).catch(() => {})
        written.delete(stalePath)
      }
    }

    await writeAtomic(
      indexPath,
      JSON.stringify(
        {
          version: 1,
          root,
          folders,
          files: meta,
          activeFileId: payload?.activeFileId ?? null,
          activeFolderId: payload?.activeFolderId ?? null,
        },
        null,
        2,
      ),
    )
    return { root }
  }

  async function readProject(target) {
    const resolved = path.resolve(target)
    const bytes = await fsp.readFile(resolved)
    const text = bytes.toString('utf8')
    // Projects are JSON documents; everything else is model geometry.
    if (!text.trimStart().startsWith('{')) {
      return { path: resolved, name: path.basename(resolved), model: await readModel(resolved) }
    }
    const doc = JSON.parse(text)
    if (!doc || !isProjectFormat(doc.format)) throw new Error('Not a Shredder project file')
    const meta = readIndex().files.find(
      (file) =>
        file.path === resolved ||
        (file.externalPath && path.resolve(file.externalPath) === resolved),
    )
    return { path: resolved, name: path.basename(resolved), doc, id: meta?.id }
  }

  function showOpen(options) {
    const win = getWindow?.()
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
  }

  function showSave(options) {
    const win = getWindow?.()
    return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
  }

  async function openDialog() {
    const result = await showOpen({
      title: 'Open a Shredder project or import a model',
      defaultPath: root,
      properties: ['openFile'],
      filters: OPEN_FILTERS,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return readProject(result.filePaths[0])
  }

  async function saveAs({ suggestedName, content }) {
    const result = await showSave({
      title: 'Save Shredder project',
      defaultPath: path.join(root, projectFilename(suggestedName)),
      filters: PROJECT_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    await writeAtomic(result.filePath, content)
    written.set(result.filePath, content)
    return { path: result.filePath, name: path.basename(result.filePath) }
  }

  async function exportFile({ suggestedName, content, base64, extension = 'glb', label = 'Export' }) {
    const result = await showSave({
      title: label,
      defaultPath: path.join(app.getPath('documents'), safeName(suggestedName, 'export')),
      filters: [{ name: label, extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return null
    if (typeof base64 === 'string') {
      await fsp.writeFile(result.filePath, Buffer.from(base64, 'base64'))
    } else {
      await fsp.writeFile(result.filePath, String(content ?? ''), 'utf8')
    }
    return { path: result.filePath }
  }

  return { root, load, save, openDialog, saveAs, exportFile, readProject }
}

function registerProjects({ ipcMain, app, dialog, shell, getWindow }) {
  const store = createProjectStore({ app, dialog, getWindow })
  ipcMain.handle('projects:root', () => store.root)
  ipcMain.handle('projects:load', () => store.load())
  ipcMain.handle('projects:save', (_event, payload) => store.save(payload))
  ipcMain.handle('projects:open-dialog', () => store.openDialog())
  ipcMain.handle('projects:save-as', (_event, payload) => store.saveAs(payload))
  ipcMain.handle('projects:export-file', (_event, payload) => store.exportFile(payload))
  ipcMain.handle('projects:read', (_event, target) => store.readProject(target))
  ipcMain.handle('projects:reveal', (_event, target) => {
    if (typeof target === 'string') shell.showItemInFolder(target)
  })
  return store
}

module.exports = { registerProjects }
