// Exercises the model importers end to end: parse a fixture per format, turn
// it into project objects, then round-trip the packed geometry through JSON the
// same way a saved project does.
//
//   bun scripts/model-import-test.mjs
import assert from 'node:assert/strict'
import { normalizeProject } from '../src/blend/doc.ts'
import { base64ToBytes, decodeMesh } from '../src/blend/mesh.ts'
import { glbBaseColorTextures } from '../src/three/textures.ts'
import { importModel } from '../src/three/modelImport.ts'

const encoder = new TextEncoder()
const checks = []
function check(condition, message) {
  assert.ok(condition, message)
  checks.push(message)
}

function bufferOf(text) {
  return encoder.encode(text).buffer
}

const OBJ = `# a flat quad, as Blender's OBJ exporter writes it
o Panel
v -1 0 1
v 1 0 1
v 1 2 1
v -1 2 1
vn 0 0 1
f 1//1 2//1 3//1 4//1
`

const STL = `solid quad
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 2 0 0
    vertex 0 3 0
  endloop
endfacet
endsolid quad
`

const PLY = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`

const DXF = `0
SECTION
2
ENTITIES
0
3DFACE
8
0
10
0.0
20
0.0
30
0.0
11
3.0
21
0.0
31
0.0
12
0.0
22
2.0
32
0.0
13
0.0
23
2.0
33
0.0
0
ENDSEC
0
EOF
`

/** Assembles a GLB container from a glTF JSON document and its binary chunk. */
function buildGlb(json, bin) {
  const jsonBytes = encoder.encode(JSON.stringify(json))
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4
  const jsonChunk = new Uint8Array(jsonBytes.length + jsonPadding)
  jsonChunk.set(jsonBytes)
  jsonChunk.fill(0x20, jsonBytes.length)

  const total = 12 + 8 + jsonChunk.length + 8 + bin.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonChunk.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(jsonChunk, 20)
  const binHeader = 20 + jsonChunk.length
  view.setUint32(binHeader, bin.length, true)
  view.setUint32(binHeader + 4, 0x004e4942, true)
  out.set(bin, binHeader + 8)
  return out.buffer
}

/** A minimal single-triangle GLB, the shape Shredder's own export produces. */
function glbFixture() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const indices = new Uint16Array([0, 1, 2])
  const positionBytes = new Uint8Array(positions.buffer)
  const indexBytes = new Uint8Array(indices.buffer)
  const positionLength = positionBytes.length
  const bin = new Uint8Array(positionLength + indexBytes.length + ((4 - (indexBytes.length % 4)) % 4))
  bin.set(positionBytes, 0)
  bin.set(indexBytes, positionLength)

  const json = {
    asset: { version: '2.0', generator: 'Shredder test' },
    scene: 0,
    scenes: [{ nodes: [1] }],
    nodes: [
      { mesh: 0, name: 'Triangle' },
      { name: 'Pivot', children: [0], translation: [5, 0, 0] },
    ],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      { name: 'Paint', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.2, 1], metallicFactor: 0.2 } },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionLength, target: 34962 },
      { buffer: 0, byteOffset: positionLength, byteLength: indexBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  }

  return buildGlb(json, bin)
}

/** 1x1 PNG, used as an embedded glTF base-colour image. */
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** A GLB whose material carries an embedded PNG as its base-colour map. */
function texturedGlbFixture() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1])
  const indices = new Uint16Array([0, 1, 2])
  const segments = [
    { bytes: new Uint8Array(positions.buffer), target: 34962 },
    { bytes: new Uint8Array(uvs.buffer), target: 34962 },
    { bytes: new Uint8Array(indices.buffer), target: 34963 },
    { bytes: PNG_BYTES, target: null },
  ]

  const views = []
  const chunks = []
  let offset = 0
  for (const segment of segments) {
    const padding = (4 - (offset % 4)) % 4
    if (padding > 0) {
      chunks.push(new Uint8Array(padding))
      offset += padding
    }
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: segment.bytes.length,
      ...(segment.target ? { target: segment.target } : {}),
    })
    chunks.push(segment.bytes)
    offset += segment.bytes.length
  }
  const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4))
  let cursor = 0
  for (const chunk of chunks) {
    bin.set(chunk, cursor)
    cursor += chunk.byteLength
  }

  const json = {
    asset: { version: '2.0', generator: 'Shredder test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Textured' }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'Painted',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  }
  return buildGlb(json, bin)
}

const fixtures = [
  { name: 'Panel.obj', data: bufferOf(OBJ), minimumTriangles: 2 },
  { name: 'Quad.stl', data: bufferOf(STL), minimumTriangles: 1 },
  { name: 'Tri.ply', data: bufferOf(PLY), minimumTriangles: 1 },
  { name: 'Face.dxf', data: bufferOf(DXF), minimumTriangles: 1 },
  { name: 'Triangle.glb', data: glbFixture(), minimumTriangles: 1 },
]

const imported = []
for (const fixture of fixtures) {
  const result = await importModel(fixture.data, fixture.name)
  const root = result.objects.find((object) => object.id === result.rootId)
  check(root && root.kind === 'group', `${fixture.name}: wrapper group created`)
  check(
    result.summary.triangles >= fixture.minimumTriangles,
    `${fixture.name}: ${result.summary.triangles} triangles imported`,
  )
  check(result.summary.meshes >= 1, `${fixture.name}: mesh object created`)

  const meshes = result.objects.filter((object) => object.kind === 'mesh')
  check(meshes.length === result.summary.meshes, `${fixture.name}: every mesh is a project object`)
  check(root.parentId === null, `${fixture.name}: wrapper group sits at the top level`)
  for (const mesh of meshes) {
    check(Boolean(mesh.parentId), `${fixture.name}: ${mesh.name} is linked into the hierarchy`)
  }
  for (const mesh of meshes) {
    assert.ok(mesh.mesh, `${fixture.name}: ${mesh.name} has a geometry payload`)
    const decoded = decodeMesh(mesh.mesh)
    check(
      decoded.indices.length === mesh.mesh.triangles * 3,
      `${fixture.name}: ${mesh.name} geometry decodes to ${mesh.mesh.triangles} triangles`,
    )
    check(decoded.positions.length === mesh.mesh.vertices * 3, `${fixture.name}: vertex count matches`)
    check(
      decoded.normals.every((value) => Number.isFinite(value)),
      `${fixture.name}: normals are finite`,
    )
  }
  imported.push(result)
}

// Placement must rest the model on the ground plane and centre it, otherwise a
// centimetre FBX lands under the grid or off screen.
for (const [index, result] of imported.entries()) {
  const root = result.objects.find((object) => object.id === result.rootId)
  assert.ok(root)
  check(Number.isFinite(root.position[1]), `${fixtures[index].name}: wrapper position is numeric`)
  check(result.summary.unitScale > 0, `${fixtures[index].name}: unit scale recorded`)
}

// A translated parent node must stay translated exactly once (regression: the
// geometry used to bake its world matrix and keep the node transform too).
const pivot = imported[4].objects.find((object) => object.kind === 'group' && object.name === 'Pivot')
check(Boolean(pivot), 'glTF parent node becomes a group')
check(Math.abs((pivot?.position[0] ?? 0) - 5) < 1e-4, 'nested node keeps its local translation once')
const nestedMesh = imported[4].objects.find((object) => object.kind === 'mesh')
check(nestedMesh?.parentId === pivot?.id, 'nested mesh is linked to its parent group')
check(
  Math.abs(nestedMesh?.position[0] ?? 99) < 1e-4,
  'nested mesh keeps a local transform instead of a baked one',
)

// Colour survives the importer (glTF base colour factor).
const glbMeshes = imported[4].objects.filter((object) => object.kind === 'mesh')
const glbColor = glbMeshes[0]?.color ?? ''
const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(glbColor)
check(Boolean(channels), 'glTF material colour stored as a hex colour')
check(
  channels && parseInt(channels[1], 16) > parseInt(channels[2], 16),
  'glTF red base colour mapped onto the mesh material',
)

// A textured glTF keeps its image: bytes are copied into the project itself.
const packedTextures = glbBaseColorTextures(texturedGlbFixture())
const packedTexture = packedTextures.get(0)
check(packedTextures.size === 1, 'glTF base colour texture found on its material')
assert.ok(packedTexture, 'the material has a packed base colour image')
check(
  packedTexture.url.startsWith('data:image/png;base64,'),
  'base colour image packed as a self-contained data URL',
)
check(packedTexture.flipY === false, 'glTF image keeps its top-down sampling')
const packedBytes = base64ToBytes(packedTexture.url.split(',')[1])
check(
  Buffer.compare(Buffer.from(packedBytes), Buffer.from(PNG_BYTES)) === 0,
  'packed image bytes match the file byte for byte',
)

const texturedDocument = normalizeProject({
  format: 'shredder',
  version: 1,
  name: 'textured.blend',
  objects: [
    {
      ...nestedMesh,
      mesh: { ...nestedMesh.mesh, baseColor: packedTexture.url, baseColorFlipY: false },
    },
  ],
  camera: { position: [3, 2, 4], target: [0, 1, 0] },
  createdAt: 1,
  updatedAt: 2,
})
assert.ok(texturedDocument, 'project with a packed texture normalizes')
const savedTexture = texturedDocument.objects.find((object) => object.kind === 'mesh')?.mesh
check(savedTexture?.baseColor === packedTexture.url, 'project keeps the packed base colour texture')
check(savedTexture?.baseColorFlipY === false, 'project keeps the texture sampling flip')

const externalTexture = normalizeProject({
  format: 'shredder',
  version: 1,
  name: 'external.blend',
  objects: [
    { ...nestedMesh, mesh: { ...nestedMesh.mesh, baseColor: 'https://example.com/paint.png' } },
  ],
  camera: { position: [3, 2, 4], target: [0, 1, 0] },
  createdAt: 1,
  updatedAt: 2,
})
check(
  externalTexture?.objects[0]?.mesh?.baseColor === undefined,
  'a project never points its texture at an external file',
)

// A saved project must reopen with its geometry intact.
const glb = imported[4]
const document = normalizeProject({
  format: 'shredder',
  version: 1,
  name: 'triangle.blend',
  objects: glb.objects,
  camera: { position: [3, 2, 4], target: [0, 1, 0] },
  createdAt: 1,
  updatedAt: 2,
})
assert.ok(document, 'project with imported geometry normalizes')
check(document.objects.length === glb.objects.length, 'project keeps every imported object')
const savedMeshes = document.objects.filter((object) => object.kind === 'mesh')
check(savedMeshes.length === glbMeshes.length, 'project keeps imported meshes')
check(
  savedMeshes.every((object) => object.mesh && decodeMesh(object.mesh).indices.length > 0),
  'saved imported geometry reloads and decodes',
)

// Pre-rename projects must still open after the rename.
const legacy = normalizeProject({ ...document, format: 'miniblend' })
check(legacy !== null, 'projects saved as miniblend still open')

// Unknown extensions are rejected with a useful message.
let rejected = false
try {
  await importModel(bufferOf('nope'), 'model.docx')
} catch (error) {
  rejected = /cannot read/i.test(error.message)
}
check(rejected, 'unsupported extensions are rejected')

console.log(`model import OK: ${checks.length} checks, ${fixtures.length} formats`)
