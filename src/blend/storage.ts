import {
  addPrimitive,
  createCharacter,
  newProject,
  normalizeProject,
  presetSpec,
  uid,
  type ProjectDoc,
} from './doc'

export interface FSFile {
  id: string
  name: string
  folderId: string | null
  /** Absolute path for projects saved outside the Shredder library. */
  externalPath?: string
  doc: ProjectDoc
  createdAt: number
  updatedAt: number
}

export interface FSFolder {
  id: string
  name: string
  parentId: string | null
}

export interface VFS {
  version: 1
  folders: FSFolder[]
  files: FSFile[]
  activeFileId: string | null
  activeFolderId: string | null
}

export interface InitialStore {
  fs: VFS
  file: FSFile | null
  /** Library folder used by the desktop app, null in the browser preview. */
  root: string | null
}

const STORAGE_KEY = 'shredder.fs.v1'
const SAVE_DEBOUNCE_MS = 300
const EXTENSION = /\.(blend|mblend)$/i

export function uniqueFileName(fs: VFS, base: string, folderId: string | null): string {
  const clean = base.replace(EXTENSION, '').trim() || 'Untitled'
  const used = new Set(
    fs.files.filter((f) => f.folderId === folderId).map((f) => f.name.replace(EXTENSION, '').toLowerCase()),
  )
  if (!used.has(clean.toLowerCase())) return `${clean}.blend`
  let i = 1
  while (used.has(`${clean}.${String(i).padStart(3, '0')}`.toLowerCase())) i += 1
  return `${clean}.${String(i).padStart(3, '0')}.blend`
}

export function uniqueFolderName(folders: FSFolder[], base: string): string {
  const used = new Set(folders.map((f) => f.name.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let i = 1
  while (used.has(`${base} ${i}`.toLowerCase())) i += 1
  return `${base} ${i}`
}

function docWithCharacter(fileName: string, preset: string, characterName: string): ProjectDoc {
  const doc = newProject(fileName)
  doc.objects = []
  const { group, parts } = createCharacter(doc, presetSpec(preset), characterName)
  doc.objects = [group, ...parts]
  return doc
}

function seedFS(): VFS {
  const now = Date.now()
  const characters: FSFolder = { id: uid('folder'), name: 'Characters', parentId: null }
  const drafts: FSFolder = { id: uid('folder'), name: 'Drafts', parentId: null }

  const files: FSFile[] = []

  const playerDoc = docWithCharacter('Player.blend', 'Hero', 'Player')
  playerDoc.updatedAt = now - 1000 * 60 * 6
  files.push({
    id: uid('file'),
    name: 'Player.blend',
    folderId: characters.id,
    doc: playerDoc,
    createdAt: now - 1000 * 60 * 60 * 26,
    updatedAt: now - 1000 * 60 * 6,
  })

  const runnerDoc = docWithCharacter('Runner.blend', 'Runner', 'Runner')
  runnerDoc.updatedAt = now - 1000 * 60 * 90
  files.push({
    id: uid('file'),
    name: 'Runner.blend',
    folderId: characters.id,
    doc: runnerDoc,
    createdAt: now - 1000 * 60 * 60 * 50,
    updatedAt: now - 1000 * 60 * 90,
  })

  const vanguardDoc = docWithCharacter('Vanguard.blend', 'Vanguard', 'Vanguard')
  vanguardDoc.updatedAt = now - 1000 * 60 * 60 * 5
  files.push({
    id: uid('file'),
    name: 'Vanguard.blend',
    folderId: characters.id,
    doc: vanguardDoc,
    createdAt: now - 1000 * 60 * 60 * 72,
    updatedAt: now - 1000 * 60 * 60 * 5,
  })

  let blockout = newProject('Blockout.blend')
  blockout.objects = []
  const add = (
    kind: Parameters<typeof addPrimitive>[1],
    name: string,
    pos: [number, number, number],
    scale: [number, number, number],
  ) => {
    const res = addPrimitive(blockout, kind)
    const obj = { ...res.object, name, position: pos, scale }
    blockout = { ...res.doc, objects: [...res.doc.objects.slice(0, -1), obj] }
  }
  add('box', 'Ground', [0, 0.05, 0], [4, 0.1, 4])
  add('cylinder', 'Pillar', [-1.2, 1.1, -0.8], [0.5, 2.2, 0.5])
  add('sphere', 'Marker', [1.1, 0.6, 0.4], [1.2, 1.2, 1.2])
  add('torus', 'Ring', [0.2, 0.35, -1.4], [1.4, 1.4, 1.4])
  blockout.updatedAt = now - 1000 * 60 * 60 * 30
  files.push({
    id: uid('file'),
    name: 'Blockout.blend',
    folderId: drafts.id,
    doc: blockout,
    createdAt: now - 1000 * 60 * 60 * 30,
    updatedAt: now - 1000 * 60 * 60 * 30,
  })

  return {
    version: 1,
    folders: [characters, drafts],
    files,
    activeFileId: files[0].id,
    activeFolderId: characters.id,
  }
}

/** The old localStorage store, used by the preview and for first-run migration. */
function parseLocalFS(): VFS | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VFS
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files) || !Array.isArray(parsed.folders)) {
      return null
    }
    const files = parsed.files.filter(
      (f) =>
        f &&
        typeof f.id === 'string' &&
        (f.doc?.format === 'shredder' || f.doc?.format === 'miniblend'),
    )
    const folders = parsed.folders.filter((f) => f && typeof f.id === 'string')
    const active = files.find((f) => f.id === parsed.activeFileId) ?? files[0]
    return {
      version: 1,
      folders,
      files,
      activeFileId: active?.id ?? null,
      activeFolderId: parsed.activeFolderId ?? folders[0]?.id ?? null,
    }
  } catch {
    return null
  }
}

function loadLocalFS(): VFS {
  const parsed = parseLocalFS()
  if (parsed) return parsed
  const seeded = seedFS()
  saveLocalFS(seeded)
  return seeded
}

function saveLocalFS(fs: VFS): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fs))
  } catch {
    // Storage can be full or blocked; the session continues in memory.
  }
}

function pickFile(fs: VFS): FSFile | null {
  return fs.files.find((f) => f.id === fs.activeFileId) ?? fs.files[0] ?? null
}

function libraryPayload(fs: VFS) {
  return {
    version: fs.version,
    folders: fs.folders,
    files: fs.files.map(({ id, name, folderId, externalPath, createdAt, updatedAt, doc }) => ({
      id,
      name,
      folderId,
      externalPath,
      createdAt,
      updatedAt,
      doc,
    })),
    activeFileId: fs.activeFileId,
    activeFolderId: fs.activeFolderId,
  }
}

let pending: VFS | null = null
let timer: number | undefined
let inFlight: Promise<boolean> | null = null

/**
 * Autosave to the desktop library. Writes are debounced and the main process
 * skips documents whose serialized content did not change.
 */
export function saveStore(fs: VFS): void {
  const host = window.shredderHost
  if (!host?.projects) {
    saveLocalFS(fs)
    return
  }
  pending = fs
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void flushStore()
  }, SAVE_DEBOUNCE_MS)
}

/** Writes any pending changes now; Save and AI `save_file` await this. */
export async function flushStore(): Promise<boolean> {
  // A write that is already running may predate the newest snapshot, so wait for
  // it and then write whatever is still pending instead of returning early.
  if (inFlight) await inFlight.catch(() => false)
  const host = window.shredderHost
  if (!host?.projects) {
    if (pending) {
      saveLocalFS(pending)
      pending = null
    }
    return true
  }
  const snapshot = pending
  if (!snapshot) return true
  pending = null
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
  const write = host.projects
    .save(libraryPayload(snapshot))
    .then(() => true)
    .catch((error) => {
      console.warn('[shredder] could not write the project library:', error)
      pending = pending ?? snapshot
      return false
    })
  inFlight = write
  try {
    return await write
  } finally {
    if (inFlight === write) inFlight = null
  }
}

/** Loads projects from disk in the desktop app, or localStorage in the preview. */
export async function loadInitialStore(): Promise<InitialStore> {
  const host = typeof window !== 'undefined' ? window.shredderHost : undefined
  if (host?.projects) {
    try {
      const library = await host.projects.load()
      const files: FSFile[] = []
      for (const file of library.files ?? []) {
        const doc = normalizeProject(file.doc)
        if (!doc) continue
        files.push({
          id: file.id,
          name: file.name,
          folderId: file.folderId ?? null,
          externalPath: file.externalPath,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          doc,
        })
      }
      if (files.length > 0) {
        const active = files.find((file) => file.id === library.activeFileId) ?? files[0]
        const fs: VFS = {
          version: 1,
          folders: library.folders ?? [],
          files,
          activeFileId: active?.id ?? null,
          activeFolderId: library.activeFolderId,
        }
        return { fs, file: active ?? null, root: library.root }
      }
      // First desktop launch: bring projects from the old browser store onto
      // disk before falling back to the example projects.
      const migrated = parseLocalFS()
      if (migrated) {
        await host.projects.save(libraryPayload(migrated)).catch(() => undefined)
        return { fs: migrated, file: pickFile(migrated), root: library.root }
      }
      const seeded = seedFS()
      await host.projects.save(libraryPayload(seeded)).catch(() => undefined)
      return { fs: seeded, file: pickFile(seeded), root: library.root }
    } catch (error) {
      console.warn('[shredder] disk library unavailable, using local storage:', error)
    }
  }
  const fs = loadLocalFS()
  return { fs, file: pickFile(fs), root: null }
}

export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
