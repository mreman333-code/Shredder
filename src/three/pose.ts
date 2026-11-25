import * as THREE from 'three'
import { sampleTrack, type AnimationKey, type AnimationTrack } from '../blend/animation'

/**
 * Rig pose maths for clip playback.
 *
 * A character's body parts are rigid primitives in group space, and each one is
 * bound to exactly one bone (see `blend/skeleton.ts`). Posing a clip therefore
 * means walking the bone chain and moving every part by the transform delta of
 * the bone that drives it: the same rigid result the GLB exporter produces.
 *
 * Imported clips rarely share this rig's rest pose, so only the change since the
 * clip's first key is applied; translations are clamped so a clip authored in
 * another unit scale cannot throw the model off screen.
 */
export interface PoseBone {
  /** Index of the parent bone, -1 for a root. Parents come before children. */
  parent: number
  /** Rest transform relative to the parent bone. */
  restLocal: THREE.Matrix4
  /** Rest transform in group space. */
  restWorld: THREE.Matrix4
  restWorldInverse: THREE.Matrix4
  track: AnimationTrack | null
  /** First key of the track: the pose the deltas are measured from. */
  reference: AnimationKey | null
}

export interface PoseResult {
  /** Animated world matrix of each bone, in group space. */
  worlds: THREE.Matrix4[]
  /** `world × restWorld⁻¹`: the rigid movement each bone applies to its parts. */
  deltas: THREE.Matrix4[]
}

const MAX_OFFSET = 0.4

export function poseBones(bones: PoseBone[], time: number): PoseResult {
  const identity = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const offset = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const restRotation = new THREE.Quaternion()
  const unitScale = new THREE.Vector3(1, 1, 1)
  const keyEuler = new THREE.Euler()
  const restEuler = new THREE.Euler()
  const worlds: THREE.Matrix4[] = []
  const deltas: THREE.Matrix4[] = []

  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index]
    const parentWorld = bone.parent >= 0 ? worlds[bone.parent] : identity

    if (bone.track) {
      const key = sampleTrack(bone.track, time)
      const reference = bone.reference ?? key
      const keyRotation = key.rotation ?? reference.rotation
      const rest = reference.rotation
      if (keyRotation && rest) {
        keyEuler.set(keyRotation[0], keyRotation[1], keyRotation[2])
        restEuler.set(rest[0], rest[1], rest[2])
        rotation.setFromEuler(keyEuler)
        restRotation.setFromEuler(restEuler)
        rotation.multiply(restRotation.invert())
      } else {
        rotation.identity()
      }
      const keyPosition = key.position
      const restPosition = reference.position
      if (keyPosition && restPosition) {
        offset.set(
          Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, keyPosition[0] - restPosition[0])),
          Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, keyPosition[1] - restPosition[1])),
          Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, keyPosition[2] - restPosition[2])),
        )
      } else {
        offset.set(0, 0, 0)
      }
      // The delta is applied in the bone's own space, so limbs swing from their
      // joint instead of orbiting the parent bone.
      local.copy(bone.restLocal).multiply(
        new THREE.Matrix4().compose(offset, rotation, unitScale),
      )
    } else {
      local.copy(bone.restLocal)
    }

    const world = new THREE.Matrix4().multiplyMatrices(parentWorld, local)
    worlds.push(world)
    deltas.push(new THREE.Matrix4().copy(world).multiply(bone.restWorldInverse))
  }

  return { worlds, deltas }
}
