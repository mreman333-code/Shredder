import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHARACTER_PRESETS,
  PRIMITIVES,
  addPrimitive,
  cloneSpec,
  createCharacter,
  descendantIds,
  newProject,
  nextSpot,
  normalizeProject,
  objectBounds,
  presetSpec,
  regenerateCharacter,
  uid,
  uniqueName,
  type CharacterColors,
  type CharacterSpec,
  type PartAdjustment,
  type PartImage,
  type PrimitiveKind,
  type ProjectDoc,
  type SceneObject,
  type Vec3,
} from './blend/doc'
import {
  MAX_ANIMATION_CLIPS,
  MAX_ANIMATION_DURATION,
  emptyClip,
  insertKeys,
  removeTrack,
  uniqueClipName,
  type AnimationClipData,
  type KeyEntry,
} from './blend/animation'
import {
  downloadFile,
  flushStore,
  saveStore,
  uniqueFileName,
  uniqueFolderName,
  type FSFile,
  type InitialStore,
  type VFS,
} from './blend/storage'
import { base64ToArrayBuffer, bytesToBase64, decodeMesh, packMesh, type MeshAsset } from './blend/mesh'
import type { SculptBrushId, SculptSymmetry } from './blend/sculpt'
import type { PaintTool } from './blend/paint'
import { PICTURE_ACCEPT, isPictureFile, readPicture } from './blend/pictures'
import { importModel, MODEL_ACCEPT } from './three/modelImport'
import { buildSculptAsset } from './three/sculptBuild'
import {
  ANIMATION_ACCEPT,
  importAnimationFile,
  isAnimationOnlyFile,
} from './three/animationImport'
import { summarizeAiResult, type AiLogEntry, type AiSessionView } from './ai'
import { AiPanel } from './components/AiPanel'
import { AnimationPanel } from './components/AnimationPanel'
import { CharacterPanel } from './components/CharacterPanel'
import { FileBrowser } from './components/FileBrowser'
import { HelpChat } from './components/HelpChat'
import {
  IconCharacter,
  IconChat,
  IconDownload,
  IconFolder,
  IconFrame,
  IconMove,
  IconPlus,
  IconRedo,
  IconRotate,
  IconSave,
  IconScale,
  IconSelect,
  IconUndo,
} from './components/Icons'
import { Menu, type MenuEntry } from './components/Menu'
import { Outliner } from './components/Outliner'
import { PaintPanel } from './components/PaintPanel'
import { Properties } from './components/Properties'
import { SculptPanel } from './components/SculptPanel'
import { StartCard } from './components/StartCard'
import { Viewport } from './components/Viewport'
import {
  SceneManager,
  type ShadingMode,
  type ToolMode,
  type ViewName,
} from './three/SceneManager'

type Mode = 'object' | 'pose' | 'sculpt' | 'paint'

const VIEW_LABELS: Record<ViewName, string> = {
  user: 'User Perspective',
  front: 'Front View',
  back: 'Back View',
  left: 'Left View',
  right: 'Right View',
  top: 'Top View',
}

function topLevelOf(object: SceneObject, doc: ProjectDoc): SceneObject {
  let current = object
  const seen = new Set<string>()
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = doc.objects.find((o) => o.id === current.parentId)
    if (!parent) break
    current = parent
  }
  return current
}

type AiSessionRecord = AiSessionView & { snapshot: ProjectDoc }

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function App({ initial }: { initial: InitialStore }) {
  const [bootstrap] = useState(() => {
    const loaded = initial.fs
    const file = loaded.files.find((f) => f.id === loaded.activeFileId) ?? loaded.files[0] ?? null
    return { fs: loaded, file }
  })

  const [fs, setFs] = useState<VFS>(bootstrap.fs)
  const [activeFileId, setActiveFileId] = useState<string | null>(bootstrap.file?.id ?? null)
  const [doc, setDoc] = useState<ProjectDoc>(() => bootstrap.file?.doc ?? newProject('Untitled.blend'))
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('object')
  const [tool, setTool] = useState<ToolMode>('translate')
  const [snap, setSnap] = useState(false)
  const [shading, setShading] = useState<ShadingMode>('solid')
  const [showBones, setShowBones] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<
    'outliner' | 'properties' | 'character' | 'animation' | 'sculpt' | 'paint' | 'ai' | 'help'
  >('outliner')
  const [filesOpen, setFilesOpen] = useState(false)
  const [view, setView] = useState<ViewName>('user')
  const [loadToken, setLoadToken] = useState(0)
  const [draftSpec, setDraftSpec] = useState<CharacterSpec>(() => presetSpec('Hero'))
  const [toast, setToast] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiBridgeStatus | null>(null)
  const [aiLog, setAiLog] = useState<AiLogEntry[]>([])
  const [aiSessions, setAiSessions] = useState<AiSessionView[]>([])
  const [aiPaused, setAiPaused] = useState(false)
  const [helpSeed, setHelpSeed] = useState<{ id: string; question?: string } | null>(null)
  const [startDismissed, setStartDismissed] = useState(false)
  // Narrow screens show the sidebar as a bottom sheet instead of a column.
  const [panelsOpen, setPanelsOpen] = useState(false)
  const [animClipId, setAnimClipId] = useState<string | null>(null)
  const [animPlaying, setAnimPlaying] = useState(false)
  const [animTime, setAnimTime] = useState(0)
  const [animSpeed, setAnimSpeed] = useState(1)
  const [animLoop, setAnimLoop] = useState(true)
  const [animSeek, setAnimSeek] = useState({ time: 0, token: 0 })
  const [animMatch, setAnimMatch] = useState<{ bound: number; total: number } | null>(null)
  const [sculptBrush, setSculptBrush] = useState<SculptBrushId>('draw')
  const [sculptRadius, setSculptRadius] = useState(0.12)
  const [sculptStrength, setSculptStrength] = useState(0.5)
  const [sculptSymmetry, setSculptSymmetry] = useState<SculptSymmetry>({
    enabled: true,
    x: true,
    y: false,
    z: false,
  })
  // On-screen stand-ins for holding Shift (smooth) or Ctrl (invert) while sculpting.
  const [sculptSmooth, setSculptSmooth] = useState(false)
  const [sculptInvert, setSculptInvert] = useState(false)

  // Painting: select a connected surface part, fill it, or paint with a brush.
  const [paintTool, setPaintTool] = useState<PaintTool>('part')
  const [paintColor, setPaintColor] = useState('#e0703c')
  const [paintRadius, setPaintRadius] = useState(0.12)
  const [paintStrength, setPaintStrength] = useState(0.6)
  const [paintPart, setPaintPart] = useState<{
    id: string
    index: number
    count: number
    triangles: number
  } | null>(null)
  const [paintPartList, setPaintPartList] = useState<
    Array<{ index: number; triangles: number }>
  >([])

  const fsRef = useRef(fs)
  fsRef.current = fs
  const docRef = useRef(doc)
  docRef.current = doc
  const activeFileIdRef = useRef(activeFileId)
  activeFileIdRef.current = activeFileId
  const selectionIdRef = useRef(selectionId)
  selectionIdRef.current = selectionId
  const modeRef = useRef(mode)
  modeRef.current = mode
  const aiLogRef = useRef<AiLogEntry[]>([])
  const aiSessionsRef = useRef(new Map<string, AiSessionRecord>())
  const viewportRef = useRef<SceneManager | null>(null)
  // Opening a file happens before the model importer is defined, so the
  // importer is reached through a ref that is filled during render.
  const addModelRef = useRef<
    ((name: string, buffer: ArrayBuffer) => Promise<unknown>) | null
  >(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const animTimeRef = useRef(0)
  // The window drop router is registered before the import handler exists.
  const importAnimationRef = useRef<((file: File) => void) | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const animationInputRef = useRef<HTMLInputElement>(null)

  const historyRef = useRef<{ past: ProjectDoc[]; future: ProjectDoc[] }>({ past: [], future: [] })
  const coalesceRef = useRef<{ key: string; time: number } | null>(null)
  // A gizmo drag emits many updates; keep the whole drag in a single undo step.
  const dragRef = useRef(false)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  // The guide is read-only help; openHelp can pre-fill a question from a menu.
  const openHelp = useCallback((question?: string) => {
    setPanelsOpen(true)
    setSidebarTab('help')
    setHelpSeed({ id: uid('help'), question })
  }, [])

  // Footer status item: shows the loopback endpoint models can connect to and
  // copies it, so nobody has to dig through the console to find the bridge.
  const copyBridgeEndpoint = useCallback(() => {
    if (!aiStatus) return
    void navigator.clipboard.writeText(aiStatus.url).then(
      () => notify(`Copied bridge endpoint ${aiStatus.url}`),
      () => notify(`Bridge endpoint is ${aiStatus.url}`),
    )
  }, [aiStatus, notify])

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  const writeFs = useCallback((updater: (current: VFS) => VFS) => {
    const next = updater(fsRef.current)
    fsRef.current = next
    saveStore(next)
    setFs(next)
    return next
  }, [])

  const setDocument = useCallback((next: ProjectDoc) => {
    docRef.current = next
    setDoc(next)
  }, [])

  const flushCurrent = useCallback(() => {
    const id = activeFileIdRef.current
    if (!id) return
    const current = docRef.current
    writeFs((state) => ({
      ...state,
      files: state.files.map((file) =>
        file.id === id ? { ...file, doc: current, updatedAt: current.updatedAt } : file,
      ),
    }))
  }, [writeFs])

  useEffect(() => {
    if (!activeFileId) return
    const timer = window.setTimeout(() => {
      writeFs((state) => ({
        ...state,
        files: state.files.map((file) =>
          file.id === activeFileId ? { ...file, doc, updatedAt: doc.updatedAt } : file,
        ),
      }))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [doc, activeFileId, writeFs])

  useEffect(() => {
    const handler = () => {
      const id = activeFileIdRef.current
      if (!id) return
      const current = docRef.current
      saveStore({
        ...fsRef.current,
        files: fsRef.current.files.map((file) =>
          file.id === id ? { ...file, doc: current, updatedAt: current.updatedAt } : file,
        ),
      })
      void flushStore()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // The desktop shell asks for a final save before the window closes. Throwing
  // here reports a failed save, which keeps the window open.
  useEffect(() => {
    const bridge = window.shredderHost?.app
    if (!bridge) return
    return bridge.onSaveBeforeClose(async () => {
      flushCurrent()
      const saved = await flushStore()
      if (!saved) throw new Error('The project library could not be written')
    })
  }, [flushCurrent])

  const updateDoc = useCallback(
    (updater: (current: ProjectDoc) => ProjectDoc, options?: { coalesce?: string }) => {
      const previous = docRef.current
      const next = updater(previous)
      if (next === previous) return
      const now = Date.now()
      const last = coalesceRef.current
      const coalesce = options?.coalesce
      const continuingDrag = dragRef.current && coalesce && last?.key === coalesce
      if (
        !coalesce ||
        !last ||
        last.key !== coalesce ||
        (!continuingDrag && now - last.time > 700)
      ) {
        historyRef.current.past.push(previous)
        if (historyRef.current.past.length > 80) historyRef.current.past.shift()
        historyRef.current.future = []
      }
      coalesceRef.current = coalesce ? { key: coalesce, time: now } : null
      setDocument({ ...next, updatedAt: now })
    },
    [setDocument],
  )

  const undo = useCallback(() => {
    const entry = historyRef.current.past.pop()
    if (!entry) return
    historyRef.current.future.push(docRef.current)
    coalesceRef.current = null
    setDocument(entry)
    setSelectionId((id) => (id && entry.objects.some((o) => o.id === id) ? id : null))
    notify('Undo')
  }, [notify, setDocument])

  const redo = useCallback(() => {
    const entry = historyRef.current.future.pop()
    if (!entry) return
    historyRef.current.past.push(docRef.current)
    coalesceRef.current = null
    setDocument(entry)
    setSelectionId((id) => (id && entry.objects.some((o) => o.id === id) ? id : null))
    notify('Redo')
  }, [notify, setDocument])

  const selected = doc.objects.find((o) => o.id === selectionId) ?? null
  const selectedTop = selected ? topLevelOf(selected, doc) : null
  const editingCharacter = selectedTop?.character ? selectedTop : null
  const editingParts = editingCharacter
    ? doc.objects.filter((o) => o.parentId === editingCharacter.id)
    : []
  const editingPartId =
    selected && selected.kind !== 'group' && selected.parentId === editingCharacter?.id
      ? selected.id
      : null
  const transformId = selected ? selected.id : null
  // A group cannot be sculpted itself, so the panel shows its first part.
  const sculptTarget =
    selected && selected.kind !== 'group'
      ? selected
      : selected
        ? (doc.objects.find((o) => o.parentId === selected.id && o.kind !== 'group') ?? null)
        : null
  // Painting can target the surface that was clicked, which may not be the
  // outliner selection (a group, or another part of the model).
  const paintTarget = paintPart
    ? (doc.objects.find((o) => o.id === paintPart.id) ?? sculptTarget)
    : sculptTarget

  /**
   * Gives a part its own dense mesh the first time it is sculpted. Returns false
   * when the part cannot hold a brush (a group, or a skinned import).
   */
  const prepareSculptPart = useCallback(
    (id: string): boolean => {
      const target = docRef.current.objects.find((o) => o.id === id)
      if (!target || target.kind === 'group') return false
      if (target.sculpt) return true
      if (target.kind === 'mesh' && target.mesh?.bones?.length) {
        notify('That model is skinned; sculpt works on primitives and static meshes')
        return false
      }
      try {
        const asset = buildSculptAsset(target)
        updateDoc((state) => ({
          ...state,
          objects: state.objects.map((o) => (o.id === id ? { ...o, sculpt: asset } : o)),
        }))
        return true
      } catch (error) {
        notify(
          error instanceof Error ? error.message : 'Could not prepare that part for sculpting',
        )
        return false
      }
    },
    [notify, updateDoc],
  )

  const handlePick = useCallback(
    (id: string | null) => {
      if (!id) {
        setSelectionId(null)
        return
      }
      const current = docRef.current
      const picked = current.objects.find((o) => o.id === id)
      if (!picked) return
      setSelectionId(picked.id)
      // Clicking another part while sculpting or painting makes it paintable too.
      if (modeRef.current === 'sculpt' || modeRef.current === 'paint') {
        prepareSculptPart(picked.id)
      }
    },
    [prepareSculptPart],
  )

  const handleTransform = useCallback(
    (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => {
      updateDoc(
        (current) => ({
          ...current,
          objects: current.objects.map((o) =>
            o.id === id ? { ...o, position, rotation, scale } : o,
          ),
        }),
        { coalesce: `gizmo-${id}` },
      )
    },
    [updateDoc],
  )

  const handleTransformStart = useCallback(() => {
    dragRef.current = true
  }, [])

  const handleTransformEnd = useCallback(() => {
    dragRef.current = false
    coalesceRef.current = null
  }, [])

  const handleReady = useCallback((manager: SceneManager | null) => {
    viewportRef.current = manager
  }, [])

  const changeMode = useCallback(
    (next: Mode) => {
      if (next === 'sculpt') {
        const current = docRef.current
        let target = selectionIdRef.current
          ? (current.objects.find((o) => o.id === selectionIdRef.current) ?? null)
          : null
        if (target && target.kind === 'group') {
          const groupId = target.id
          target = current.objects.find((o) => o.parentId === groupId && o.kind !== 'group') ?? null
        }
        if (!target) {
          notify('Select a mesh first — sculpting works on one part at a time')
          return
        }
        const targetId = target.id
        if (target.kind === 'mesh' && target.mesh?.bones?.length) {
          notify('That model is skinned; sculpt works on primitives and static meshes')
          return
        }
        setSelectionId(targetId)
        setSidebarTab('sculpt')
        // The part becomes its own dense mesh on first use; the primitive shape
        // stays recoverable through the panel's reset.
        if (!target.sculpt && !prepareSculptPart(targetId)) return
        setMode('sculpt')
        return
      }
      if (next === 'paint') {
        const current = docRef.current
        const selectedId = selectionIdRef.current
        let target = selectedId
          ? (current.objects.find((o) => o.id === selectedId) ?? null)
          : null
        if (target && target.kind === 'group') {
          const groupId = target.id
          target =
            current.objects.find((o) => o.parentId === groupId && o.kind !== 'group') ?? null
        }
        if (!target) {
          notify('Select a mesh first — painting works on one part at a time')
          return
        }
        const targetId = target.id
        setSelectionId(targetId)
        setSidebarTab('paint')
        setPaintPart(null)
        // A primitive needs its own dense surface before it can hold colour.
        if (!target.sculpt && target.kind !== 'mesh' && !prepareSculptPart(targetId)) return
        setMode('paint')
        return
      }
      setMode(next)
    },
    [notify, prepareSculptPart],
  )

  // One stroke is one document change, so Ctrl+Z always undoes a whole stroke.
  const commitSculptStroke = useCallback(
    (id: string, positions: Float32Array, normals: Float32Array) => {
      const target = docRef.current.objects.find((o) => o.id === id)
      if (!target?.sculpt) return
      try {
        const decoded = decodeMesh(target.sculpt)
        const packed = packMesh({
          positions,
          normals,
          indices: decoded.indices,
          uvs: decoded.uvs,
        })
        const asset: MeshAsset = { ...target.sculpt, ...packed }
        updateDoc((state) => ({
          ...state,
          objects: state.objects.map((o) => (o.id === id ? { ...o, sculpt: asset } : o)),
        }))
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save that stroke')
      }
    },
    [notify, updateDoc],
  )

  const resetSculpt = useCallback(() => {
    const id = selectionIdRef.current
    const target = id ? docRef.current.objects.find((o) => o.id === id) : null
    if (!target?.sculpt) return
    updateDoc((state) => ({
      ...state,
      objects: state.objects.map((o) => {
        if (o.id !== id) return o
        const next = { ...o }
        delete next.sculpt
        // Painted colours belonged to the sculpted surface's vertices.
        delete next.paint
        return next
      }),
    }))
    notify(`${target.name}: original shape restored`)
  }, [notify, updateDoc])

  // One fill or one brush stroke is one undo step, like a sculpt stroke.
  const commitPaint = useCallback(
    (id: string, colors: Uint8Array) => {
      if (colors.length < 3) return
      const layer = { colors: bytesToBase64(colors), vertices: Math.floor(colors.length / 3) }
      updateDoc((state) => ({
        ...state,
        objects: state.objects.map((o) => (o.id === id ? { ...o, paint: layer } : o)),
      }))
    },
    [updateDoc],
  )

  const fillPaintPart = useCallback(() => {
    const filled = viewportRef.current?.fillPaint(paintColor) ?? 0
    if (filled === 0) {
      notify('Select a surface part in the viewport first')
      return
    }
    notify(`Filled ${filled.toLocaleString()} triangles`)
  }, [notify, paintColor])

  const clearPaint = useCallback(() => {
    const id = paintPart?.id ?? sculptTarget?.id
    if (!id) return
    updateDoc((state) => ({
      ...state,
      objects: state.objects.map((o) => {
        if (o.id !== id) return o
        const next = { ...o }
        delete next.paint
        return next
      }),
    }))
    notify('Paint removed')
  }, [notify, paintPart, sculptTarget, updateDoc])

  // A different tool, mode or selected part starts with no surface selected.
  useEffect(() => {
    if (mode !== 'paint') return
    setPaintPart((current) => (current && current.id === selectionId ? current : null))
    viewportRef.current?.clearPaintSelection()
  }, [paintTool, mode, selectionId])

  // The Paint panel lists every connected surface of the current part, so a
  // piece hidden behind the model can be picked without orbiting to it.
  useEffect(() => {
    if (mode !== 'paint') {
      setPaintPartList([])
      return
    }
    const manager = viewportRef.current
    setPaintPartList(manager ? manager.paintPartList(paintTarget?.id ?? null) : [])
  }, [mode, paintTarget?.id, paintTarget?.sculpt, paintTarget?.mesh])

  const toggleMode = useCallback(() => {
    changeMode(modeRef.current === 'object' ? 'pose' : 'object')
  }, [changeMode])

  const selectObject = useCallback(
    (id: string) => {
      const current = docRef.current
      const obj = current.objects.find((o) => o.id === id)
      if (!obj) return
      setSelectionId(id)
      if (modeRef.current === 'sculpt' || modeRef.current === 'paint') prepareSculptPart(id)
    },
    [prepareSculptPart],
  )

  const deleteSelected = useCallback(() => {
    const id = selectionIdRef.current
    if (!id) return
    const current = docRef.current
    const target = current.objects.find((o) => o.id === id)
    if (!target) return
    const ids = new Set(descendantIds(current.objects, target.id))
    updateDoc((state) => ({ ...state, objects: state.objects.filter((o) => !ids.has(o.id)) }))
    setSelectionId(null)
    notify('Deleted')
  }, [notify, updateDoc])

  const duplicateSelected = useCallback(() => {
    const id = selectionIdRef.current
    if (!id) return
    const current = docRef.current
    const target = current.objects.find((o) => o.id === id)
    if (!target) return
    const root = target
    const ids = descendantIds(current.objects, root.id)
    const subset = current.objects.filter((o) => ids.includes(o.id))
    const idMap = new Map<string, string>()
    for (const o of subset) idMap.set(o.id, uid('obj'))
    const taken = [...current.objects]
    const clones: SceneObject[] = subset.map((o) => {
      const clone: SceneObject = {
        ...o,
        id: idMap.get(o.id)!,
        parentId: o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : o.parentId,
        position:
          o.id === root.id
            ? [o.position[0] + 0.6, o.position[1], o.position[2]]
            : [o.position[0], o.position[1], o.position[2]],
        rotation: [o.rotation[0], o.rotation[1], o.rotation[2]],
        scale: [o.scale[0], o.scale[1], o.scale[2]],
        character: o.character ? cloneSpec(o.character) : undefined,
      }
      if (o.id === root.id) {
        clone.name = uniqueName(taken, o.name)
        taken.push(clone)
      }
      return clone
    })
    updateDoc((state) => ({ ...state, objects: [...state.objects, ...clones] }))
    setSelectionId(idMap.get(root.id)!)
    notify('Duplicated')
  }, [notify, updateDoc])

  const addPrim = useCallback(
    (kind: PrimitiveKind) => {
      const result = addPrimitive(docRef.current, kind)
      updateDoc(() => result.doc)
      setSelectionId(result.object.id)
      setSidebarTab('properties')
      notify(`${result.object.name} added`)
    },
    [notify, updateDoc],
  )

  const addCharacter = useCallback(
    (spec: CharacterSpec) => {
      const current = docRef.current
      const spot = nextSpot(current)
      const { group, parts } = createCharacter(
        current,
        spec,
        spec.preset === 'Custom' ? 'Character' : spec.preset,
        spot,
      )
      updateDoc((state) => ({ ...state, objects: [...state.objects, group, ...parts] }))
      setSelectionId(group.id)
      setSidebarTab('character')
      notify(`${group.name} added`)
    },
    [notify, updateDoc],
  )

  const updateCharacter = useCallback(
    (groupId: string, spec: CharacterSpec) => {
      updateDoc(
        (current) => ({
          ...current,
          objects: regenerateCharacter(current.objects, groupId, spec),
        }),
        { coalesce: `char-${groupId}` },
      )
    },
    [updateDoc],
  )

  // Per-part size sliders: update the live part immediately and remember the
  // multiplier on the character spec, so preset/proportion changes keep it.
  const adjustCharacterParts = useCallback(
    (groupId: string, names: string[], adjustment: PartAdjustment, coalesce: string) => {
      updateDoc(
        (current) => {
          const group = current.objects.find((o) => o.id === groupId)
          if (!group?.character) return current
          const spec = cloneSpec(group.character)
          const adjustments = { ...(spec.adjustments ?? {}) }
          const wanted = new Set(names)
          const scale: Vec3 = [
            Math.min(3, Math.max(0.25, adjustment.scale[0])),
            Math.min(3, Math.max(0.25, adjustment.scale[1])),
            Math.min(3, Math.max(0.25, adjustment.scale[2])),
          ]
          let changed = false
          const objects = current.objects.map((obj) => {
            if (obj.parentId !== groupId || !wanted.has(obj.name)) return obj
            const previous = adjustments[obj.name]?.scale ?? [1, 1, 1]
            // Derive the preset size so a part that was nudged with the gizmo
            // keeps its extra size instead of jumping back.
            const base: Vec3 = [
              obj.scale[0] / previous[0],
              obj.scale[1] / previous[1],
              obj.scale[2] / previous[2],
            ]
            if (scale.every((entry) => Math.abs(entry - 1) < 0.001)) {
              delete adjustments[obj.name]
            } else {
              adjustments[obj.name] = { scale }
            }
            changed = true
            const nextScale: Vec3 = [
              base[0] * scale[0],
              base[1] * scale[1],
              base[2] * scale[2],
            ]
            return { ...obj, scale: nextScale }
          })
          if (!changed) return current
          if (Object.keys(adjustments).length > 0) spec.adjustments = adjustments
          else delete spec.adjustments
          return {
            ...current,
            objects: objects.map((obj) =>
              obj.id === groupId ? { ...obj, character: spec } : obj,
            ),
          }
        },
        { coalesce },
      )
    },
    [updateDoc],
  )

  const focusCharacterPart = useCallback((id: string) => {
    if (!docRef.current.objects.some((obj) => obj.id === id)) return
    setSelectionId(id)
    setMode('pose')
  }, [])

  // Pictures mapped onto body parts live on the spec, so they survive
  // regeneration, proportion changes, save/load and the GLB export.
  const setCharacterImages = useCallback(
    (groupId: string, names: string[], image: PartImage | null, coalesce?: string) => {
      updateDoc(
        (current) => {
          const group = current.objects.find((o) => o.id === groupId)
          if (!group?.character) return current
          const spec = cloneSpec(group.character)
          const images = { ...(spec.images ?? {}) }
          for (const name of names) {
            if (image) {
              images[name] = {
                url: image.url,
                size: Math.min(3, Math.max(0.25, image.size)),
                opacity: Math.min(1, Math.max(0.05, image.opacity)),
              }
            } else {
              delete images[name]
            }
          }
          if (Object.keys(images).length > 0) spec.images = images
          else delete spec.images
          return {
            ...current,
            objects: current.objects.map((obj) =>
              obj.id === groupId ? { ...obj, character: spec } : obj,
            ),
          }
        },
        {
          coalesce: coalesce
            ? `picture-${groupId}-${[...names].sort().join('|')}-${coalesce}`
            : undefined,
        },
      )
    },
    [updateDoc],
  )

  // A picture dropped on a body part in the viewport maps to that part;
  // dropping on the character itself (or on empty space with one character)
  // maps it to the face.
  const dropPicture = useCallback(
    async (file: File, objectId: string | null) => {
      let url: string
      try {
        url = await readPicture(file)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not read that picture')
        return
      }
      const current = docRef.current
      const picked = objectId ? current.objects.find((o) => o.id === objectId) : null
      let group: SceneObject | null = null
      let partName = 'Face'
      if (picked) {
        if (picked.kind === 'group') {
          if (picked.character) group = picked
        } else if (picked.parentId) {
          const parent = current.objects.find((o) => o.id === picked.parentId)
          if (parent?.character) {
            group = parent
            partName = picked.name
          }
        }
      }
      if (!group) {
        const selectedId = selectionIdRef.current
        const selection = selectedId
          ? current.objects.find((o) => o.id === selectedId)
          : null
        const top = selection ? topLevelOf(selection, current) : null
        if (top?.character) group = top
      }
      if (!group) {
        const characters = current.objects.filter((o) => o.character)
        if (characters.length === 1) group = characters[0]
      }
      if (!group?.character) {
        notify('Drop the picture onto a body part of a character')
        return
      }
      const part = current.objects.find(
        (o) => o.parentId === group.id && o.name === partName,
      )
      setCharacterImages(group.id, [partName], { url, size: 1, opacity: 1 })
      setSidebarTab('character')
      if (part) {
        setSelectionId(part.id)
        setMode('pose')
      }
      notify(`${file.name} mapped to ${partName}`)
    },
    [notify, setCharacterImages],
  )

  // A picture picked for a model mesh becomes its packed base-colour map, so
  // it renders in the viewport and travels with the project and GLB export.
  const setMeshImage = useCallback(
    (id: string, url: string | null) => {
      updateDoc((current) => ({
        ...current,
        objects: current.objects.map((obj) => {
          if (obj.id !== id || !obj.mesh) return obj
          const mesh = { ...obj.mesh }
          if (url) {
            mesh.baseColor = url
            mesh.baseColorFlipY = true
          } else {
            delete mesh.baseColor
            delete mesh.baseColorFlipY
          }
          if (mesh.materials?.length) {
            mesh.materials = mesh.materials.map((slot) => {
              const next = { ...slot }
              if (url) {
                next.baseColor = url
                next.baseColorFlipY = true
              } else {
                delete next.baseColor
                delete next.baseColorFlipY
              }
              return next
            })
          }
          return { ...obj, mesh }
        }),
      }))
    },
    [updateDoc],
  )

  /**
   * Maps a PNG/JPEG onto a selected model mesh, a whole single-mesh model, or
   * a character body part (the older picture-on-a-part path).
   */
  const applyPictureFile = useCallback(
    async (file: File, objectId: string | null) => {
      const current = docRef.current
      const targetId = objectId ?? selectionIdRef.current
      let target = targetId
        ? (current.objects.find((obj) => obj.id === targetId) ?? null)
        : null

      if (target?.kind === 'group' && !target.character) {
        const ids = new Set(descendantIds(current.objects, target.id))
        const meshes = current.objects.filter(
          (obj) => ids.has(obj.id) && obj.mesh?.hasUv,
        )
        if (meshes.length === 1) target = meshes[0]
        else if (meshes.length > 1) {
          notify('Select the one mesh part you want to put the image on')
          return
        }
      }

      if (target && target.kind !== 'group') {
        const parent = target.parentId
          ? current.objects.find((obj) => obj.id === target.parentId)
          : null
        // Character body parts use the Character panel's picture mapping.
        if (!parent?.character) {
          if (!target.mesh?.hasUv) {
            notify('That mesh has no UVs, so a picture cannot be mapped onto it')
            return
          }
          try {
            const url = await readPicture(file)
            setMeshImage(target.id, url)
            setSelectionId(target.id)
            setSidebarTab('properties')
            notify(`Image mapped to ${target.name}`)
          } catch (error) {
            notify(error instanceof Error ? error.message : 'Could not read that picture')
          }
          return
        }
      }

      await dropPicture(file, objectId)
    },
    [dropPicture, notify, setMeshImage],
  )

  const handleCharacterChange = useCallback(
    (spec: CharacterSpec) => {
      if (editingCharacter) updateCharacter(editingCharacter.id, spec)
      else setDraftSpec(spec)
    },
    [editingCharacter, updateCharacter],
  )

  const patchSelection = useCallback(
    (patch: Partial<SceneObject>, coalesce?: string) => {
      const id = selectionIdRef.current
      if (!id) return
      updateDoc(
        (current) => ({
          ...current,
          objects: current.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        }),
        { coalesce },
      )
    },
    [updateDoc],
  )

  const resetTransform = useCallback(() => {
    patchSelection({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
  }, [patchSelection])

  const toggleVisible = useCallback(
    (id: string) => {
      updateDoc((current) => ({
        ...current,
        objects: current.objects.map((o) =>
          o.id === id ? { ...o, visible: !o.visible } : o,
        ),
      }))
    },
    [updateDoc],
  )

  const renameObject = useCallback(
    (id: string, name: string) => {
      updateDoc((current) => ({
        ...current,
        objects: current.objects.map((o) => (o.id === id ? { ...o, name } : o)),
      }))
    },
    [updateDoc],
  )

  const openFile = useCallback(
    (fileId: string) => {
      flushCurrent()
      const file = fsRef.current.files.find((f) => f.id === fileId)
      if (!file) return
      historyRef.current = { past: [], future: [] }
      coalesceRef.current = null
      setDocument(file.doc)
      activeFileIdRef.current = file.id
      setActiveFileId(file.id)
      writeFs((state) => ({ ...state, activeFileId: file.id }))
      setSelectionId(null)
      setMode('object')
      setFilesOpen(false)
      setLoadToken((token) => token + 1)
      notify(`Opened ${file.name}`)
    },
    [flushCurrent, notify, setDocument, writeFs],
  )

  const createFile = useCallback(
    (folderId: string | null) => {
      flushCurrent()
      const name = uniqueFileName(fsRef.current, 'Untitled', folderId)
      const project = newProject(name)
      const now = Date.now()
      const file: FSFile = {
        id: uid('file'),
        name,
        folderId,
        doc: project,
        createdAt: now,
        updatedAt: now,
      }
      writeFs((state) => ({
        ...state,
        files: [...state.files, file],
        activeFileId: file.id,
        activeFolderId: folderId,
      }))
      historyRef.current = { past: [], future: [] }
      coalesceRef.current = null
      setDocument(project)
      activeFileIdRef.current = file.id
      setActiveFileId(file.id)
      setSelectionId(null)
      setMode('object')
      setFilesOpen(false)
      setLoadToken((token) => token + 1)
      notify(`Created ${name}`)
    },
    [flushCurrent, notify, setDocument, writeFs],
  )

  const save = useCallback(() => {
    const id = activeFileIdRef.current
    if (!id) return
    const camera = viewportRef.current?.getCamera() ?? docRef.current.camera
    const next = { ...docRef.current, camera, updatedAt: Date.now() }
    setDocument(next)
    writeFs((state) => ({
      ...state,
      files: state.files.map((file) =>
        file.id === id ? { ...file, doc: next, updatedAt: next.updatedAt } : file,
      ),
    }))
    void flushStore().then((ok) =>
      notify(ok ? `Saved ${next.name}` : 'Could not write the project file'),
    )
  }, [notify, setDocument, writeFs])

  const saveAs = useCallback(
    (name: string, folderId: string | null) => {
      flushCurrent()
      const fileName = uniqueFileName(fsRef.current, name, folderId)
      const now = Date.now()
      const camera = viewportRef.current?.getCamera() ?? docRef.current.camera
      const nextDoc: ProjectDoc = {
        ...docRef.current,
        name: fileName,
        camera,
        createdAt: now,
        updatedAt: now,
      }
      const file: FSFile = {
        id: uid('file'),
        name: fileName,
        folderId,
        doc: nextDoc,
        createdAt: now,
        updatedAt: now,
      }
      writeFs((state) => ({
        ...state,
        files: [...state.files, file],
        activeFileId: file.id,
        activeFolderId: folderId,
      }))
      historyRef.current = { past: [], future: [] }
      coalesceRef.current = null
      setDocument(nextDoc)
      activeFileIdRef.current = file.id
      setActiveFileId(file.id)
      setFilesOpen(false)
      setLoadToken((token) => token + 1)
      notify(`Saved copy: ${fileName}`)
    },
    [flushCurrent, notify, setDocument, writeFs],
  )

  const adoptProject = useCallback(
    (opened: DiskOpenedProject) => {
      const parsed = normalizeProject(opened.doc)
      if (!parsed) throw new Error('Not a Shredder project file')
      const tracked = opened.id
        ? fsRef.current.files.find((file) => file.id === opened.id)
        : undefined
      if (tracked) {
        openFile(tracked.id)
        return tracked.name
      }
      const existing = fsRef.current.files.find((file) => file.externalPath === opened.path)
      if (existing) {
        openFile(existing.id)
        return existing.name
      }
      flushCurrent()
      const now = Date.now()
      const name = uniqueFileName(
        fsRef.current,
        opened.name.replace(/\.(mblend|json)$/i, '.blend'),
        null,
      )
      const imported: ProjectDoc = { ...parsed, name, updatedAt: now }
      const entry: FSFile = {
        id: uid('file'),
        name,
        folderId: null,
        externalPath: opened.path,
        doc: imported,
        createdAt: now,
        updatedAt: now,
      }
      writeFs((state) => ({
        ...state,
        files: [...state.files, entry],
        activeFileId: entry.id,
      }))
      historyRef.current = { past: [], future: [] }
      coalesceRef.current = null
      setDocument(imported)
      activeFileIdRef.current = entry.id
      setActiveFileId(entry.id)
      setSelectionId(null)
      setFilesOpen(false)
      setLoadToken((token) => token + 1)
      return name
    },
    [flushCurrent, openFile, setDocument, writeFs],
  )

  const openProjectFromDisk = useCallback(async () => {
    const host = window.shredderHost
    if (!host?.projects) {
      importRef.current?.click()
      return
    }
    try {
      const opened = await host.projects.openDialog()
      if (!opened) return
      if (opened.model) {
        await addModelRef.current?.(
          opened.model.name,
          base64ToArrayBuffer(opened.model.base64),
        )
        return
      }
      notify(`Opened ${adoptProject(opened)} from disk`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open the project')
    }
  }, [adoptProject, notify])

  const saveProjectAs = useCallback(async () => {
    const camera = viewportRef.current?.getCamera() ?? docRef.current.camera
    const next = { ...docRef.current, camera, updatedAt: Date.now() }
    setDocument(next)
    const host = window.shredderHost
    const base = next.name.replace(/\.(blend|mblend)$/i, '')
    if (!host?.projects) {
      downloadFile(
        new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' }),
        `${base}.mblend`,
      )
      notify(`Exported ${base}.mblend`)
      return
    }
    try {
      const result = await host.projects.saveAs({
        suggestedName: next.name,
        content: JSON.stringify(next, null, 2),
      })
      if (!result) return
      flushCurrent()
      const name = result.name.replace(/\.(mblend|json)$/i, '.blend')
      const now = Date.now()
      const entry: FSFile = {
        id: uid('file'),
        name,
        folderId: null,
        externalPath: result.path,
        doc: { ...next, name, updatedAt: now },
        createdAt: now,
        updatedAt: now,
      }
      writeFs((state) => ({
        ...state,
        files: [...state.files, entry],
        activeFileId: entry.id,
      }))
      historyRef.current = { past: [], future: [] }
      coalesceRef.current = null
      setDocument(entry.doc)
      activeFileIdRef.current = entry.id
      setActiveFileId(entry.id)
      setSelectionId(null)
      setLoadToken((token) => token + 1)
      await flushStore()
      notify(`Saved ${name}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the project')
    }
  }, [flushCurrent, notify, setDocument, writeFs])

  const renameFile = useCallback(
    (id: string, newName: string) => {
      flushCurrent()
      const clean = newName.replace(/\.(blend|mblend)$/i, '').trim()
      if (!clean) return
      const fileName = `${clean}.blend`
      writeFs((state) => ({
        ...state,
        files: state.files.map((file) =>
          file.id === id
            ? { ...file, name: fileName, doc: { ...file.doc, name: fileName } }
            : file,
        ),
      }))
      if (activeFileIdRef.current === id) {
        setDocument({ ...docRef.current, name: fileName })
      }
      notify('File renamed')
    },
    [flushCurrent, notify, setDocument, writeFs],
  )

  const deleteFile = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this project file? This cannot be undone.')) return
      flushCurrent()
      const wasActive = activeFileIdRef.current === id
      writeFs((state) => ({
        ...state,
        files: state.files.filter((file) => file.id !== id),
      }))
      if (wasActive) {
        const remaining = fsRef.current.files
        if (remaining.length > 0) openFile(remaining[0].id)
        else createFile(null)
      }
      notify('File deleted')
    },
    [createFile, flushCurrent, notify, openFile, writeFs],
  )

  const createFolder = useCallback(() => {
    const folder = {
      id: uid('folder'),
      name: uniqueFolderName(fsRef.current.folders, 'New Folder'),
      parentId: null,
    }
    writeFs((state) => ({
      ...state,
      folders: [...state.folders, folder],
      activeFolderId: folder.id,
    }))
    notify('Folder created')
  }, [notify, writeFs])

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const clean = name.trim()
      if (!clean) return
      writeFs((state) => ({
        ...state,
        folders: state.folders.map((folder) =>
          folder.id === id ? { ...folder, name: clean } : folder,
        ),
      }))
    },
    [writeFs],
  )

  const deleteFolder = useCallback(
    (id: string) => {
      const folder = fsRef.current.folders.find((f) => f.id === id)
      if (!folder) return
      if (!window.confirm(`Delete folder "${folder.name}"? Files inside move to Root.`)) return
      flushCurrent()
      writeFs((state) => ({
        ...state,
        folders: state.folders.filter((f) => f.id !== id),
        files: state.files.map((file) =>
          file.folderId === id ? { ...file, folderId: null } : file,
        ),
        activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
      }))
      notify('Folder deleted')
    },
    [flushCurrent, notify, writeFs],
  )

  // Imports a model file into the open project: one wrapper group for the
  // model, its node hierarchy as groups, and its meshes as editable objects.
  const addModel = useCallback(
    async (name: string, buffer: ArrayBuffer) => {
      const result = await importModel(buffer, name)
      const current = docRef.current
      const rootObject = result.objects.find((o) => o.id === result.rootId)
      if (!rootObject) throw new Error('The model produced no root object')
      const spot = nextSpot(current)
      rootObject.name = uniqueName(current.objects, rootObject.name)
      rootObject.position = [
        rootObject.position[0] + spot[0],
        rootObject.position[1],
        rootObject.position[2] + spot[2],
      ]
      updateDoc((state) => ({ ...state, objects: [...state.objects, ...result.objects] }))
      setSelectionId(result.rootId)
      setSidebarTab('properties')
      const summary = result.summary
      notify(
        `Imported ${rootObject.name}: ${summary.meshes} mesh${summary.meshes === 1 ? '' : 'es'}, ` +
          `${summary.triangles.toLocaleString()} tris` +
          (summary.bones > 0 ? `, ${summary.bones} bones` : ''),
      )
      window.setTimeout(() => viewportRef.current?.frameSelection(result.rootId), 80)
      return {
        name: rootObject.name,
        format: summary.format,
        meshes: summary.meshes,
        triangles: summary.triangles,
        bones: summary.bones,
        unitScale: summary.unitScale,
      }
    },
    [notify, updateDoc],
  )
  addModelRef.current = addModel

  const openModelFromDisk = useCallback(async () => {
    const host = window.shredderHost
    if (!host?.models) {
      importRef.current?.click()
      return
    }
    try {
      const model = await host.models.openDialog()
      if (!model) return
      await addModel(model.name, base64ToArrayBuffer(model.base64))
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import the model')
    }
  }, [addModel, notify])

  const importFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer()
        const text = new TextDecoder().decode(buffer)
        // Project files are JSON; anything else is model geometry.
        const parsed = text.trimStart().startsWith('{') ? normalizeProject(JSON.parse(text)) : null
        if (!parsed) {
          await addModel(file.name, buffer)
          return
        }
        flushCurrent()
        const folderId = fsRef.current.activeFolderId
        const fileName = uniqueFileName(
          fsRef.current,
          file.name.replace(/\.(blend|mblend|json)$/i, ''),
          folderId,
        )
        const now = Date.now()
        const imported: ProjectDoc = { ...parsed, name: fileName, updatedAt: now }
        const entry: FSFile = {
          id: uid('file'),
          name: fileName,
          folderId,
          doc: imported,
          createdAt: now,
          updatedAt: now,
        }
        writeFs((state) => ({
          ...state,
          files: [...state.files, entry],
          activeFileId: entry.id,
        }))
        historyRef.current = { past: [], future: [] }
        coalesceRef.current = null
        setDocument(imported)
        activeFileIdRef.current = entry.id
        setActiveFileId(entry.id)
        setSelectionId(null)
        setFilesOpen(false)
        setLoadToken((token) => token + 1)
        notify(`Imported ${fileName}`)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Import failed')
      }
    },
    [addModel, flushCurrent, notify, setDocument, writeFs],
  )

  // A file dropped anywhere in the window must never open in place of the app
  // (that is the browser's default and it replaces the whole screen). Models and
  // project files are imported; a picture is mapped onto the body part under
  // the cursor, exactly like a drop on the viewport.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types.includes('Files'))

    const handleDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      // Animation-only files have nowhere else to go, so they open the clip tab.
      if (isAnimationOnlyFile(file.name)) {
        importAnimationRef.current?.(file)
        return
      }
      if (isPictureFile(file)) {
        const objectId = viewportRef.current?.pickAt(event.clientX, event.clientY) ?? null
        void applyPictureFile(file, objectId)
        return
      }
      void importFile(file)
    }

    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [applyPictureFile, importFile])

  const exportProject = useCallback(async () => {
    const camera = viewportRef.current?.getCamera() ?? docRef.current.camera
    const next = { ...docRef.current, camera }
    const base = next.name.replace(/\.(blend|mblend)$/i, '')
    const content = JSON.stringify(next, null, 2)
    const host = window.shredderHost
    if (host?.projects) {
      try {
        const result = await host.projects.exportFile({
          suggestedName: `${base}.mblend`,
          content,
          extension: 'mblend',
          label: 'Export Shredder project',
        })
        if (result) notify(`Exported ${result.path}`)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Export failed')
      }
      return
    }
    downloadFile(new Blob([content], { type: 'application/json' }), `${base}.mblend`)
    notify(`Exported ${base}.mblend`)
  }, [notify])

  const exportGlb = useCallback(async () => {
    try {
      const manager = viewportRef.current
      if (!manager) return
      const blob = await manager.exportGLB()
      const base = docRef.current.name.replace(/\.(blend|mblend)$/i, '')
      const host = window.shredderHost
      if (host?.projects) {
        const result = await host.projects.exportFile({
          suggestedName: `${base}.glb`,
          base64: await blobToBase64(blob),
          extension: 'glb',
          label: 'Export glTF binary',
        })
        if (result) notify(`Exported ${result.path}`)
        return
      }
      downloadFile(blob, `${base}.glb`)
      notify(`Exported ${base}.glb`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed')
    }
  }, [notify])

  // ------------------------------------------------------------- animation
  const setClipEditor = useCallback(
    (updater: (clip: AnimationClipData) => AnimationClipData) => {
      const id = animClipId
      if (!id) return
      updateDoc((current) => ({
        ...current,
        animations: (current.animations ?? []).map((clip) =>
          clip.id === id ? updater(clip) : clip,
        ),
      }))
    },
    [animClipId, updateDoc],
  )

  const seekAnimation = useCallback((time: number) => {
    const clamped = Math.max(0, time)
    animTimeRef.current = clamped
    setAnimTime(clamped)
    setAnimSeek((previous) => ({ time: clamped, token: previous.token + 1 }))
  }, [])

  const selectAnimationClip = useCallback(
    (id: string | null) => {
      setAnimClipId(id)
      setAnimPlaying(false)
      setAnimMatch(null)
      seekAnimation(0)
    },
    [seekAnimation],
  )

  const createAnimationClip = useCallback(() => {
    const current = docRef.current
    const existing = current.animations ?? []
    if (existing.length >= MAX_ANIMATION_CLIPS) {
      notify(`A project holds up to ${MAX_ANIMATION_CLIPS} clips`)
      return
    }
    const selection = selectionIdRef.current
      ? (current.objects.find((object) => object.id === selectionIdRef.current) ?? null)
      : null
    const top = selection ? topLevelOf(selection, current) : null
    const name = uniqueClipName(existing, 'Action')
    const clip = emptyClip(uid('clip'), name, top?.id, 2)
    updateDoc((state) => ({ ...state, animations: [...(state.animations ?? []), clip] }))
    setAnimClipId(clip.id)
    setAnimPlaying(false)
    seekAnimation(0)
    notify(`${name} created`)
  }, [notify, seekAnimation, updateDoc])

  const renameAnimationClip = useCallback(
    (id: string, name: string) => {
      const clean = name.trim()
      if (!clean) return
      updateDoc((state) => ({
        ...state,
        animations: (state.animations ?? []).map((clip) =>
          clip.id === id ? { ...clip, name: clean } : clip,
        ),
      }))
    },
    [updateDoc],
  )

  const deleteAnimationClip = useCallback(
    (id: string) => {
      updateDoc((state) => ({
        ...state,
        animations: (state.animations ?? []).filter((clip) => clip.id !== id),
      }))
      setAnimClipId((current) => (current === id ? null : current))
      setAnimPlaying(false)
      notify('Clip deleted')
    },
    [notify, updateDoc],
  )

  const setAnimationDuration = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds)) return
      setClipEditor((clip) => ({
        ...clip,
        duration: Math.min(MAX_ANIMATION_DURATION, Math.max(0.1, seconds)),
      }))
    },
    [setClipEditor],
  )

  const bindAnimationClip = useCallback(
    (targetId: string | null) => {
      setClipEditor((clip) => {
        const next = { ...clip }
        if (targetId) next.targetId = targetId
        else delete next.targetId
        return next
      })
    },
    [setClipEditor],
  )

  const deleteAnimationTrack = useCallback(
    (target: string) => {
      setClipEditor((clip) => removeTrack(clip, target))
    },
    [setClipEditor],
  )

  // Writes the current transform of the selected object (or of every part of a
  // character) as a key at the playhead, like inserting a keyframe per bone.
  const addAnimationKeys = useCallback(
    (scope: 'selection' | 'character') => {
      const id = animClipId
      if (!id) {
        notify('Pick or create a clip first')
        return
      }
      const current = docRef.current
      const clip = current.animations?.find((entry) => entry.id === id)
      if (!clip) return
      const time = animTimeRef.current
      const selection = selectionIdRef.current
        ? (current.objects.find((object) => object.id === selectionIdRef.current) ?? null)
        : null
      const top = selection ? topLevelOf(selection, current) : null
      const poseOf = (object: SceneObject) => ({
        position: [object.position[0], object.position[1], object.position[2]] as Vec3,
        rotation: [object.rotation[0], object.rotation[1], object.rotation[2]] as Vec3,
        scale: [object.scale[0], object.scale[1], object.scale[2]] as Vec3,
      })
      const entries: KeyEntry[] = []
      if (scope === 'character') {
        const group = top?.character
          ? top
          : clip.targetId
            ? (current.objects.find((object) => object.id === clip.targetId && object.character) ??
              null)
            : null
        if (!group?.character) {
          notify('Select a character to key all of its parts')
          return
        }
        for (const part of current.objects) {
          if (part.parentId !== group.id || part.kind === 'group') continue
          entries.push({ target: part.name, key: { time, ...poseOf(part) } })
        }
      } else if (selection) {
        entries.push({ target: selection.name, key: { time, ...poseOf(selection) } })
      }
      if (entries.length === 0) {
        notify('Select an object or a body part to key it')
        return
      }
      updateDoc((state) => ({
        ...state,
        animations: (state.animations ?? []).map((entry) =>
          entry.id === id ? insertKeys(entry, entries) : entry,
        ),
      }))
      notify(
        `Keyed ${
          entries.length === 1 ? entries[0].target : `${entries.length} parts`
        } at ${time.toFixed(2)}s`,
      )
    },
    [animClipId, notify, updateDoc],
  )

  // Unity .anim clips and the animation inside Blender/glTF/FBX exports.
  const importAnimation = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer()
        const parsed = await importAnimationFile(buffer, file.name)
        const current = docRef.current
        const existing = current.animations ?? []
        if (existing.length + parsed.length > MAX_ANIMATION_CLIPS) {
          throw new Error(`A project holds up to ${MAX_ANIMATION_CLIPS} clips`)
        }
        const selection = selectionIdRef.current
          ? (current.objects.find((object) => object.id === selectionIdRef.current) ?? null)
          : null
        const top = selection ? topLevelOf(selection, current) : null
        const taken = [...existing]
        const clips = parsed.map((clip) => {
          const name = uniqueClipName(taken, clip.name)
          const entry: AnimationClipData = {
            ...clip,
            name,
            ...(top ? { targetId: top.id } : {}),
          }
          taken.push(entry)
          return entry
        })
        updateDoc((state) => ({ ...state, animations: [...(state.animations ?? []), ...clips] }))
        setSidebarTab('animation')
        setAnimClipId(clips[0].id)
        setAnimPlaying(false)
        setAnimMatch(null)
        seekAnimation(0)
        const tracks = clips.reduce((sum, clip) => sum + clip.tracks.length, 0)
        notify(
          `Imported ${clips.length === 1 ? `“${clips[0].name}”` : `${clips.length} clips`} · ${tracks} tracks`,
        )
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not read that animation')
      }
    },
    [notify, seekAnimation, updateDoc],
  )
  importAnimationRef.current = (file) => void importAnimation(file)

  const appendFile = useCallback(
    (id: string) => {
      const file = fsRef.current.files.find((f) => f.id === id)
      if (!file) return
      const idMap = new Map<string, string>()
      for (const o of file.doc.objects) idMap.set(o.id, uid('obj'))
      const taken = [...docRef.current.objects]
      // Place the incoming content beside the existing scene instead of on top of it.
      const current = objectBounds(docRef.current.objects)
      const incoming = objectBounds(file.doc.objects)
      const rightEdge = Number.isFinite(current.maxX) ? current.maxX : 0
      const leftEdge = Number.isFinite(incoming.minX) ? incoming.minX : 0
      const shift = rightEdge + 1.4 - leftEdge
      const clones: SceneObject[] = file.doc.objects.map((o) => {
        const clone: SceneObject = {
          ...o,
          id: idMap.get(o.id)!,
          parentId: o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : null,
          position: [o.position[0], o.position[1], o.position[2]],
          rotation: [o.rotation[0], o.rotation[1], o.rotation[2]],
          scale: [o.scale[0], o.scale[1], o.scale[2]],
          character: o.character ? cloneSpec(o.character) : undefined,
        }
        if (!o.parentId) {
          clone.name = uniqueName(taken, o.name)
          clone.position = [clone.position[0] + shift, clone.position[1], clone.position[2]]
          taken.push(clone)
        }
        return clone
      })
      updateDoc((state) => ({ ...state, objects: [...state.objects, ...clones] }))
      const firstTop = clones.find((c) => !c.parentId)
      if (firstTop) setSelectionId(firstTop.id)
      notify(`Appended ${clones.length} objects from ${file.name}`)
    },
    [notify, updateDoc],
  )

  const setSceneView = useCallback((next: ViewName) => {
    viewportRef.current?.setView(next)
    setView(next)
  }, [])

  const frameSelected = useCallback(() => {
    const id = selectionIdRef.current
    if (id) viewportRef.current?.frameSelection(id)
    else viewportRef.current?.frameAll()
  }, [])

  useEffect(() => {
    if (selectionId && !doc.objects.some((o) => o.id === selectionId)) {
      setSelectionId(null)
    }
  }, [doc, selectionId])

  useEffect(() => {
    document.title = `${doc.name} — Shredder`
  }, [doc.name])

  // A different project starts fresh, so first-run help can appear again.
  useEffect(() => {
    setStartDismissed(false)
  }, [loadToken])

  // A different project has its own clips; drop the old playhead with it.
  useEffect(() => {
    setAnimClipId(null)
    setAnimPlaying(false)
    seekAnimation(0)
  }, [loadToken, seekAnimation])

  // Opening the tab picks the first clip, so the transport is never idle.
  useEffect(() => {
    if (sidebarTab !== 'animation' || animClipId) return
    const first = doc.animations?.[0]
    if (first) setAnimClipId(first.id)
  }, [sidebarTab, animClipId, doc.animations])

  // Undo or deleting a clip removes it from the document; keep the tab honest.
  useEffect(() => {
    if (animClipId && !(doc.animations ?? []).some((clip) => clip.id === animClipId)) {
      setAnimClipId(null)
      setAnimPlaying(false)
    }
  }, [doc.animations, animClipId])

  const actionsRef = useRef({
    undo,
    redo,
    save,
    openProjectFromDisk,
    saveProjectAs,
    deleteSelected,
    duplicateSelected,
    toggleMode,
    frameSelected,
    setSceneView,
    setFilesOpen,
    setSelectionId,
    setTool,
    openHelp,
  })
  actionsRef.current = {
    undo,
    redo,
    save,
    openProjectFromDisk,
    saveProjectAs,
    deleteSelected,
    duplicateSelected,
    toggleMode,
    frameSelected,
    setSceneView,
    setFilesOpen,
    setSelectionId,
    setTool,
    openHelp,
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const actions = actionsRef.current
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (mod) {
        if (key === 's' && event.shiftKey) {
          event.preventDefault()
          actions.saveProjectAs()
        } else if (key === 's') {
          event.preventDefault()
          actions.save()
        } else if (key === 'o') {
          event.preventDefault()
          actions.openProjectFromDisk()
        } else if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) actions.redo()
          else actions.undo()
        } else if (key === 'y') {
          event.preventDefault()
          actions.redo()
        }
        return
      }

      // In sculpt mode the left button paints and the transform keys have no target.
      if (
        modeRef.current === 'sculpt' &&
        (key === 'q' || key === 'g' || key === 'r' || key === 's')
      ) {
        return
      }

      if (key === 'tab') {
        event.preventDefault()
        actions.toggleMode()
      } else if (key === 'q') {
        actions.setTool('select')
      } else if (key === 'g') {
        actions.setTool('translate')
      } else if (key === 'r') {
        actions.setTool('rotate')
      } else if (key === 's') {
        actions.setTool('scale')
      } else if (key === 'x' || key === 'delete') {
        actions.deleteSelected()
      } else if (key === 'd' && event.shiftKey) {
        actions.duplicateSelected()
      } else if (key === 'f') {
        actions.frameSelected()
      } else if (key === 'escape') {
        actions.setFilesOpen(false)
        actions.setSelectionId(null)
      } else if (key === '1') {
        actions.setSceneView('front')
      } else if (key === '3') {
        actions.setSceneView('right')
      } else if (key === '7') {
        actions.setSceneView('top')
      } else if (key === '5') {
        actions.setSceneView('user')
      } else if (key === 'f1' || key === '?') {
        event.preventDefault()
        actions.openHelp()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const fileItems: MenuEntry[] = [
    { label: 'New File', onClick: () => createFile(fs.activeFolderId) },
    { label: 'Open Project…', shortcut: 'Ctrl O', onClick: () => void openProjectFromDisk() },
    { label: 'Open File Browser…', onClick: () => setFilesOpen(true) },
    { divider: true },
    { label: 'Save', shortcut: 'Ctrl S', onClick: save },
    { label: 'Save As…', shortcut: 'Ctrl Shift S', onClick: () => void saveProjectAs() },
    { label: 'Save Copy As…', onClick: () => setFilesOpen(true) },
    { divider: true },
    { label: 'Import Project (.blend / .mblend)…', onClick: () => importRef.current?.click() },
    { label: 'Import Model… (FBX, OBJ, glTF, STL…)', onClick: () => void openModelFromDisk() },
    { label: 'Import Image / Texture… (PNG, JPEG)', onClick: () => imageInputRef.current?.click() },
    { label: 'Import Animation… (.anim, .glb, .fbx)', onClick: () => animationInputRef.current?.click() },
    { label: 'Export .mblend', onClick: exportProject },
    { label: 'Export .glb', onClick: exportGlb },
  ]

  const addItems: MenuEntry[] = [
    { section: 'Mesh' },
    ...PRIMITIVES.map((primitive) => ({
      label: primitive.label,
      onClick: () => addPrim(primitive.kind),
    })),
    { divider: true },
    { section: 'Character' },
    ...Object.keys(CHARACTER_PRESETS).map((name) => ({
      label: `${name} character`,
      onClick: () => addCharacter(presetSpec(name)),
    })),
    { divider: true },
    { label: 'Open Character Builder…', onClick: () => setSidebarTab('character') },
  ]

  const viewItems: MenuEntry[] = [
    { label: 'Front', shortcut: '1', onClick: () => setSceneView('front') },
    { label: 'Right', shortcut: '3', onClick: () => setSceneView('right') },
    { label: 'Top', shortcut: '7', onClick: () => setSceneView('top') },
    { label: 'User Perspective', shortcut: '5', onClick: () => setSceneView('user') },
    { divider: true },
    { label: 'Frame Selected', shortcut: 'F', onClick: frameSelected },
    { label: 'Frame All', onClick: () => viewportRef.current?.frameAll() },
    { divider: true },
    {
      label: shading === 'solid' ? 'Wireframe' : 'Solid',
      onClick: () => setShading((prev) => (prev === 'solid' ? 'wire' : 'solid')),
    },
    { label: snap ? 'Disable snapping' : 'Enable snapping', onClick: () => setSnap((v) => !v) },
    { label: showBones ? 'Hide skeleton' : 'Show skeleton', onClick: () => setShowBones((v) => !v) },
    { label: 'AI actions…', onClick: () => setSidebarTab('ai') },
    { divider: true },
    { label: 'Help guide…', shortcut: 'F1', onClick: () => openHelp() },
    { label: 'Keyboard shortcuts…', onClick: () => openHelp('List every keyboard shortcut') },
  ]

  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0
  const spec = editingCharacter?.character ?? draftSpec
  const clips = doc.animations ?? []
  const activeClip = clips.find((clip) => clip.id === animClipId) ?? null
  const boundName = activeClip?.targetId
    ? (doc.objects.find((object) => object.id === activeClip.targetId)?.name ?? null)
    : null

  // ---------------------------------------------------------------- AI bridge
  // Desktop builds receive tool calls from the Electron main process; every
  // call is executed against the live document so the UI updates immediately.
  const aiRef = useRef<((tool: string, args: Record<string, unknown>) => Promise<unknown>) | null>(
    null,
  )

  aiRef.current = async (tool, args) => {
    const current = docRef.current
    const asNumber = (value: unknown, fallback: number) => {
      const parsed = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const asVec = (value: unknown, fallback: Vec3): Vec3 =>
      Array.isArray(value) && value.length >= 3
        ? [
            asNumber(value[0], fallback[0]),
            asNumber(value[1], fallback[1]),
            asNumber(value[2], fallback[2]),
          ]
        : fallback
    const colorPatch = (value: unknown): Partial<CharacterColors> => {
      const patch: Partial<CharacterColors> = {}
      if (!value || typeof value !== 'object') return patch
      for (const key of ['suit', 'accent', 'skin', 'boots', 'visor'] as const) {
        const color = (value as Record<string, unknown>)[key]
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) patch[key] = color
      }
      return patch
    }
    const findObject = (value: unknown) => {
      const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
      if (!name) return null
      return (
        current.objects.find((o) => !o.parentId && o.name.toLowerCase() === name) ??
        current.objects.find((o) => o.name.toLowerCase() === name) ??
        null
      )
    }
    const serialize = (object: SceneObject) => ({
      id: object.id,
      name: object.name,
      kind: object.kind,
      parent: object.parentId
        ? (current.objects.find((entry) => entry.id === object.parentId)?.name ?? null)
        : null,
      position: object.position,
      rotation: object.rotation,
      scale: object.scale,
      color: object.color,
      visible: object.visible,
      mesh: object.mesh
        ? {
            triangles: object.mesh.triangles,
            vertices: object.mesh.vertices,
            bones: object.mesh.bones?.length ?? 0,
            format: object.mesh.format ?? null,
            source: object.mesh.source ?? null,
          }
        : undefined,
      rig: object.character
        ? {
            preset: object.character.preset,
            height: object.character.height,
            build: object.character.build,
            headSize: object.character.headSize,
            legLength: object.character.legLength,
            colors: object.character.colors,
          }
        : undefined,
    })

    switch (tool) {
      case 'ping':
        return { ok: true, app: 'Shredder', file: current.name }
      case 'get_scene':
        return {
          file: current.name,
          selection: selectionIdRef.current,
          objectCount: current.objects.length,
          camera: current.camera,
          objects: current.objects.map(serialize),
        }
      case 'list_files':
        return {
          active: fsRef.current.files.find((file) => file.id === activeFileIdRef.current)?.name ?? null,
          folders: fsRef.current.folders.map((folder) => ({ name: folder.name, id: folder.id })),
          files: fsRef.current.files.map((file) => ({
            name: file.name,
            id: file.id,
            folder:
              fsRef.current.folders.find((folder) => folder.id === file.folderId)?.name ?? 'Root',
            objects: file.doc.objects.length,
            updatedAt: file.updatedAt,
            path: file.externalPath ?? null,
          })),
        }
      case 'open_file': {
        const requested = String(args.name ?? '').trim()
        const wanted = requested.toLowerCase()
        const file = fsRef.current.files.find(
          (entry) =>
            entry.id === requested ||
            entry.name.toLowerCase() === wanted ||
            entry.externalPath?.toLowerCase() === wanted,
        )
        if (file) {
          openFile(file.id)
          return { opened: file.name, objects: file.doc.objects.length }
        }
        const host = window.shredderHost
        if (host?.projects && requested) {
          const opened = await host.projects.read(requested)
          if (opened.model) {
            const imported = await addModel(
              opened.model.name,
              base64ToArrayBuffer(opened.model.base64),
            )
            return { imported, path: opened.path }
          }
          const name = adoptProject(opened)
          return {
            opened: name,
            objects: docRef.current.objects.length,
            path: opened.path,
          }
        }
        throw new Error(`No project file named "${requested}"`)
      }
      case 'add_character': {
        const presetName = typeof args.preset === 'string' ? args.preset : 'Hero'
        if (!CHARACTER_PRESETS[presetName]) {
          throw new Error(
            `Unknown preset "${presetName}". Use one of ${Object.keys(CHARACTER_PRESETS).join(', ')}`,
          )
        }
        const nextSpec = presetSpec(presetName)
        if (args.height !== undefined)
          nextSpec.height = clamp(asNumber(args.height, nextSpec.height), 1.3, 2.2)
        if (args.build !== undefined)
          nextSpec.build = clamp(asNumber(args.build, nextSpec.build), 0.7, 1.45)
        if (args.headSize !== undefined)
          nextSpec.headSize = clamp(asNumber(args.headSize, nextSpec.headSize), 0.75, 1.35)
        if (args.legLength !== undefined)
          nextSpec.legLength = clamp(asNumber(args.legLength, nextSpec.legLength), 0.85, 1.2)
        nextSpec.colors = { ...nextSpec.colors, ...colorPatch(args.colors) }
        const baseName =
          typeof args.name === 'string' && args.name.trim() ? args.name.trim() : presetName
        const { group, parts } = createCharacter(
          current,
          nextSpec,
          uniqueName(current.objects, baseName),
          nextSpot(current),
        )
        if (args.position !== undefined) group.position = asVec(args.position, group.position)
        updateDoc((state) => ({ ...state, objects: [...state.objects, group, ...parts] }))
        setSelectionId(group.id)
        setSidebarTab('character')
        notify(`${group.name} added`)
        return { name: group.name, position: group.position, parts: parts.length, rig: nextSpec }
      }
      case 'update_character': {
        const target = findObject(args.target)
        const selected = selectionIdRef.current
          ? (current.objects.find((o) => o.id === selectionIdRef.current) ?? null)
          : null
        const rig = target?.character ? target : selected?.character ? selected : null
        if (!rig?.character) throw new Error('No character rig selected or named in "target"')
        const nextSpec = cloneSpec(rig.character)
        if (args.height !== undefined)
          nextSpec.height = clamp(asNumber(args.height, nextSpec.height), 1.3, 2.2)
        if (args.build !== undefined)
          nextSpec.build = clamp(asNumber(args.build, nextSpec.build), 0.7, 1.45)
        if (args.headSize !== undefined)
          nextSpec.headSize = clamp(asNumber(args.headSize, nextSpec.headSize), 0.75, 1.35)
        if (args.legLength !== undefined)
          nextSpec.legLength = clamp(asNumber(args.legLength, nextSpec.legLength), 0.85, 1.2)
        nextSpec.colors = { ...nextSpec.colors, ...colorPatch(args.colors) }
        nextSpec.preset = 'Custom'
        updateCharacter(rig.id, nextSpec)
        return { updated: rig.name, rig: nextSpec }
      }
      case 'transform_object': {
        const target = findObject(args.target)
        if (!target) throw new Error(`No object named "${String(args.target ?? '')}"`)
        const patch: Partial<SceneObject> = {}
        if (args.position !== undefined) patch.position = asVec(args.position, target.position)
        if (args.rotation !== undefined) patch.rotation = asVec(args.rotation, target.rotation)
        if (args.scale !== undefined) patch.scale = asVec(args.scale, target.scale)
        if (Object.keys(patch).length === 0) throw new Error('Pass position, rotation or scale')
        updateDoc((state) => ({
          ...state,
          objects: state.objects.map((o) => (o.id === target.id ? { ...o, ...patch } : o)),
        }))
        return serialize({ ...target, ...patch })
      }
      case 'select_object': {
        const target = findObject(args.target)
        if (!target) throw new Error(`No object named "${String(args.target ?? '')}"`)
        selectObject(target.id)
        return { selected: target.name, mode: modeRef.current }
      }
      case 'add_primitive': {
        const kind = String(args.kind ?? 'box') as PrimitiveKind
        if (!PRIMITIVES.some((primitive) => primitive.kind === kind)) {
          throw new Error(`Unknown primitive "${kind}"`)
        }
        const result = addPrimitive(current, kind)
        updateDoc(() => result.doc)
        setSelectionId(result.object.id)
        setSidebarTab('properties')
        notify(`${result.object.name} added`)
        return { name: result.object.name, position: result.object.position }
      }
      case 'delete_object': {
        const target = findObject(args.target)
        if (!target) throw new Error(`No object named "${String(args.target ?? '')}"`)
        const ids = new Set(descendantIds(current.objects, target.id))
        updateDoc((state) => ({ ...state, objects: state.objects.filter((o) => !ids.has(o.id)) }))
        setSelectionId((id) => (id && ids.has(id) ? null : id))
        notify(`Deleted ${target.name}`)
        return { deleted: target.name, removed: ids.size }
      }
      case 'import_model': {
        const requested = String(args.path ?? '').trim()
        const host = window.shredderHost
        if (!host?.models || !requested) {
          throw new Error('Pass the absolute path of a model file (desktop app only)')
        }
        const model = await host.models.read(requested)
        const imported = await addModel(model.name, base64ToArrayBuffer(model.base64))
        return { imported, path: model.path }
      }
      case 'save_file': {
        save()
        if (!(await flushStore())) throw new Error('Could not write the project file')
        const active = fsRef.current.files.find((file) => file.id === activeFileIdRef.current)
        return {
          saved: docRef.current.name,
          objects: docRef.current.objects.length,
          path: active?.externalPath ?? null,
          library: window.shredderHost ? 'disk' : 'browser',
        }
      }
      case 'export_glb': {
        const manager = viewportRef.current
        if (!manager) throw new Error('Viewport is not ready yet')
        const blob = await manager.exportGLB()
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        }
        const base = docRef.current.name.replace(/\.(blend|mblend)$/i, '')
        return { filename: `${base}.glb`, bytes: blob.size, base64: btoa(binary) }
      }
      default:
        throw new Error(`Unknown tool "${tool}"`)
    }
  }

  const syncAiSessions = useCallback(() => {
    setAiSessions(
      Array.from(aiSessionsRef.current.values()).map(
        ({ id, fileId, startedAt, calls, reverted }) => ({ id, fileId, startedAt, calls, reverted }),
      ),
    )
  }, [])

  const recordAiCall = useCallback(
    (entry: AiLogEntry) => {
      const next = [entry, ...aiLogRef.current].slice(0, 300)
      aiLogRef.current = next
      setAiLog(next)
      // Sessions whose calls were trimmed out of the log can no longer be
      // reverted from the panel, so drop their snapshots too.
      const live = new Set(next.map((item) => item.session))
      for (const id of Array.from(aiSessionsRef.current.keys())) {
        if (!live.has(id)) aiSessionsRef.current.delete(id)
      }
      syncAiSessions()
    },
    [syncAiSessions],
  )

  // Runs one bridge/MCP call, grouping calls into a session so the whole run
  // can be reverted at once.
  const runAiTool = useCallback(
    async (tool: string, args: Record<string, unknown>, sessionId?: string) => {
      const handler = aiRef.current
      if (!handler) throw new Error('Shredder is still loading')
      const session =
        typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'adhoc'
      let record = aiSessionsRef.current.get(session)
      if (!record) {
        record = {
          id: session,
          fileId: activeFileIdRef.current,
          startedAt: Date.now(),
          calls: 0,
          reverted: false,
          snapshot: structuredClone(docRef.current),
        }
        aiSessionsRef.current.set(session, record)
        syncAiSessions()
      } else if (record.reverted) {
        // A fresh model run after a revert starts from the current project.
        record.snapshot = structuredClone(docRef.current)
        record.fileId = activeFileIdRef.current
        record.reverted = false
        record.calls = 0
        record.startedAt = Date.now()
        syncAiSessions()
      }

      const startedAt = Date.now()
      const entryId = uid('ai')
      try {
        const result = await handler(tool, args)
        record.calls += 1
        recordAiCall({
          id: entryId,
          session,
          tool,
          args,
          status: 'ok',
          summary: summarizeAiResult(result),
          at: startedAt,
          ms: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        record.calls += 1
        recordAiCall({
          id: entryId,
          session,
          tool,
          args,
          status: 'error',
          summary: error instanceof Error ? error.message : String(error),
          at: startedAt,
          ms: Date.now() - startedAt,
        })
        throw error
      }
    },
    [recordAiCall, syncAiSessions],
  )

  const toggleAiPause = useCallback(() => {
    const host = window.shredderHost
    if (!host) {
      notify('The AI bridge only runs in the desktop app')
      return
    }
    const next = !aiPaused
    setAiPaused(next)
    void host
      .setAiPaused(next)
      .then((paused) => {
        setAiPaused(paused)
        notify(paused ? 'AI bridge paused' : 'AI bridge resumed')
      })
      .catch((error: unknown) => {
        setAiPaused(!next)
        notify(error instanceof Error ? error.message : 'Could not change the bridge state')
      })
  }, [aiPaused, notify])

  const revertAiSession = useCallback(
    (sessionId: string) => {
      const session = aiSessionsRef.current.get(sessionId)
      if (!session || session.reverted) return
      if (session.fileId !== activeFileIdRef.current) {
        notify('Open the project this session edited to revert it')
        return
      }
      historyRef.current.past.push(docRef.current)
      if (historyRef.current.past.length > 80) historyRef.current.past.shift()
      historyRef.current.future = []
      coalesceRef.current = null
      setDocument({ ...structuredClone(session.snapshot), updatedAt: Date.now() })
      setSelectionId(null)
      session.reverted = true
      syncAiSessions()
      notify(`Reverted ${session.calls} AI ${session.calls === 1 ? 'call' : 'calls'}`)
    },
    [notify, setDocument, syncAiSessions],
  )

  const clearAiLog = useCallback(() => {
    aiLogRef.current = []
    aiSessionsRef.current.clear()
    setAiLog([])
    setAiSessions([])
    notify('AI actions cleared')
  }, [notify])

  useEffect(() => {
    const host = window.shredderHost
    if (!host) return
    const applyStatus = (status: AiBridgeStatus | null) => {
      setAiStatus(status)
      setAiPaused(Boolean(status?.paused))
    }
    void host.getAiStatus().then(applyStatus).catch(() => applyStatus(null))
    const stopStatus = host.onAiStatus((status) => applyStatus(status))
    const stopRequests = host.onAiRequest((tool, args, session) =>
      runAiTool(tool, args, session),
    )
    return () => {
      stopRequests()
      stopStatus()
    }
  }, [runAiTool])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">Shredder</span>
          <span className="brand-tag">character modeler</span>
        </div>

        <div className="menu-bar">
          <Menu label="File" items={fileItems} />
          <Menu label="Add" items={addItems} />
          <Menu label="View" items={viewItems} />
        </div>

        <div className="topbar-center">
          <div className="mode-switch">
            <button
              type="button"
              className={mode === 'object' ? 'active' : ''}
              onClick={() => changeMode('object')}
              title="Select and move whole models and groups"
            >
              Object
            </button>
            <button
              type="button"
              className={mode === 'pose' ? 'active' : ''}
              onClick={() => changeMode('pose')}
              title="Move individual character parts"
            >
              Pose
            </button>
            <button
              type="button"
              className={mode === 'sculpt' ? 'active' : ''}
              onClick={() => changeMode('sculpt')}
              title="Sculpt the selected part with brushes"
            >
              Sculpt
            </button>
            <button
              type="button"
              className={mode === 'paint' ? 'active' : ''}
              onClick={() => changeMode('paint')}
              title="Select a surface part and paint it"
            >
              Paint
            </button>
          </div>
          <div
            className="file-chip"
            title={
              window.shredderHost
                ? 'Project file — autosaved to disk'
                : 'Project file — saves automatically to browser storage'
            }
          >
            <span className="saved-dot" />
            {doc.name}
          </div>
        </div>

                <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <IconUndo size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            <IconRedo size={16} />
          </button>
          <span className="topbar-sep" />
          <button type="button" className="icon-btn" onClick={save} title="Save (Ctrl+S)">
            <IconSave size={16} />
          </button>
          <button type="button" className="btn ghost" onClick={() => setFilesOpen(true)}>
            <IconFolder size={14} /> Files
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={exportGlb}
            title="Export a .glb model for Blender, Unity or any glTF viewer"
          >
            <IconDownload size={14} /> Export GLB
          </button>
          <button
            type="button"
            className="btn guide"
            onClick={() => openHelp()}
            title="Ask the built-in guide how the app works (F1)"
          >
            <IconChat size={14} /> Help
          </button>
          <button
            type="button"
            className="btn ghost mobile-only"
            onClick={() => setPanelsOpen((open) => !open)}
            title="Open the scene, edit and brush panels">
            Panels
          </button>
        </div>
      </header>

      <div className={`workspace ${panelsOpen ? 'sidebar-open' : ''}`}>
        {panelsOpen && (
          <div className="sheet-backdrop" onClick={() => setPanelsOpen(false)} />
        )}
        <aside className="toolbar">
          <div className="tool-group">
            <button
              type="button"
              className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
              onClick={() => setTool('select')}
              title="Select (Q)"
            >
              <IconSelect size={18} />
              <span className="tool-label">Select</span>
            </button>
            <button
              type="button"
              className={`tool-btn ${tool === 'translate' ? 'active' : ''}`}
              onClick={() => setTool('translate')}
              title="Move (G)"
            >
              <IconMove size={18} />
              <span className="tool-label">Move</span>
            </button>
            <button
              type="button"
              className={`tool-btn ${tool === 'rotate' ? 'active' : ''}`}
              onClick={() => setTool('rotate')}
              title="Rotate (R)"
            >
              <IconRotate size={18} />
              <span className="tool-label">Rotate</span>
            </button>
            <button
              type="button"
              className={`tool-btn ${tool === 'scale' ? 'active' : ''}`}
              onClick={() => setTool('scale')}
              title="Scale (S)"
            >
              <IconScale size={18} />
              <span className="tool-label">Scale</span>
            </button>
          </div>
          <div className="tool-sep" />
          <div className="tool-group">
            <button
              type="button"
              className="tool-btn"
              onClick={() => addPrim('box')}
              title="Add cube"
            >
              <IconPlus size={18} />
              <span className="tool-label">Add</span>
            </button>
            <button type="button" className="tool-btn" onClick={frameSelected} title="Frame (F)">
              <IconFrame size={18} />
              <span className="tool-label">Frame</span>
            </button>
            <button
              type="button"
              className="tool-btn"
              onClick={() => {
                setSidebarTab('character')
                setPanelsOpen(true)
              }}
              title="Character builder"
            >
              <IconCharacter size={18} />
              <span className="tool-label">Character</span>
            </button>
          </div>
        </aside>

        <Viewport
          doc={doc}
          selectionId={selectionId}
          transformId={transformId}
          tool={tool}
          snap={snap}
          shading={shading}
          showBones={showBones}
          viewLabel={VIEW_LABELS[view]}
          mode={mode}
          sculpt={{
            enabled: mode === 'sculpt',
            brush: sculptBrush,
            radius: sculptRadius,
            strength: sculptStrength,
            symmetry: sculptSymmetry,
            smooth: sculptSmooth,
            invert: sculptInvert,
          }}
          paint={{
            enabled: mode === 'paint',
            tool: paintTool,
            color: paintColor,
            radius: paintRadius,
            strength: paintStrength,
          }}
          loadToken={loadToken}
          callbacks={{
            onPick: handlePick,
            onTransform: handleTransform,
            onTransformStart: handleTransformStart,
            onTransformEnd: handleTransformEnd,
            onSculptCommit: commitSculptStroke,
            onPaintPart: (id, part, parts, triangles) =>
              setPaintPart({ id, index: part, count: parts, triangles }),
            onPaintCommit: commitPaint,
            onAnimationTime: (time, playing) => {
              animTimeRef.current = time
              setAnimTime(time)
              setAnimPlaying((current) => (current === playing ? current : playing))
            },
            onAnimationMatch: (bound, total) => {
              setAnimMatch((current) =>
                current && current.bound === bound && current.total === total
                  ? current
                  : { bound, total },
              )
            },
          }}
          onReady={handleReady}
          onSetView={setSceneView}
          onFrameSelected={frameSelected}
          onFrameAll={() => viewportRef.current?.frameAll()}
          animation={{
            clip: activeClip,
            playing: animPlaying && Boolean(activeClip),
            speed: animSpeed,
            loop: animLoop,
            seekTime: animSeek.time,
            seekToken: animSeek.token,
          }}
          overlay={
            doc.objects.length === 0 && !startDismissed ? (
              <StartCard
                onImport={() => void openModelFromDisk()}
                onCharacter={() => setSidebarTab('character')}
                onAddCube={() => addPrim('box')}
                onOpenProject={() => void openProjectFromDisk()}
                onAsk={() => openHelp()}
                onDismiss={() => setStartDismissed(true)}
              />
            ) : null
          }
        />

        <aside className="sidebar">
          <div className="sheet-bar">
            <span className="sheet-title">Panels</span>
            <button type="button" className="sheet-done" onClick={() => setPanelsOpen(false)}>
              Done
            </button>
          </div>
          <div className="sidebar-tabs">
            <button
              type="button"
              className={sidebarTab === 'outliner' ? 'active' : ''}
              onClick={() => setSidebarTab('outliner')}
              title="Everything in the scene"
            >
              Scene
            </button>
            <button
              type="button"
              className={sidebarTab === 'properties' ? 'active' : ''}
              onClick={() => setSidebarTab('properties')}
              title="Name, transform and material of the selection"
            >
              Edit
            </button>
            <button
              type="button"
              className={sidebarTab === 'character' ? 'active' : ''}
              onClick={() => setSidebarTab('character')}
              title="Build and recolour characters"
            >
              Character
            </button>
            <button
              type="button"
              className={sidebarTab === 'animation' ? 'active' : ''}
              onClick={() => setSidebarTab('animation')}
              title="Animation clips, keyframes and playback"
            >
              Anim
            </button>
            <button
              type="button"
              className={sidebarTab === 'sculpt' ? 'active' : ''}
              onClick={() => (mode === 'sculpt' ? setSidebarTab('sculpt') : changeMode('sculpt'))}
              title="Sculpt brushes, radius and symmetry"
            >
              Sculpt
            </button>
            <button
              type="button"
              className={sidebarTab === 'paint' ? 'active' : ''}
              onClick={() => (mode === 'paint' ? setSidebarTab('paint') : changeMode('paint'))}
              title="Select a part of the model's surface and paint it"
            >
              Paint
            </button>
            <button
              type="button"
              className={sidebarTab === 'ai' ? 'active' : ''}
              onClick={() => setSidebarTab('ai')}
              title="AI actions, pause switch and session revert"
            >
              AI
            </button>
            <button
              type="button"
              className={sidebarTab === 'help' ? 'active' : ''}
              onClick={() => openHelp()}
              title="Ask how the app works (F1)"
            >
              Help
            </button>
          </div>
          <div className={`sidebar-body ${sidebarTab === 'help' ? 'chat-body' : ''}`}>
            {sidebarTab === 'outliner' && (
              <Outliner
                doc={doc}
                selectionId={selectionId}
                onSelect={selectObject}
                onRename={renameObject}
                onToggleVisible={toggleVisible}
                onDelete={deleteSelected}
                onDuplicate={duplicateSelected}
              />
            )}
            {sidebarTab === 'properties' && (
              <Properties
                doc={doc}
                selectionId={selectionId}
                onPatch={patchSelection}
                onResetTransform={resetTransform}
                onOpenCharacter={() => setSidebarTab('character')}
                onPickImage={() => imageInputRef.current?.click()}
                onClearImage={() => {
                  const id = selectionIdRef.current
                  if (id) {
                    setMeshImage(id, null)
                    notify('Image removed')
                  }
                }}
              />
            )}
            {sidebarTab === 'character' && (
              <CharacterPanel
                spec={spec}
                editingName={editingCharacter?.name ?? null}
                editingId={editingCharacter?.id ?? null}
                parts={editingParts}
                selectedPartId={editingPartId}
                onChange={handleCharacterChange}
                onAdd={addCharacter}
                onSelectPart={focusCharacterPart}
                onAdjustPart={(names, adjustment, coalesce) => {
                  if (editingCharacter) {
                    adjustCharacterParts(editingCharacter.id, names, adjustment, coalesce)
                  }
                }}
                onSetImage={(names, image, coalesce) => {
                  if (editingCharacter) {
                    setCharacterImages(editingCharacter.id, names, image, coalesce)
                  }
                }}
              />
            )}
            {sidebarTab === 'animation' && (
              <AnimationPanel
                clips={clips}
                activeClipId={animClipId}
                time={animTime}
                playing={animPlaying}
                speed={animSpeed}
                loop={animLoop}
                match={animMatch}
                boundName={boundName}
                selectionName={selected?.name ?? null}
                objects={doc.objects.filter((object) => !object.parentId)}
                onSelectClip={selectAnimationClip}
                onNewClip={createAnimationClip}
                onRenameClip={renameAnimationClip}
                onDeleteClip={deleteAnimationClip}
                onDuration={setAnimationDuration}
                onBind={bindAnimationClip}
                onPlay={setAnimPlaying}
                onSeek={seekAnimation}
                onSpeed={setAnimSpeed}
                onLoop={setAnimLoop}
                onAddKey={addAnimationKeys}
                onDeleteTrack={deleteAnimationTrack}
                onImport={(file) => void importAnimation(file)}
              />
            )}
            {sidebarTab === 'sculpt' && (
              <SculptPanel
                partName={sculptTarget?.name ?? null}
                vertices={sculptTarget?.sculpt?.vertices ?? 0}
                triangles={sculptTarget?.sculpt?.triangles ?? 0}
                brush={sculptBrush}
                radius={sculptRadius}
                strength={sculptStrength}
                symmetry={sculptSymmetry}
                smooth={sculptSmooth}
                invert={sculptInvert}
                onBrush={setSculptBrush}
                onRadius={setSculptRadius}
                onStrength={setSculptStrength}
                onSymmetry={(axis) =>
                  setSculptSymmetry((current) => ({ ...current, [axis]: !current[axis] }))
                }
                onSymmetryToggle={() =>
                  setSculptSymmetry((current) => ({ ...current, enabled: !current.enabled }))
                }
                onSmooth={() => setSculptSmooth((current) => !current)}
                onInvert={() => setSculptInvert((current) => !current)}
                onReset={resetSculpt}
              />
            )}
            {sidebarTab === 'paint' && (
              <PaintPanel
                partName={paintTarget?.name ?? null}
                vertices={paintTarget?.sculpt?.vertices ?? paintTarget?.mesh?.vertices ?? 0}
                painted={Boolean(paintTarget?.paint)}
                tool={paintTool}
                color={paintColor}
                radius={paintRadius}
                strength={paintStrength}
                selection={
                  paintPart
                    ? {
                        index: paintPart.index + 1,
                        count: paintPart.count,
                        triangles: paintPart.triangles,
                      }
                    : null
                }
                parts={paintPartList}
                onSelectPart={(index) =>
                  viewportRef.current?.selectPaintPart(index, paintTarget?.id ?? null)
                }
                onTool={setPaintTool}
                onColor={setPaintColor}
                onRadius={setPaintRadius}
                onStrength={setPaintStrength}
                onFill={fillPaintPart}
                onClear={clearPaint}
                onResetSelection={() => {
                  setPaintPart(null)
                  viewportRef.current?.clearPaintSelection()
                }}
              />
            )}
            {sidebarTab === 'ai' && (
              <AiPanel
                entries={aiLog}
                sessions={aiSessions}
                paused={aiPaused}
                desktop={Boolean(window.shredderHost)}
                onTogglePause={toggleAiPause}
                onRevert={revertAiSession}
                onClear={clearAiLog}
              />
            )}
            <div className="help-pane" hidden={sidebarTab !== 'help'}>
              <HelpChat seed={helpSeed} />
            </div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-mode">
            {mode === 'object'
              ? 'Object Mode'
              : mode === 'pose'
                ? 'Pose Mode'
                : mode === 'sculpt'
                  ? 'Sculpt Mode'
                  : 'Paint Mode'}
          </span>
          <span>{tool === 'select' ? 'Select tool' : `${tool} tool`}</span>
          <span className="status-hint">
            {doc.objects.length === 0
              ? 'New here? Open the Help tab (F1) for guided answers.'
              : 'G/R/S transform · Tab pose · F frame · F1 help'}
          </span>
        </div>
        <div className="status-right">
          {aiStatus && (
            <button
              type="button"
              className={`status-ai ${aiStatus.state} ${aiPaused ? 'paused' : ''}`}
              onClick={copyBridgeEndpoint}
              title={
                aiPaused
                  ? 'AI bridge paused — open AI actions to resume'
                  : aiStatus.state === 'ready'
                    ? `${aiStatus.url} · ${aiStatus.tools} tools · click to copy the endpoint`
                    : aiStatus.state === 'error'
                      ? `AI bridge failed: ${aiStatus.error ?? 'unknown error'}`
                      : `AI bridge starting on port ${aiStatus.port}`
              }
            >
              <span className="status-ai-dot" />
              {aiStatus.state === 'ready' && !aiPaused ? (
                <>
                  <span className="status-ai-endpoint">
                    {aiStatus.url.replace(/^https?:\/\//, '')}
                  </span>
                  <span className="status-ai-tools">{aiStatus.tools} tools</span>
                </>
              ) : (
                <span>
                  {aiPaused
                    ? 'AI paused'
                    : aiStatus.state === 'error'
                      ? 'AI bridge offline'
                      : 'AI bridge starting…'}
                </span>
              )}
            </button>
          )}
          <span>{doc.objects.length} objects</span>
          <span>{doc.name}</span>
          <span className="status-brand">Shredder 1.0</span>
        </div>
      </footer>

      {filesOpen && (
        <FileBrowser
          fs={fs}
          activeFileId={activeFileId}
          initialFolderId={fs.activeFolderId}
          onClose={() => setFilesOpen(false)}
          onOpen={openFile}
          onNewFile={createFile}
          onNewFolder={createFolder}
          onSaveAs={saveAs}
          onImport={importFile}
          onExport={(format) => {
            if (format === 'glb') void exportGlb()
            else exportProject()
          }}
          onAppend={appendFile}
          onDeleteFile={deleteFile}
          onRenameFile={renameFile}
          onDeleteFolder={deleteFolder}
          onRenameFolder={renameFolder}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      <input
        ref={importRef}
        type="file"
        accept={`.blend,.mblend,.json,${MODEL_ACCEPT},application/json`}
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept={PICTURE_ACCEPT}
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void applyPictureFile(file, null)
          event.target.value = ''
        }}
      />
      <input
        ref={animationInputRef}
        type="file"
        accept={ANIMATION_ACCEPT}
        className="hidden-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importAnimation(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}
