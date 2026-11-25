/**
 * Headless check that a generated character exports as a real skinned mesh:
 * bones, JOINTS_0/WEIGHTS_0 and the Idle/Walk animation clips.
 * Usage: node scripts/rig-test.mjs   (works under bun too)
 */
import { createCharacter, newProject, presetSpec } from '../src/blend/doc.ts'
import { buildExportScene } from '../src/three/rig.ts'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// The exporter reads Blobs through FileReader, which Node does not provide.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
        this.onloadend?.()
      })
    }
  }
}

const failures = []
const check = (condition, label) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

const doc = newProject('Rig test.blend')
const spec = presetSpec('Hero')
const { group, parts } = createCharacter(doc, spec, 'Hero')
doc.objects.push(group, ...parts)

const { scene, animations } = buildExportScene(doc)
const exporter = new GLTFExporter()
const glb = await exporter.parseAsync(scene, { binary: true, animations })
const buffer = Buffer.from(glb)

check(buffer.toString('utf8', 0, 4) === 'glTF', 'GLB magic')
const jsonLength = buffer.readUInt32LE(12)
const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))

const skins = json.skins ?? []
check(skins.length === 1, `one skin (${skins.length})`)
const joints = skins[0]?.joints ?? []
check(joints.length === 19, `19 joints (${joints.length})`)
const jointNames = joints.map((index) => json.nodes[index]?.name ?? '')
check(
  jointNames.filter((name) => name.startsWith('Rig_Hero_')).length === joints.length,
  'joint nodes are named Rig_Hero_*',
)
const inverseBind = skins[0]?.inverseBindMatrices
check(
  typeof inverseBind === 'number' && json.accessors[inverseBind]?.count === joints.length,
  'inverse bind matrices for every joint',
)

const skinnedPrimitives = []
for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    const attributes = primitive.attributes ?? {}
    if (attributes.JOINTS_0 !== undefined || attributes.WEIGHTS_0 !== undefined) {
      skinnedPrimitives.push({ mesh: mesh.name, attributes })
    }
  }
}
check(skinnedPrimitives.length > 0, `skinned primitives (${skinnedPrimitives.length})`)
check(
  skinnedPrimitives.every(
    ({ attributes }) =>
      attributes.JOINTS_0 !== undefined && attributes.WEIGHTS_0 !== undefined,
  ),
  'every skinned primitive has JOINTS_0 + WEIGHTS_0',
)
const positionCount = skinnedPrimitives[0]
  ? json.accessors[skinnedPrimitives[0].attributes.POSITION].count
  : -1
const jointCount = skinnedPrimitives[0]
  ? json.accessors[skinnedPrimitives[0].attributes.JOINTS_0].count
  : -2
check(positionCount === jointCount, `joint attribute covers every vertex (${jointCount})`)

check(animations.length === 2, `two clips (${animations.length})`)
const names = (json.animations ?? []).map((animation) => animation.name)
check(
  names.some((name) => name.endsWith('Idle')) && names.some((name) => name.endsWith('Walk')),
  `clip names: ${names.join(', ')}`,
)
const jointSet = new Set(joints)
const channels = (json.animations ?? []).flatMap((animation) => animation.channels ?? [])
check(channels.length > 0, `animation channels (${channels.length})`)
check(
  channels.every((channel) => jointSet.has(channel.target?.node)),
  'every animation channel targets a joint',
)

const skinnedMeshes = (json.meshes ?? []).filter((mesh) =>
  mesh.primitives.some((primitive) => primitive.attributes.JOINTS_0 !== undefined),
)
check(skinnedMeshes.length === 1, `one mesh carries the skin (${skinnedMeshes.length})`)

// Material groups share one attribute buffer, so read the primitive's indices
// to find which vertex belongs to the head part.
const binStart = 20 + jsonLength + 8
const COMPONENT_SIZE = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
function accessorOffset(accessorIndex) {
  const accessor = json.accessors[accessorIndex]
  const view = json.bufferViews[accessor.bufferView]
  return {
    accessor,
    view,
    offset: binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
  }
}
function readIndex(accessorIndex) {
  const { accessor, offset } = accessorOffset(accessorIndex)
  if (accessor.componentType === 5121) return buffer.readUInt8(offset)
  if (accessor.componentType === 5123) return buffer.readUInt16LE(offset)
  if (accessor.componentType === 5125) return buffer.readUInt32LE(offset)
  throw new Error(`unsupported index type ${accessor.componentType}`)
}
function readVertexComponent(accessorIndex, vertexIndex, component = 0) {
  const { accessor, view, offset } = accessorOffset(accessorIndex)
  const size = COMPONENT_SIZE[accessor.componentType]
  const stride = view.byteStride ?? size * 4
  const at = offset + vertexIndex * stride + component * size
  if (accessor.componentType === 5123) return buffer.readUInt16LE(at)
  if (accessor.componentType === 5126) return buffer.readFloatLE(at)
  throw new Error(`unsupported component type ${accessor.componentType}`)
}
const headJoint = jointNames.indexOf('Rig_Hero_Head')
const heroMesh = skinnedMeshes[0]
const headPrimitive = heroMesh?.primitives.find(
  (primitive) => json.materials[primitive.material]?.name === 'Head',
)
check(Boolean(headPrimitive), 'head part kept its own material')
const headVertex = headPrimitive ? readIndex(headPrimitive.indices) : -1
check(
  Boolean(headPrimitive) &&
    readVertexComponent(headPrimitive.attributes.JOINTS_0, headVertex) === headJoint,
  'head vertices are weighted to the head bone',
)
check(
  Boolean(headPrimitive) && readVertexComponent(headPrimitive.attributes.WEIGHTS_0, headVertex) === 1,
  'head vertex weight is 1.0',
)

console.log(`\nGLB size: ${(buffer.length / 1024).toFixed(0)} kB`)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('skeleton export OK')
