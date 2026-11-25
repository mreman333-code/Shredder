import type { Vec3 } from './doc'

/**
 * Animation clips as they are stored inside a project.
 *
 * A clip is a flat list of tracks keyed by name: a bone key ("Thigh_L"), a body
 * part ("Forearm R") or an object name ("Cube"). Keys hold the target's local
 * transform at a time, exactly like f-curves in Blender, so the same clip can be
 * authored here and imported from Unity or Blender exports.
 */
export type AnimationSource = 'unity' | 'gltf' | 'fbx' | 'manual'

export interface AnimationKey {
  time: number
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
}

export interface AnimationTrack {
  /** Bone key, part name or object name the keys drive. */
  target: string
  /** Full path from the source file, kept so the panel can show it. */
  path?: string
  keys: AnimationKey[]
}

export interface AnimationClipData {
  id: string
  name: string
  /** Clip length in seconds. */
  duration: number
  /** Authored sample rate, informational only. */
  fps: number
  source: AnimationSource
  /** Imported file name, shown in the clip list. */
  file?: string
  /** Scene object the clip drives (a character group or a model). */
  targetId?: string
  tracks: AnimationTrack[]
}

export const ANIMATION_SOURCE_LABELS: Record<AnimationSource, string> = {
  unity: 'Unity',
  gltf: 'glTF',
  fbx: 'FBX',
  manual: 'Manual',
}

export const MAX_ANIMATION_CLIPS = 40
export const MAX_ANIMATION_TRACKS = 240
export const MAX_ANIMATION_KEYS = 2000
export const MAX_ANIMATION_DURATION = 120

export function emptyClip(
  id: string,
  name: string,
  targetId?: string,
  duration = 2,
): AnimationClipData {
  return {
    id,
    name,
    duration,
    fps: 24,
    source: 'manual',
    ...(targetId ? { targetId } : {}),
    tracks: [],
  }
}

/** Latest key time in the clip. */
export function clipKeyEnd(clip: AnimationClipData): number {
  let end = 0
  for (const track of clip.tracks) {
    const last = track.keys[track.keys.length - 1]
    if (last && last.time > end) end = last.time
  }
  return end
}

// A clip always runs at least as long as its last key.
export function clipLength(clip: AnimationClipData): number {
  return Math.max(0.1, clip.duration, clipKeyEnd(clip))
}

const lerp = (a: number, b: number, ratio: number) => a + (b - a) * ratio

/** Interpolated transform of a track at a time. Channels stay optional. */
export function sampleTrack(track: AnimationTrack, time: number): AnimationKey {
  const keys = track.keys
  const result: AnimationKey = { time }
  if (keys.length === 0) return result
  let before = keys[0]
  let after = keys[keys.length - 1]
  if (time <= keys[0].time) {
    before = keys[0]
    after = keys[0]
  } else if (time < keys[keys.length - 1].time) {
    let low = 0
    let high = keys.length - 1
    while (high - low > 1) {
      const mid = (low + high) >> 1
      if (keys[mid].time <= time) low = mid
      else high = mid
    }
    before = keys[low]
    after = keys[high]
  }
  const span = after.time - before.time
  const ratio = span > 1e-6 ? Math.min(1, Math.max(0, (time - before.time) / span)) : 0

  const channel = (name: 'position' | 'rotation' | 'scale'): Vec3 | undefined => {
    const a = before[name]
    const b = after[name]
    if (!a && !b) return undefined
    if (!a) return b ? [...b] : undefined
    if (!b) return [...a]
    return [lerp(a[0], b[0], ratio), lerp(a[1], b[1], ratio), lerp(a[2], b[2], ratio)]
  }

  const position = channel('position')
  const rotation = channel('rotation')
  const scale = channel('scale')
  if (position) result.position = position
  if (rotation) result.rotation = rotation
  if (scale) result.scale = scale
  return result
}

export interface KeyEntry {
  target: string
  path?: string
  key: AnimationKey
}

/**
 * Writes keys into a clip: a track that already drives the target is extended,
 * a key on the same time replaces the old one, everything else stays sorted.
 */
export function insertKeys(clip: AnimationClipData, entries: KeyEntry[]): AnimationClipData {
  if (entries.length === 0) return clip
  const tracks = clip.tracks.map((track) => ({ ...track, keys: [...track.keys] }))
  let duration = clip.duration
  for (const entry of entries) {
    const time = Math.max(0, Math.round(entry.key.time * 1000) / 1000)
    const key: AnimationKey = { time }
    if (entry.key.position) key.position = [...entry.key.position]
    if (entry.key.rotation) key.rotation = [...entry.key.rotation]
    if (entry.key.scale) key.scale = [...entry.key.scale]
    let track = tracks.find((candidate) => candidate.target === entry.target)
    if (!track) {
      track = {
        target: entry.target,
        ...(entry.path ? { path: entry.path } : {}),
        keys: [],
      }
      tracks.push(track)
    }
    const existing = track.keys.findIndex((candidate) => Math.abs(candidate.time - time) < 0.001)
    if (existing >= 0) track.keys[existing] = key
    else {
      track.keys.push(key)
      track.keys.sort((a, b) => a.time - b.time)
    }
    if (track.keys.length > MAX_ANIMATION_KEYS) {
      track.keys = track.keys.slice(track.keys.length - MAX_ANIMATION_KEYS)
    }
    duration = Math.max(duration, time)
  }
  return { ...clip, duration: Math.min(MAX_ANIMATION_DURATION, duration), tracks }
}

export function removeTrack(clip: AnimationClipData, target: string): AnimationClipData {
  return { ...clip, tracks: clip.tracks.filter((track) => track.target !== target) }
}

/** Unique clip name inside a project. */
export function uniqueClipName(clips: AnimationClipData[], base: string): string {
  const names = new Set(clips.map((clip) => clip.name))
  if (!names.has(base)) return base
  let index = 1
  while (names.has(`${base}.${String(index).padStart(3, '0')}`)) index += 1
  return `${base}.${String(index).padStart(3, '0')}`
}

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.slice(0, 3).every((entry) => typeof entry === 'number' && Number.isFinite(entry))

const readVec = (value: unknown): Vec3 | undefined =>
  isVec3(value) ? [value[0], value[1], value[2]] : undefined

/**
 * Accepts only complete, well-formed clips: a project must never load with a
 * clip that would throw while the viewport plays it back.
 */
export function normalizeAnimationClip(raw: unknown): AnimationClipData | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const id = typeof data.id === 'string' && data.id ? data.id : ''
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : ''
  if (!id || !name) return null
  const source: AnimationSource =
    data.source === 'unity' || data.source === 'gltf' || data.source === 'fbx'
      ? data.source
      : 'manual'
  const rawTracks = Array.isArray(data.tracks) ? data.tracks : []
  const tracks: AnimationTrack[] = []
  for (const item of rawTracks.slice(0, MAX_ANIMATION_TRACKS)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const target = typeof entry.target === 'string' ? entry.target.trim() : ''
    if (!target) continue
    const rawKeys = Array.isArray(entry.keys) ? entry.keys : []
    const keys: AnimationKey[] = []
    for (const keyRaw of rawKeys.slice(0, MAX_ANIMATION_KEYS)) {
      if (!keyRaw || typeof keyRaw !== 'object') continue
      const keyData = keyRaw as Record<string, unknown>
      const time = typeof keyData.time === 'number' && Number.isFinite(keyData.time) ? keyData.time : -1
      if (time < 0 || time > MAX_ANIMATION_DURATION) continue
      const key: AnimationKey = { time }
      const position = readVec(keyData.position)
      const rotation = readVec(keyData.rotation)
      const scale = readVec(keyData.scale)
      if (position) key.position = position
      if (rotation) key.rotation = rotation
      if (scale) key.scale = scale
      if (!position && !rotation && !scale) continue
      keys.push(key)
    }
    if (keys.length === 0) continue
    keys.sort((a, b) => a.time - b.time)
    tracks.push({
      target,
      ...(typeof entry.path === 'string' && entry.path ? { path: entry.path } : {}),
      keys,
    })
  }
  if (tracks.length === 0) return null
  const durationRaw = typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : 0
  const fpsRaw = typeof data.fps === 'number' && Number.isFinite(data.fps) ? data.fps : 24
  return {
    id,
    name,
    duration: Math.min(MAX_ANIMATION_DURATION, Math.max(0.1, durationRaw)),
    fps: Math.min(240, Math.max(1, fpsRaw)),
    source,
    ...(typeof data.file === 'string' && data.file ? { file: data.file } : {}),
    ...(typeof data.targetId === 'string' && data.targetId ? { targetId: data.targetId } : {}),
    tracks,
  }
}
