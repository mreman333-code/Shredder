/**
 * Shared tool catalogue for the Shredder AI bridge and MCP server.
 * The Electron main process serves these, the MCP server lists the same set,
 * and the renderer implements them against the live document.
 */
const TOOLS = [
  {
    name: 'get_scene',
    description:
      'Read the open project: file name, every object (name, kind, parent, transform, material) and the selected object. Call this before editing so you know real object names.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_files',
    description: 'List project files and folders. In the desktop app these are real .blend files in the Shredder library on disk; the browser preview uses browser storage.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_file',
    description: 'Open a project file by name (for example "Runner.blend"), id, or absolute path on disk. Also accepts a path the user saved elsewhere, which is then tracked in the library.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'File name or id' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_model',
    description:
      'Import a 3D model file into the open project from an absolute path. Accepts GLB, glTF, FBX, OBJ, Collada (.dae), 3DS, STL, PLY, 3MF and DXF, plus Blender .blend archives when Blender is installed. The file hierarchy comes in as groups, meshes keep every material, colour and base-colour texture (packed into the project), and rigged meshes keep their bind skeleton. Returns the imported root name, mesh count, triangle count and bone count.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path of the model file' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_character',
    description:
      'Add a procedural humanoid rig to the scene. Returns the new group name, position and part count.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['Hero', 'Runner', 'Vanguard', 'Scout', 'Automaton'] },
        name: { type: 'string', description: 'Optional group name' },
        height: { type: 'number', description: 'Metres, 1.3 - 2.2' },
        build: { type: 'number', description: '0.7 - 1.45' },
        headSize: { type: 'number', description: '0.75 - 1.35' },
        legLength: { type: 'number', description: '0.85 - 1.2' },
        colors: {
          type: 'object',
          properties: {
            suit: { type: 'string' },
            accent: { type: 'string' },
            skin: { type: 'string' },
            boots: { type: 'string' },
            visor: { type: 'string' },
          },
          additionalProperties: false,
        },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_character',
    description:
      'Change proportions or palette of an existing rig. Regenerates its 22 primitive parts live. Pass target or select a rig first.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Rig group name; defaults to the current selection' },
        height: { type: 'number' },
        build: { type: 'number' },
        headSize: { type: 'number' },
        legLength: { type: 'number' },
        colors: {
          type: 'object',
          properties: {
            suit: { type: 'string' },
            accent: { type: 'string' },
            skin: { type: 'string' },
            boots: { type: 'string' },
            visor: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'transform_object',
    description: 'Set the local position, rotation (radians) or scale of an object by name.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'select_object',
    description: 'Select an object by name so the user sees the outline and transform gizmo.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_primitive',
    description: 'Add a primitive mesh to the scene.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane'],
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_object',
    description: 'Delete an object (and its children, for rigs) by name.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_file',
    description: 'Save the open project file to its .blend file on disk (or browser storage in the preview).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'export_glb',
    description:
      'Export the scene to GLB and return the file as base64 so the model can write it to disk. Characters export as one skinned mesh with a 19-bone skeleton, per-vertex weights and the "Idle" and "Walk" animation clips.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

module.exports = { TOOLS }
