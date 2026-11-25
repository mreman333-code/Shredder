// Renderer store with a fake desktop host: proves projects are seeded to disk,
// autosaved with the current document, and fall back to localStorage in a browser.
import assert from 'node:assert/strict'
import { loadInitialStore, saveStore, flushStore } from '../src/blend/storage.ts'

const root = 'C:\\Users\\test\\Documents\\Shredder'
const library = { folders: [], files: [] }
const saves = []
let rootCalls = 0

const host = {
  projects: {
    root: async () => root,
    load: async () => {
      rootCalls += 1
      return {
        root,
        folders: library.folders,
        files: library.files,
        activeFileId: null,
        activeFolderId: null,
      }
    },
    save: async (payload) => {
      saves.push(structuredClone(payload))
      library.folders = payload.folders
      library.files = payload.files
      return { root }
    },
    openDialog: async () => null,
    saveAs: async () => null,
    exportFile: async () => null,
    read: async () => {
      throw new Error('missing')
    },
    reveal: async () => {},
  },
}

const localStorage = (() => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
})()

globalThis.window = { shredderHost: host, localStorage, setTimeout, clearTimeout }

try {
  // First desktop launch imports projects left in the old browser store.
  const legacyDoc = {
    format: 'shredder',
    version: 1,
    name: 'Migrated.blend',
    objects: [],
    camera: { position: [0, 0, 1], target: [0, 0, 0] },
    createdAt: 1,
    updatedAt: 2,
  }
  localStorage.setItem(
    'shredder.fs.v1',
    JSON.stringify({
      version: 1,
      folders: [{ id: 'legacy-folder', name: 'Characters', parentId: null }],
      files: [
        {
          id: 'legacy-file',
          name: 'Migrated.blend',
          folderId: 'legacy-folder',
          doc: legacyDoc,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeFileId: 'legacy-file',
      activeFolderId: 'legacy-folder',
    }),
  )
  const migrated = await loadInitialStore()
  assert.equal(migrated.fs.files.length, 1, 'browser projects migrate instead of being replaced')
  assert.equal(migrated.file.name, 'Migrated.blend')
  assert.equal(migrated.root, root)
  assert.equal(saves.length, 1)
  assert.equal(saves[0].files[0].doc.name, 'Migrated.blend')
  assert.equal(saves[0].folders[0].name, 'Characters')

  // With no browser projects and no library, the examples are written as real files.
  localStorage.removeItem('shredder.fs.v1')
  library.folders = []
  library.files = []
  saves.length = 0
  const first = await loadInitialStore()
  assert.equal(first.root, root)
  assert.equal(first.fs.files.length, 4)
  assert.deepEqual(
    first.fs.files.map((file) => file.name).sort(),
    ['Blockout.blend', 'Player.blend', 'Runner.blend', 'Vanguard.blend'],
  )
  assert.equal(first.file.name, 'Player.blend')
  assert.equal(first.fs.activeFileId, first.file.id, 'the loaded active file is selected')
  assert.equal(saves.length, 1, 'seeding writes the library immediately')
  assert.equal(saves[0].files.length, 4)
  assert.ok(saves[0].files.every((file) => file.doc.format === 'shredder'))
  assert.equal(saves[0].files[0].externalPath, undefined)
  assert.ok(saves[0].folders.some((folder) => folder.name === 'Characters'))

  // Autosave carries the edited document, debounced.
  const target = first.fs.files[0]
  const editedDoc = { ...target.doc, objects: [], updatedAt: target.doc.updatedAt + 5000 }
  const editedFs = {
    ...first.fs,
    files: first.fs.files.map((file) =>
      file.id === target.id ? { ...file, doc: editedDoc, updatedAt: editedDoc.updatedAt } : file,
    ),
  }
  saveStore(editedFs)
  await new Promise((resolve) => setTimeout(resolve, 450))
  assert.equal(saves.length, 2, 'one debounced save')
  const savedDoc = saves[1].files.find((file) => file.id === target.id).doc
  assert.equal(savedDoc.updatedAt, editedDoc.updatedAt)
  assert.equal(savedDoc.objects.length, 0)

  // An immediate flush writes any pending state (used by Save and AI save_file).
  saveStore({ ...editedFs, activeFolderId: editedFs.folders[0]?.id ?? null })
  await flushStore()
  assert.equal(saves.length, 3, 'flush waits for the write')
  assert.equal(saves[2].activeFolderId, editedFs.folders[0]?.id ?? null)

  // Reopening the app reads the library instead of reseeding.
  const before = rootCalls
  const second = await loadInitialStore()
  assert.equal(rootCalls, before + 1)
  assert.equal(second.fs.files.length, 4)
  assert.equal(saves.length, 3, 'an existing library is not rewritten on load')
  assert.equal(second.file.id, target.id, 'the active file comes from the saved library')
  assert.equal(second.root, root)

  // External projects keep their absolute path through a save/load round trip.
  const external = {
    ...second.fs.files[0],
    externalPath: 'D:\\Projects\\Shared.blend',
  }
  saveStore({ ...second.fs, files: [external, ...second.fs.files.slice(1)] })
  await flushStore()
  const externalMeta = saves.at(-1).files.find((file) => file.id === external.id)
  assert.equal(externalMeta.externalPath, 'D:\\Projects\\Shared.blend')
  library.files = saves.at(-1).files
  const third = await loadInitialStore()
  assert.equal(
    third.fs.files.find((file) => file.id === external.id).externalPath,
    'D:\\Projects\\Shared.blend',
  )

  // Browser preview: no desktop host, localStorage still boots the app.
  delete globalThis.window.shredderHost
  const preview = await loadInitialStore()
  assert.equal(preview.root, null)
  assert.equal(preview.fs.files.length, 4)
  assert.equal(preview.fs.files[0].name, 'Player.blend')
  assert.ok(localStorage.getItem('shredder.fs.v1'), 'preview projects go to localStorage')

  console.log('storage-test: 20 assertions passed (disk seeding, autosave, external paths, fallback)')
} finally {
  delete globalThis.window
}
