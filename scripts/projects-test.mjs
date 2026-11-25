// Exercises electron/projects.cjs without Electron: a fake app/dialog counts as
// the user picking files, and the temp folder stands in for Documents.
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerProjects } from '../electron/projects.cjs'

const documents = await fsp.mkdtemp(path.join(os.tmpdir(), 'shredder-projects-'))
const externalDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shredder-external-'))
const handlers = new Map()
const revealed = []
let openResult = { canceled: true, filePaths: [] }
let saveResult = { canceled: true }

const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
const dialog = {
  showOpenDialog: async () => openResult,
  showSaveDialog: async () => saveResult,
}
const shell = { showItemInFolder: (target) => revealed.push(target) }

registerProjects({
  ipcMain,
  app: { getPath: (name) => (name === 'documents' ? documents : documents) },
  dialog,
  shell,
  getWindow: () => undefined,
})

const call = (channel, ...args) => handlers.get(channel)(null, ...args)
const doc = (name) => ({
  format: 'shredder',
  version: 1,
  name,
  objects: [],
  camera: { position: [0, 0, 1], target: [0, 0, 0] },
  createdAt: 1,
  updatedAt: 1,
})
const readJson = (target) => fsp.readFile(target, 'utf8').then((text) => JSON.parse(text))

try {
  const root = await call('projects:root')
  assert.equal(root, path.join(documents, 'Shredder'))

  const empty = await call('projects:load')
  assert.deepEqual(empty.files, [])
  assert.equal(empty.root, root)

  const folders = [
    { id: 'folder-characters', name: 'Characters', parentId: null },
    { id: 'folder-drafts', name: 'Drafts', parentId: null },
  ]
  const player = {
    id: 'file-player',
    name: 'Player.blend',
    folderId: 'folder-characters',
    createdAt: 1,
    updatedAt: 1,
    doc: doc('Player.blend'),
  }
  const blockout = {
    id: 'file-blockout',
    name: 'Blockout.blend',
    folderId: 'folder-drafts',
    createdAt: 1,
    updatedAt: 1,
    doc: doc('Blockout.blend'),
  }
  await call('projects:save', {
    version: 1,
    folders,
    files: [player, blockout],
    activeFileId: 'file-player',
    activeFolderId: 'folder-characters',
  })

  const playerPath = path.join(root, 'Characters', 'Player.blend')
  const blockoutPath = path.join(root, 'Drafts', 'Blockout.blend')
  assert.equal((await readJson(playerPath)).name, 'Player.blend')
  assert.equal((await readJson(blockoutPath)).name, 'Blockout.blend')
  const index = await readJson(path.join(root, 'library.json'))
  assert.equal(index.files.length, 2)
  assert.equal('doc' in index.files[0], false, 'the index stores metadata, not documents')

  const loaded = await call('projects:load')
  assert.equal(loaded.files.length, 2)
  assert.equal(loaded.activeFileId, 'file-player')
  assert.equal(loaded.folders.length, 2)
  const loadedPlayer = loaded.files.find((file) => file.id === 'file-player')
  assert.equal(loadedPlayer.doc.name, 'Player.blend')
  assert.equal(loadedPlayer.externalPath, undefined)

  // Unchanged documents are not rewritten by autosave.
  const before = (await fsp.stat(playerPath)).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 25))
  await call('projects:save', {
    version: 1,
    folders,
    files: [player, blockout],
    activeFileId: 'file-player',
    activeFolderId: 'folder-characters',
  })
  assert.equal((await fsp.stat(playerPath)).mtimeMs, before, 'unchanged projects skip the write')

  // Rename + move: the old managed copy is removed.
  const renamed = {
    ...player,
    name: 'Hero.blend',
    folderId: null,
    doc: doc('Hero.blend'),
  }
  await call('projects:save', {
    version: 1,
    folders,
    files: [renamed, blockout],
    activeFileId: 'file-player',
    activeFolderId: null,
  })
  await assert.rejects(fsp.stat(playerPath))
  assert.equal((await readJson(path.join(root, 'Hero.blend'))).name, 'Hero.blend')

  // Delete: removed from the library, removed from disk.
  await call('projects:save', {
    version: 1,
    folders,
    files: [renamed],
    activeFileId: 'file-player',
    activeFolderId: null,
  })
  await assert.rejects(fsp.stat(blockoutPath))

  // Save As writes where the native dialog points.
  const chosenPath = path.join(externalDir, 'Shared.blend')
  saveResult = { canceled: false, filePath: chosenPath }
  const saved = await call('projects:save-as', {
    suggestedName: 'Hero.blend',
    content: JSON.stringify(doc('Shared.blend'), null, 2),
  })
  assert.deepEqual(saved, { path: chosenPath, name: 'Shared.blend' })
  assert.equal((await readJson(chosenPath)).name, 'Shared.blend')

  // An external project joins the library and is written in place.
  const external = {
    id: 'file-external',
    name: 'Shared.blend',
    folderId: null,
    externalPath: chosenPath,
    createdAt: 2,
    updatedAt: 2,
    doc: { ...doc('Shared.blend'), updatedAt: 2 },
  }
  await call('projects:save', {
    version: 1,
    folders,
    files: [renamed, external],
    activeFileId: 'file-external',
    activeFolderId: null,
  })
  assert.equal((await readJson(chosenPath)).updatedAt, 2)
  assert.ok((await fsp.stat(path.join(root, 'Hero.blend'))).isFile())

  // Removing an external project from the library leaves the user's file alone.
  await call('projects:save', {
    version: 1,
    folders,
    files: [renamed],
    activeFileId: 'file-player',
    activeFolderId: null,
  })
  assert.equal((await readJson(chosenPath)).name, 'Shared.blend')

  // Reading a tracked library file reports its id so callers reopen it once.
  const tracked = await call('projects:read', path.join(root, 'Hero.blend'))
  assert.equal(tracked.id, 'file-player')
  assert.equal(tracked.doc.name, 'Hero.blend')

  // The native Open dialog reads the project back.
  openResult = { canceled: false, filePaths: [chosenPath] }
  const opened = await call('projects:open-dialog')
  assert.equal(opened.name, 'Shared.blend')
  assert.equal(opened.doc.format, 'shredder')
  assert.equal(opened.path, chosenPath)
  openResult = { canceled: true, filePaths: [] }
  assert.equal(await call('projects:open-dialog'), null)

  // A JSON file that is not a Shredder project is refused.
  const foreign = path.join(externalDir, 'other.json')
  await fsp.writeFile(foreign, JSON.stringify({ hello: 'world' }))
  await assert.rejects(call('projects:read', foreign), /Not a Shredder project file/)

  await call('projects:reveal', chosenPath)
  assert.deepEqual(revealed, [chosenPath])

  console.log('projects-test: 24 assertions passed (disk library, rename/delete, external paths, dialogs)')
} finally {
  await fsp.rm(documents, { recursive: true, force: true })
  await fsp.rm(externalDir, { recursive: true, force: true })
}
