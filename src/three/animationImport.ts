import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  MAX_ANIMATION_DURATION,
  MAX_ANIMATION_KEYS,
  MAX_ANIMATION_TRACKS,
  type AnimationClipData,
  type AnimationKey,
  type AnimationSource,
  type AnimationTrack,
} from '../blend/animation'
import { uid } from '../blend/doc'

/**
 * Animation importers.
 *
 * - Unity `.anim` clips (text serialization) are read directly: their
 *   `m_EditorCurves` hold one f-curve per component, exactly like Blender's
 *   f-curves, so they convert without Unity being installed.
 * - Blender (and Unity's glTF exporter) clips arrive inside glTF/GLB or FBX
 *   files, so those formats are read with the same loaders the model importer
 *   uses and only their animation data is taken.
 */
export const ANIMATION_EXTENSIONS = ['anim', 'glb', 'gltf', 'fbx'] as const
export type AnimationFormat = (typeof ANIMATION_EXTENSIONS)[number]

export const ANIMATION_ACCEPT = ANIMATION_EXTENSIONS.map((ext) => `.${ext}`).join(',')
export const ANIMATION_LABEL = 'Unity .anim, Blender/glTF .glb/.gltf, FBX'

export function animationFormat(fileName: string): AnimationFormat | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!match) return null
  return (ANIMATION_EXTENSIONS as readonly string[]).includes(match[1])
    ? (match[1] as AnimationFormat)
    : null
}

/** Files that are animation-only, so a drop routes to the animation tab. */
export function isAnimationOnlyFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.anim')
}

// ------------------------------------------------------------------ channels

interface Curve {
  times: number[]
  values: number[]
}

interface Channels {
  position: (Curve | null)[]
  /** Euler radians. */
  rotation: (Curve | null)[]
  /** Quaternion x, y, z, w. */
  quaternion: (Curve | null)[]
  scale: (Curve | null)[]
}

interface ChannelEntry {
  path: string
  channels: Channels
}

function emptyChannels(): Channels {
  return {
    position: [null, null, null],
    rotation: [null, null, null],
    quaternion: [null, null, null, null],
    scale: [null, null, null],
  }
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/

const numberAfter = (line: string, key: string): number | null => {
  const match = new RegExp(`^\\s*${key}:\\s*(${NUMBER.source})`).exec(line)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function sampleCurve(curve: Curve, time: number): number {
  const times = curve.times
  const values = curve.values
  if (values.length === 0) return 0
  if (values.length === 1 || time <= times[0]) return values[0]
  const last = times.length - 1
  if (time >= times[last]) return values[last]
  let low = 0
  let high = last
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (times[mid] <= time) low = mid
    else high = mid
  }
  const span = times[high] - times[low]
  if (span <= 1e-6) return values[high]
  const ratio = (time - times[low]) / span
  return values[low] + (values[high] - values[low]) * ratio
}

const anyChannel = (curves: (Curve | null)[]) => curves.some((curve) => curve !== null)

/** All key times of a channel set, deduplicated and thinned to the key budget. */
function unionTimes(channels: Channels): number[] {
  const seen = new Set<number>()
  const times: number[] = []
  const add = (curve: Curve | null) => {
    if (!curve) return
    for (const time of curve.times) {
      const rounded = Math.round(time * 1000) / 1000
      if (seen.has(rounded)) continue
      seen.add(rounded)
      times.push(rounded)
    }
  }
  for (const curve of channels.position) add(curve)
  for (const curve of channels.rotation) add(curve)
  for (const curve of channels.quaternion) add(curve)
  for (const curve of channels.scale) add(curve)
  times.sort((a, b) => a - b)
  if (times.length <= MAX_ANIMATION_KEYS) return times
  const stride = Math.ceil(times.length / MAX_ANIMATION_KEYS)
  const thinned: number[] = []
  for (let i = 0; i < times.length; i += stride) thinned.push(times[i])
  const end = times[times.length - 1]
  if (thinned[thinned.length - 1] !== end) thinned.push(end)
  return thinned
}

const quaternion = new THREE.Quaternion()
const euler = new THREE.Euler()

function trackFromChannels(target: string, path: string, channels: Channels): AnimationTrack | null {
  const times = unionTimes(channels)
  if (times.length === 0) return null
  const hasPosition = anyChannel(channels.position)
  const hasScale = anyChannel(channels.scale)
  const hasQuaternion = anyChannel(channels.quaternion)
  const hasEuler = anyChannel(channels.rotation)
  if (!hasPosition && !hasScale && !hasQuaternion && !hasEuler) return null

  const keys: AnimationKey[] = []
  for (const time of times) {
    const key: AnimationKey = { time }
    if (hasPosition) {
      key.position = [
        sampleCurve(channels.position[0] ?? { times, values: [0] }, time),
        sampleCurve(channels.position[1] ?? { times, values: [0] }, time),
        sampleCurve(channels.position[2] ?? { times, values: [0] }, time),
      ]
    }
    if (hasQuaternion) {
      quaternion.set(
        sampleCurve(channels.quaternion[0] ?? { times, values: [0] }, time),
        sampleCurve(channels.quaternion[1] ?? { times, values: [0] }, time),
        sampleCurve(channels.quaternion[2] ?? { times, values: [0] }, time),
        sampleCurve(channels.quaternion[3] ?? { times, values: [1] }, time),
      )
      if (quaternion.lengthSq() > 1e-8) quaternion.normalize()
      euler.setFromQuaternion(quaternion, 'XYZ')
      key.rotation = [euler.x, euler.y, euler.z]
    } else if (hasEuler) {
      key.rotation = [
        sampleCurve(channels.rotation[0] ?? { times, values: [0] }, time),
        sampleCurve(channels.rotation[1] ?? { times, values: [0] }, time),
        sampleCurve(channels.rotation[2] ?? { times, values: [0] }, time),
      ]
    }
    if (hasScale) {
      key.scale = [
        sampleCurve(channels.scale[0] ?? { times, values: [1] }, time),
        sampleCurve(channels.scale[1] ?? { times, values: [1] }, time),
        sampleCurve(channels.scale[2] ?? { times, values: [1] }, time),
      ]
    }
    keys.push(key)
  }
  return {
    target,
    ...(path && path !== target ? { path } : {}),
    keys,
  }
}

const LAST_SEGMENT = /[^|/\\]+$/

function targetNameOf(path: string): string {
  const match = LAST_SEGMENT.exec(path)
  return (match ? match[0] : path).trim()
}

function buildTracks(entries: Map<string, ChannelEntry>): AnimationTrack[] {
  const tracks: AnimationTrack[] = []
  for (const entry of entries.values()) {
    if (tracks.length >= MAX_ANIMATION_TRACKS) break
    const target = targetNameOf(entry.path)
    if (!target) continue
    const track = trackFromChannels(target, entry.path, entry.channels)
    if (track) tracks.push(track)
  }
  return tracks
}

function entryFor(entries: Map<string, ChannelEntry>, path: string): ChannelEntry {
  const existing = entries.get(path)
  if (existing) return existing
  const created: ChannelEntry = { path, channels: emptyChannels() }
  entries.set(path, created)
  return created
}

// ------------------------------------------------------------- Unity .anim

interface UnityCurve {
  attribute: string
  path: string
  keys: { time: number; value: number }[]
}

interface UnityDocument {
  name: string
  sampleRate: number
  stopTime: number
  curves: UnityCurve[]
}

const YAML_HEADER = /^\s*(%YAML|---\s*!u!)/

/**
 * Reads the text-serialized `.anim` format Unity writes. Curves are collected
 * from `m_EditorCurves` (or the legacy `m_Curves`); every entry carries the
 * animated attribute and the transform path it drives.
 */
function parseUnityDocument(text: string): UnityDocument {
  if (!YAML_HEADER.test(text)) {
    throw new Error(
      'that .anim file is not text-serialized. In Unity open Project Settings → Editor → Asset Serialization and set Mode to Force Text, then re-save the clip.',
    )
  }
  const curves: UnityCurve[] = []
  let name = ''
  let sampleRate = 30
  let stopTime = 0
  let current: UnityCurve | null = null
  let currentKey: { time: number; value: number } | null = null
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    // A top-level property starts a new section; curves from an earlier section
    // must not swallow the keys of this one.
    if (/^ {2}[A-Za-z_][\w]*:/.test(line)) {
      current = null
      currentKey = null
    }

    const entry = /^(\s*)-\s*serializedVersion:\s*\d+/.exec(line)
    if (entry) {
      if (entry[1].length <= 3) {
        current = { attribute: '', path: '', keys: [] }
        curves.push(current)
        currentKey = null
      } else if (current) {
        currentKey = { time: 0, value: 0 }
        current.keys.push(currentKey)
      }
      continue
    }

    if (currentKey) {
      const time = numberAfter(line, 'time')
      if (time !== null) {
        currentKey.time = time
        continue
      }
      const value = numberAfter(line, 'value')
      if (value !== null) {
        currentKey.value = value
        continue
      }
    }

    if (current) {
      const attribute = /^\s*attribute:\s*(\S+)/.exec(line)
      if (attribute) {
        current.attribute = attribute[1].trim()
        continue
      }
      const path = /^\s*path:\s*(.*)$/.exec(line)
      if (path) {
        current.path = path[1].trim()
        continue
      }
    }

    if (!name) {
      const clipName = /^ {2}m_Name:\s*(.+)$/.exec(line)
      if (clipName) name = clipName[1].trim()
    }
    const rate = numberAfter(line, 'm_SampleRate')
    if (rate !== null) sampleRate = rate
    const stop = numberAfter(line, 'm_StopTime')
    if (stop !== null) stopTime = stop
  }

  return { name, sampleRate, stopTime, curves }
}

const AXES: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 }

function unityChannels(curves: UnityCurve[]): Map<string, ChannelEntry> {
  const entries = new Map<string, ChannelEntry>()
  for (const curve of curves) {
    if (!curve.attribute || curve.keys.length === 0) continue
    const keys = curve.keys.filter(
      (key) => Number.isFinite(key.time) && Number.isFinite(key.value) && key.time >= 0,
    )
    if (keys.length === 0) continue
    const channel: Curve = {
      times: keys.map((key) => key.time),
      values: keys.map((key) => key.value),
    }
    const entry = entryFor(entries, curve.path)
    const position = /m_LocalPosition\.([xyzw])/i.exec(curve.attribute)
    if (position) {
      entry.channels.position[AXES[position[1].toLowerCase()]] = channel
      continue
    }
    const localQuaternion = /m_LocalRotation\.([xyzw])/i.exec(curve.attribute)
    if (localQuaternion) {
      entry.channels.quaternion[AXES[localQuaternion[1].toLowerCase()]] = channel
      continue
    }
    const localScale = /m_LocalScale\.([xyzw])/i.exec(curve.attribute)
    if (localScale) {
      entry.channels.scale[AXES[localScale[1].toLowerCase()]] = channel
      continue
    }
    // Unity stores euler curves in degrees; the project keeps radians.
    const localEuler = /EulerAngles?Raw?\.([xyz])/i.exec(curve.attribute)
    if (localEuler) {
      entry.channels.rotation[AXES[localEuler[1].toLowerCase()]] = {
        times: channel.times,
        values: channel.values.map((value) => (value * Math.PI) / 180),
      }
      continue
    }
    // Blend-shape, material and event curves have no node transform to drive.
  }
  return entries
}

export function parseUnityAnim(text: string, fileName: string): AnimationClipData[] {
  const document = parseUnityDocument(text)
  const tracks = buildTracks(unityChannels(document.curves))
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || 'Clip'
  if (tracks.length === 0) {
    throw new Error(
      `"${fileName}" has no transform curves Shredder can play. Clips that only animate blend shapes or materials cannot drive a model here.`,
    )
  }
  let end = 0
  for (const track of tracks) {
    const last = track.keys[track.keys.length - 1]
    if (last.time > end) end = last.time
  }
  const duration = document.stopTime > 0 ? document.stopTime : end
  return [
    {
      id: uid('clip'),
      name: document.name || baseName,
      duration: Math.min(MAX_ANIMATION_DURATION, Math.max(0.1, duration)),
      fps: Math.min(240, Math.max(1, Math.round(document.sampleRate) || 30)),
      source: 'unity',
      file: fileName,
      tracks,
    },
  ]
}

// ------------------------------------------------------- glTF / FBX clips

type LoadedClip = THREE.AnimationClip

function clipsFromThree(
  animations: LoadedClip[],
  source: AnimationSource,
  fileName: string,
): AnimationClipData[] {
  const clips: AnimationClipData[] = []
  for (const animation of animations) {
    const entries = new Map<string, ChannelEntry>()
    for (const track of animation.tracks) {
      const match = /^(.*)\.(position|quaternion|scale)$/.exec(track.name)
      if (!match) continue
      const path = match[1].trim()
      if (!path) continue
      const size = track.getValueSize()
      const values = track.values
      const times = Array.from(track.times)
      if (times.length === 0) continue
      const entry = entryFor(entries, path)
      const channels: (Curve | null)[] =
        match[2] === 'position'
          ? entry.channels.position
          : match[2] === 'scale'
            ? entry.channels.scale
            : entry.channels.quaternion
      const stride = match[2] === 'quaternion' ? Math.max(4, size) : Math.max(3, size)
      for (let axis = 0; axis < channels.length; axis += 1) {
        if (axis >= stride) break
        const curve: Curve = { times: [], values: [] }
        for (let i = 0; i < times.length; i += 1) {
          const value = values[i * stride + axis]
          if (!Number.isFinite(value)) continue
          curve.times.push(times[i])
          curve.values.push(value)
        }
        if (curve.values.length > 0) channels[axis] = curve
      }
    }

    const tracks = buildTracks(entries)
    if (tracks.length === 0) continue
    let end = 0
    for (const track of tracks) {
      const last = track.keys[track.keys.length - 1]
      if (last.time > end) end = last.time
    }
    const duration = animation.duration > 0 ? animation.duration : end
    clips.push({
      id: uid('clip'),
      name: animation.name?.trim() || fileName.replace(/\.[^.]+$/, '') || 'Clip',
      duration: Math.min(MAX_ANIMATION_DURATION, Math.max(0.1, duration)),
      fps: 30,
      source,
      file: fileName,
      tracks,
    })
  }
  return clips
}

async function readModelClips(
  buffer: ArrayBuffer,
  fileName: string,
  format: AnimationFormat,
): Promise<AnimationClipData[]> {
  if (format === 'glb' || format === 'gltf') {
    const source = format === 'gltf' ? new TextDecoder().decode(buffer) : buffer
    const gltf = await new GLTFLoader().parseAsync(source, '')
    return clipsFromThree(gltf.animations ?? [], 'gltf', fileName)
  }
  if (format === 'fbx') {
    const group = new FBXLoader().parse(buffer, '')
    return clipsFromThree(group.animations ?? [], 'fbx', fileName)
  }
  return []
}

/**
 * Reads every clip inside one file. Throws with an actionable message when the
 * file has no animation data, so the panel can tell the user what to change.
 */
export async function importAnimationFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<AnimationClipData[]> {
  const format = animationFormat(fileName)
  if (!format) {
    throw new Error(`Shredder cannot read animations from "${fileName}". Use ${ANIMATION_LABEL}.`)
  }
  if (format === 'anim') {
    const text = new TextDecoder().decode(buffer)
    return parseUnityAnim(text, fileName)
  }
  const clips = await readModelClips(buffer, fileName, format)
  if (clips.length === 0) {
    throw new Error(
      `"${fileName}" contains no animation clips. Export the action from Blender with Animation and Skinning enabled (FBX or glTF), or pick the Unity .anim clip instead.`,
    )
  }
  return clips
}
