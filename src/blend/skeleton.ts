import type { CharacterSpec, Vec3 } from './doc'

/**
 * Anatomy of a generated character, derived from the same proportions as
 * `characterParts` so bones land on the joints of the primitive body.
 * Positions are local to the character group; a binding name can be used as-is
 * by the viewport (live bones) and by the GLB exporter (skinning).
 */
export interface BoneDef {
  /** Short key, unique inside one character, e.g. "Hips" or "Thigh_L". */
  key: string
  parent: string | null
  /** Rest position in character space (the space part positions are expressed in). */
  position: Vec3
}

export interface SkeletonDef {
  bones: BoneDef[]
  /** Part name -> bone key. Parts are rigid, so each one is bound to one bone. */
  bindings: Record<string, string>
}

const PART_BINDINGS: Record<string, string> = {
  'Foot L': 'Foot_L',
  'Shin L': 'Shin_L',
  'Thigh L': 'Thigh_L',
  'Shoulder L': 'Shoulder_L',
  'Upper Arm L': 'UpperArm_L',
  'Forearm L': 'Forearm_L',
  'Hand L': 'Hand_L',
  'Foot R': 'Foot_R',
  'Shin R': 'Shin_R',
  'Thigh R': 'Thigh_R',
  'Shoulder R': 'Shoulder_R',
  'Upper Arm R': 'UpperArm_R',
  'Forearm R': 'Forearm_R',
  'Hand R': 'Hand_R',
  Pelvis: 'Hips',
  Belt: 'Hips',
  Torso: 'Chest',
  'Chest Plate': 'Chest',
  Neck: 'Neck',
  Head: 'Head',
  Face: 'Head',
  Helmet: 'Head',
  Visor: 'Head',
}

/**
 * Rest skeleton for a character spec. Mirrors the maths in `characterParts`
 * (height/build/leg scaling), so the bones follow proportion changes.
 */
export function characterSkeleton(spec: CharacterSpec): SkeletonDef {
  const s = spec.height / 1.8
  const b = spec.build
  const leg = spec.legLength
  const hipBase = 0.81
  const upperShift = hipBase * (leg - 1)

  const legY = (v: number) => v * leg * s
  const upY = (v: number) => (v + upperShift) * s
  const X = (v: number) => v * b * s
  const Y = (v: number) => v * s

  const bones: BoneDef[] = [
    { key: 'Hips', parent: null, position: [0, upY(0.92), 0] },
    { key: 'Spine', parent: 'Hips', position: [0, upY(1.06), 0] },
    { key: 'Chest', parent: 'Spine', position: [0, upY(1.22), 0] },
    { key: 'Neck', parent: 'Chest', position: [0, upY(1.5), 0] },
    { key: 'Head', parent: 'Neck', position: [0, upY(1.59), 0] },
  ]

  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? 'L' : 'R'
    bones.push(
      {
        key: `Shoulder_${suffix}`,
        parent: 'Chest',
        position: [X(0.2) * side, upY(1.43), 0],
      },
      {
        key: `UpperArm_${suffix}`,
        parent: `Shoulder_${suffix}`,
        position: [X(0.31) * side, upY(1.38), 0],
      },
      {
        key: `Forearm_${suffix}`,
        parent: `UpperArm_${suffix}`,
        position: [X(0.34) * side, upY(1.14), 0],
      },
      {
        key: `Hand_${suffix}`,
        parent: `Forearm_${suffix}`,
        position: [X(0.34) * side, upY(0.95), 0],
      },
      {
        key: `Thigh_${suffix}`,
        parent: 'Hips',
        position: [X(0.12) * side, upY(0.86), 0],
      },
      {
        key: `Shin_${suffix}`,
        parent: `Thigh_${suffix}`,
        position: [X(0.12) * side, legY(0.45), 0],
      },
      {
        key: `Foot_${suffix}`,
        parent: `Shin_${suffix}`,
        position: [X(0.12) * side, Y(0.1), 0],
      },
    )
  }

  return { bones, bindings: { ...PART_BINDINGS } }
}

/** Bone key that drives a character part, defaulting to the hips. */
export function boneForPart(skeleton: SkeletonDef, partName: string): string {
  return skeleton.bindings[partName] ?? 'Hips'
}

export const CLIP_NAMES = ['Idle', 'Walk'] as const
