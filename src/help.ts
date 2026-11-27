/**
 * Built-in help content for the Shredder guide.
 *
 * The guide is deliberately offline and read-only: it answers questions from
 * this fixed knowledge base, so it needs no account, key or network and can
 * never change the project.
 */

export interface HelpSuggestion {
  label: string
  question: string
}

export interface HelpTopic {
  id: string
  title: string
  /** Extra words and phrases that should find this topic. */
  keywords: string[]
  body: string
  /** Follow-up topics offered as chips after the answer. */
  next?: string[]
}

export interface HelpReply {
  text: string
  related: HelpSuggestion[]
  /** False when the question did not match a topic closely enough. */
  matched: boolean
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'out',
  'please',
  'should',
  'so',
  'some',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
])

const DEFAULT_FOLLOW_UPS = ['start', 'shortcuts', 'export-glb']

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'about',
    title: 'What Shredder is',
    keywords: ['what is shredder', 'about shredder', 'what does it do', 'overview', 'app for'],
    body:
      'Shredder is a desktop 3D character studio. You can:\n' +
      '• Import models made in Blender, Unity or other tools (glTF/GLB, FBX, OBJ and more).\n' +
      '• Build and recolour characters from ready-made presets.\n' +
      '• Arrange, move, rotate and scale objects in the viewport.\n' +
      '• Pose characters and inspect their skeletons.\n' +
      '• Save projects and export GLB models with materials, textures and animation clips.\n\n' +
      'Everything runs on your computer. No account or internet connection is needed for modelling.',
    next: ['start', 'import-model', 'characters'],
  },
  {
    id: 'start',
    title: 'Where to start',
    keywords: ['start', 'begin', 'first time', 'new', 'getting started', 'empty scene', 'basics'],
    body:
      'The fastest ways in:\n' +
      '• Import a model — File → Import Model… (GLB, glTF, FBX, OBJ…).\n' +
      '• Add a character — Add → Hero character, or open the Character tab.\n' +
      '• Add a shape — Add → Cube, Sphere and the rest.\n' +
      '• Open a project — File → Open Project… or the Files button.\n\n' +
      'When the scene is empty, the viewport shows the same choices as big buttons.\n\n' +
      'Click an object to select it, then use the Edit tab for exact position, rotation, scale and colour. Drag with the middle mouse button to orbit and use the wheel to zoom.',
    next: ['import-model', 'characters', 'transform'],
  },
  {
    id: 'import-model',
    title: 'Importing a model',
    keywords: [
      'import',
      'load model',
      'open model',
      'bring in model',
      'add model',
      'glb',
      'gltf',
      'fbx',
      'obj',
      'dae',
      'collada',
      'stl',
      'ply',
      '3ds',
      '3mf',
      'dxf',
    ],
    body:
      'Use File → Import Model… and pick the file. File → Open Project… also accepts models.\n\n' +
      'File → Import Animation… loads Unity .anim, glTF/GLB or FBX clips, and File → Import Image / Texture… maps a PNG or JPEG onto the selected model mesh. Both are also available in the Anim tab and the Edit tab.\n\n' +
      'Shredder imports:\n' +
      '• glTF and GLB (.glb, .gltf)\n' +
      '• Blender and Unity exports: FBX, OBJ, DAE (Collada)\n' +
      '• Other meshes: 3DS, STL, PLY, 3MF, DXF\n' +
      '• .blend archives (Blender must be installed)\n\n' +
      'The model arrives as editable scene objects: a group for the file, groups for its node hierarchy, and one object per mesh with its materials, colours and packed base-colour textures.\n\n' +
      'Z-up files are turned upright, centimetre or millimetre files are rescaled to metres, and the model is centred and dropped onto the ground.',
    next: ['textures', 'formats', 'model-scale'],
  },
  {
    id: 'formats',
    title: 'Supported file formats',
    keywords: [
      'formats',
      'file types',
      'extensions',
      'supported',
      'which files',
      'blend file',
      'unity',
      'blender export',
    ],
    body:
      'Models:\n' +
      '• .glb / .gltf — glTF, with packed textures\n' +
      '• .fbx, .obj, .dae — common Blender and Unity exports\n' +
      '• .3ds, .stl, .ply, .3mf, .dxf — other DCC and CAD meshes\n' +
      '• .blend — opened through Blender, which must be installed\n\n' +
      'Projects:\n' +
      '• .blend / .mblend — Shredder project files (JSON inside)\n\n' +
      'Exports:\n' +
      '• .glb — 3D model for game engines and viewers\n' +
      '• .mblend — portable copy of a Shredder project',
    next: ['import-model', 'export-glb', 'save-vs-export'],
  },
  {
    id: 'textures',
    title: 'Imported colours and textures',
    keywords: [
      'texture',
      'white',
      'is white',
      'shows white',
      'imports white',
      'grey',
      'colour',
      'color',
      'material',
      'uv',
      'image',
      'missing texture',
      'paint',
      'base colour',
      'base color',
    ],
    body:
      "Shredder packs each mesh's base-colour images into the project itself, so imported models keep their look without the original image files.\n\n" +
      '• glTF/GLB images are copied exactly as they are stored in the file.\n' +
      '• FBX, OBJ and Collada textures are converted once to a compact JPEG or PNG (up to 2048 px).\n' +
      '• A mesh with several materials keeps every material and its own image, not just the first.\n' +
      '• A texture is attached only when the mesh has UV coordinates.\n' +
      '• The material colour is kept as a tint and can be changed in the Edit tab.\n\n' +
      'To replace a model texture, select the mesh and use Image → Choose PNG/JPEG… in the Edit tab, or drop a picture onto the mesh in the viewport. The image must be packed into the project, so very large files are resized.\n\n' +
      'A saved project and an exported GLB both keep packed textures. Only base-colour maps are imported; normal, roughness and metallic maps are not.\n\n' +
      'If a model imports white, the source file probably has no embedded image or the mesh has no UVs. Re-export it as a GLB with textures embedded and import again.',
    next: ['troubleshoot-white', 'export-glb', 'formats'],
  },
  {
    id: 'characters',
    title: 'Adding a character',
    keywords: [
      'character',
      'preset',
      'hero',
      'runner',
      'vanguard',
      'scout',
      'automaton',
      'person',
      'humanoid',
      'rig',
      'avatar',
      'add a character',
      'new character',
      'create character',
    ],
    body:
      'Open the Character tab, or use Add → Hero character.\n\n' +
      'Pick one of the five presets — Hero, Runner, Vanguard, Scout or Automaton — then adjust:\n' +
      '• height and build\n' +
      '• head size and leg length\n' +
      '• suit, accent, skin, boots and visor colours\n\n' +
      'Click Add character to place it in the scene. A character is a group of body parts with a skeleton and Idle/Walk animation clips for GLB export.\n\n' +
      'Selecting the group in Object mode moves the whole person. Switch to Pose mode (Tab) to work on individual parts.',
    next: ['edit-character', 'pose', 'export-glb'],
  },
  {
    id: 'edit-character',
    title: 'Changing a character after adding it',
    keywords: [
      'edit character',
      'change character',
      'recolour',
      'recolor',
      'character colours',
      'proportions',
      'resize character',
      'customise',
    ],
    body:
      'Click the character group in the viewport or the Scene tab, then open the Character tab. The builder switches to live editing, so every slider and colour change updates that character in place.\n\n' +
      'The Edit tab shows the group transform and a button back to the character builder. Add copy to scene creates a second character from the same settings.\n\n' +
      'For individual limbs and parts, press Tab to enter Pose mode.',
    next: ['characters', 'pose', 'transform'],
  },
  {
    id: 'transform',
    title: 'Moving, rotating and scaling',
    keywords: [
      'move',
      'translate',
      'grab',
      'rotate',
      'spin',
      'scale',
      'resize',
      'size',
      'transform',
      'gizmo',
      'position',
      'drag',
      'location',
    ],
    body:
      'Select an object, then:\n' +
      '• G or the Move tool — drag the coloured arrows.\n' +
      '• R or the Rotate tool — drag the rings.\n' +
      '• S or the Scale tool — drag the boxes.\n' +
      '• Q or the Select tool — stop transforming.\n\n' +
      'For exact values use the Edit tab: Location, Rotation (in degrees) and Scale. Reset returns the object to the origin with no rotation and normal size.\n\n' +
      'View → Enable snapping makes the gizmo move in clean steps. Each drag is a single undo step.',
    next: ['selection', 'snapping', 'properties'],
  },
  {
    id: 'snapping',
    title: 'Snapping',
    keywords: ['snap', 'snapping', 'grid', 'steps', 'precision', 'align'],
    body:
      'Use View → Enable snapping to toggle it. While snapping is on, gizmo drags move in fixed steps instead of smoothly, which is handy for lining parts up.\n\n' +
      'For exact placement, type numbers into the Edit tab instead — those are never rounded.',
    next: ['transform', 'properties'],
  },
  {
    id: 'selection',
    title: 'Selecting objects and parts',
    keywords: [
      'select',
      'click',
      'pick',
      'object mode',
      'pose mode',
      'tab',
      'part',
      'group',
      'deselect',
    ],
    body:
      'Click a part in the viewport, or click its row in the Scene tab, to select that exact object. A character body part and a mesh inside an imported model are both selectable this way; select the parent group in the Scene tab when you want to move the whole thing.\n\n' +
      'Tab switches between Object and Pose mode. Esc clears the selection. Shift+D duplicates the selection; X or Delete removes it.',
    next: ['pose', 'groups', 'outliner'],
  },
  {
    id: 'pose',
    title: 'Posing a character',
    keywords: ['pose', 'bone', 'skeleton', 'joint', 'arm', 'leg', 'rig', 'show skeleton'],
    body:
      'Select a character, press Tab to enter Pose mode, then click a body part and use the Move, Rotate or Scale tools.\n\n' +
      'View → Show skeleton draws the bones over the mesh. Tab again returns to Object mode.\n\n' +
      'Poses are saved with the project, and the character body parts are kept when you export a GLB.',
    next: ['bones', 'characters', 'transform'],
  },
  {
    id: 'bones',
    title: "Seeing a character's skeleton",
    keywords: ['skeleton', 'bones', 'show bones', 'joints', 'rig display'],
    body:
      'Select a character and use View → Show skeleton (View → Hide skeleton turns it off). The bones are drawn over the mesh so you can see the rig.\n\n' +
      'Pose mode (Tab) is where you move the body parts; the skeleton display is a guide.',
    next: ['pose', 'selection'],
  },
  {
    id: 'views',
    title: 'Camera views and framing',
    keywords: [
      'camera',
      'view',
      'front',
      'side',
      'top',
      'perspective',
      'orbit',
      'zoom',
      'frame',
      'fit',
      'look',
      'middle mouse',
    ],
    body:
      'Orbit with the middle mouse button and zoom with the wheel.\n\n' +
      'The buttons at the top-right of the viewport jump to Front, Right, Top or a free User perspective. The keyboard keys are 1 (front), 3 (right), 7 (top) and 5 (user).\n\n' +
      'F frames the selected object. Frame zooms to the selection and All frames the whole scene.',
    next: ['transform', 'selection'],
  },
  {
    id: 'outliner',
    title: 'The Scene tab',
    keywords: [
      'outliner',
      'scene list',
      'hierarchy',
      'tree',
      'objects list',
      'scene tab',
      'rename',
      'visibility',
      'hide',
    ],
    body:
      'The Scene tab lists everything in the project as a tree. Characters and imported files appear as groups with their parts inside; use the arrow to expand them.\n\n' +
      '• Click a row to select.\n' +
      '• Double-click a name to rename.\n' +
      '• The eye button hides or shows an object.\n' +
      '• Duplicate and Delete at the bottom act on the current selection.\n\n' +
      'The number next to "Scene" is the object count.',
    next: ['groups', 'selection', 'properties'],
  },
  {
    id: 'properties',
    title: 'The Edit tab',
    keywords: [
      'properties',
      'edit tab',
      'inspector',
      'name',
      'material',
      'colour',
      'roughness',
      'metallic',
      'visible',
    ],
    body:
      'The Edit tab shows the selected object:\n' +
      '• Name and visibility.\n' +
      '• Location, Rotation and Scale, with exact number fields and Reset.\n' +
      '• Material: base colour, roughness and metallic.\n' +
      '• For imported meshes: triangles, vertices, bones, packed-texture status and source file.\n' +
      '• For characters: rig details and a shortcut to the character builder.\n\n' +
      'With nothing selected it shows scene totals and the main shortcuts.',
    next: ['transform', 'materials', 'outliner'],
  },
  {
    id: 'materials',
    title: "Changing an object's colour and finish",
    keywords: [
      'colour',
      'color',
      'paint',
      'material',
      'roughness',
      'metallic',
      'shiny',
      'matte',
      'base colour',
      'tint',
    ],
    body:
      "Select a mesh and open Edit → Material.\n\n" +
      '• Base color sets the flat colour and also tints any packed texture.\n' +
      '• Roughness goes from mirror-smooth at 0 to fully matte at 1.\n' +
      '• Metallic goes from plastic at 0 to metal at 1.\n\n' +
      'Changes are saved in the project and exported to GLB. To recolour a character, use the Character tab palette instead — that rebuilds the body parts.',
    next: ['properties', 'textures', 'export-glb'],
  },
  {
    id: 'duplicate-delete',
    title: 'Duplicating and deleting',
    keywords: ['duplicate', 'copy', 'delete', 'remove', 'shift d', 'x key', 'erase'],
    body:
      'Shift+D duplicates the selected object and offsets the copy slightly. A whole character or imported group comes with all of its parts.\n\n' +
      'X or Delete removes the selection. Both actions can be undone with Ctrl+Z.\n\n' +
      'The Scene tab also has Duplicate and Delete buttons at the bottom.',
    next: ['undo', 'selection', 'groups'],
  },
  {
    id: 'undo',
    title: 'Undo and redo',
    keywords: ['undo', 'redo', 'mistake', 'history', 'revert', 'ctrl z', 'go back'],
    body:
      'Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes. The curved arrows in the top bar do the same and grey out when there is nothing to undo.\n\n' +
      'History holds up to 80 steps per open project, and a whole gizmo drag counts as one step.\n\n' +
      'Separately, the AI tab can revert everything an AI session changed.',
    next: ['ai-panel', 'save'],
  },
  {
    id: 'save',
    title: 'Saving your project',
    keywords: ['save', 'autosave', 'ctrl s', 'store', 'keep', 'backup', 'write'],
    body:
      'Shredder autosaves the open project shortly after every change. Ctrl+S (or the save icon) writes it immediately.\n\n' +
      'In the desktop app projects are real files in Documents\\Shredder, and File → Save As… can put a copy anywhere. The Files button opens the project library, where you can make folders, rename, save copies and delete projects.\n\n' +
      'Ctrl+Shift+S is Save As. File → Export .mblend writes a portable copy of the project; Export GLB writes a 3D model.',
    next: ['files', 'save-vs-export', 'install'],
  },
  {
    id: 'files',
    title: 'The Files library',
    keywords: [
      'files',
      'library',
      'folder',
      'project list',
      'documents',
      'open project',
      'new file',
      'file browser',
      'where are my projects',
    ],
    body:
      'The Files button opens the project library. In the desktop app it lives in Documents\\Shredder and folders map to real subfolders.\n\n' +
      '• New File creates an empty project.\n' +
      '• New Folder organises projects.\n' +
      '• Click a project to open it.\n' +
      '• Save Copy As creates a separate copy.\n' +
      '• Import brings in a project or a model file.\n' +
      '• Append adds another project\'s objects to the open scene.\n' +
      '• Export writes .mblend or .glb where you choose.\n\n' +
      'Projects autosave, so switching files never loses work.',
    next: ['save', 'append', 'open-project'],
  },
  {
    id: 'save-vs-export',
    title: 'Save vs Save As vs Export',
    keywords: [
      'difference between save and export',
      'save as',
      'export project',
      'mblend',
      'blend file',
      'portable',
      'saving and exporting',
      'save and export',
      'save vs export',
      'export vs save',
      'saving',
      'exporting',
    ],
    body:
      'Saving (Ctrl+S) updates the current project in place. Save As creates a new project file and switches to it. Export .mblend writes a copy you can move to another computer; it is still a Shredder project.\n\n' +
      'Export .glb is different: it produces a 3D model for Blender, Unity, Unreal, three.js or any glTF viewer. It contains geometry, materials, packed textures and character animation clips, but not the Shredder editing history or scene layout metadata.',
    next: ['save', 'export-glb', 'engine'],
  },
  {
    id: 'export-glb',
    title: 'Exporting a GLB',
    keywords: [
      'export',
      'glb',
      'gltf',
      'unity',
      'unreal',
      'blender',
      'godot',
      'engine',
      'download model',
      'share model',
      'save model',
    ],
    body:
      'Click Export GLB in the top bar, or use File → Export .glb, then choose where to save.\n\n' +
      'The export includes the scene objects with their materials and packed base-colour textures, plus Idle and Walk animation clips for characters. It opens in Blender, Unity, Unreal, Godot, three.js and other glTF tools.\n\n' +
      'If a texture is missing, check that the mesh has UVs and that the Edit tab says Texture: Packed.',
    next: ['engine', 'textures', 'save-vs-export'],
  },
  {
    id: 'engine',
    title: 'Using Shredder with a game engine',
    keywords: ['unity', 'unreal', 'godot', 'game engine', 'import glb', 'three.js', 'web'],
    body:
      'Export a GLB and drop it into your engine. GLB carries geometry, materials, packed textures and the character Idle/Walk clips in one file, and Shredder exports in metres with Y up, which matches Unity, Unreal and Godot defaults.\n\n' +
      'Unity needs a glTF importer package (for example UnityGLTF) to read .glb files. Unreal and Godot import them directly. If a model faces the wrong way in your engine, rotate the imported root in Shredder before exporting.',
    next: ['export-glb', 'model-scale'],
  },
  {
    id: 'open-project',
    title: 'Opening and importing projects',
    keywords: [
      'open project',
      'open file',
      'import project',
      'load',
      'json',
      'mblend',
      'reopen',
      'continue',
    ],
    body:
      'File → Open Project… opens a .blend or .mblend project (and also accepts model files). In the desktop app it uses a normal file picker; in the browser preview it opens an upload dialog.\n\n' +
      'The Files button opens the project library instead, including projects saved outside Documents\\Shredder. Opening a project that is already tracked reuses its entry instead of making a duplicate.',
    next: ['files', 'save', 'append'],
  },
  {
    id: 'append',
    title: 'Combining projects',
    keywords: ['append', 'merge', 'combine', 'join projects', 'add another project'],
    body:
      "Open the project you want to add to, click Files, find the other project, and choose Append. Its objects are copied in beside the existing scene rather than on top of it.\n\n" +
      'Append keeps names unique and starts a new undo step, so Ctrl+Z removes the whole addition.\n\n' +
      'Import is different: it opens a project as its own file.',
    next: ['files', 'open-project'],
  },
  {
    id: 'ai-bridge',
    title: 'AI bridge and external models',
    keywords: [
      'ai bridge',
      'endpoint',
      '3927',
      'tools',
      'api',
      'connect model',
      'chatgpt',
      'claude',
      'automation',
      'mcp',
      'ai',
    ],
    body:
      'The desktop app runs a local AI bridge at http://127.0.0.1:3927. It exposes 12 tools — get scene, list/open files, import a model, add/update a character, transform, select, add primitives, delete, save and export GLB — so an AI model or script on your machine can drive the app.\n\n' +
      'It listens only on your machine (loopback) and refuses requests that come from web pages. Open the AI tab to pause it, watch calls, or revert a session.\n\n' +
      'This Help chat is separate: it only explains the app and has no access to the scene.',
    next: ['mcp', 'ai-panel', 'help-chat'],
  },
  {
    id: 'mcp',
    title: 'Connecting an MCP client',
    keywords: [
      'mcp',
      'claude desktop',
      'cursor',
      'windsurf',
      'vs code',
      'connector',
      'setup ai',
      'connect claude',
    ],
    body:
      "The installer includes an MCP server, so Claude Desktop, Claude Code, Cursor, Windsurf and VS Code can use Shredder's tools.\n\n" +
      'Point the client at:\n' +
      'command: C:\\Shredder\\Shredder.exe\n' +
      'args: ["C:\\\\Shredder\\\\resources\\\\ai\\\\mcp-server.cjs"]\n' +
      'env: ELECTRON_RUN_AS_NODE=1 and SHREDDER_URL=http://127.0.0.1:3927\n\n' +
      'Start Shredder before the client connects, and restart the client after editing its config. ai/mcp.example.json has a copy-paste JSON version; if you use the portable build, change both paths.',
    next: ['ai-bridge', 'ai-panel'],
  },
  {
    id: 'ai-panel',
    title: 'The AI tab',
    keywords: ['ai tab', 'ai actions', 'pause', 'revert ai', 'session', 'log', 'bridge status'],
    body:
      'The AI tab lists every bridge or MCP call with its arguments and result, newest first. Calls are grouped into sessions.\n\n' +
      '• Live / Paused stops the bridge from accepting new calls (they return 423). Reading the tool list still works.\n' +
      '• Revert restores the project to how it was before that session\'s first call.\n' +
      '• Clear log removes the history and its revert points.\n\n' +
      'The footer shows the bridge address and tool count; click it to copy the endpoint.',
    next: ['ai-bridge', 'mcp'],
  },
  {
    id: 'help-chat',
    title: 'About this guide',
    keywords: [
      'this chat',
      'help chat',
      'assistant',
      'guide',
      'who are you',
      'can you edit',
      'offline',
      'how do i ask',
    ],
    body:
      "I am Shredder's built-in guide. I answer questions about how the program works: importing, characters, editing, saving, exporting, shortcuts and troubleshooting.\n\n" +
      'I work offline from help content built into the app. I cannot see or change your scene, run tools, or connect to the internet, so you can ask freely.\n\n' +
      'If I do not know something, I will suggest the closest topics. The AI tab is where you let a model edit the scene through the bridge.',
    next: ['ai-bridge', 'shortcuts', 'start'],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    keywords: [
      'shortcut',
      'hotkey',
      'key',
      'keyboard',
      'controls',
      'ctrl',
      'keys',
      'mouse',
    ],
    body:
      'Selecting and transforming\n' +
      '• Q — Select tool\n' +
      '• G — Move\n' +
      '• R — Rotate\n' +
      '• S — Scale\n' +
      '• Shift+D — Duplicate\n' +
      '• X or Delete — Delete\n' +
      '• Esc — clear selection or close a panel\n' +
      '• Tab — Object / Pose mode\n' +
      '• F — frame the selection\n\n' +
      'Views\n' +
      '• 1 — Front, 3 — Right, 7 — Top, 5 — User perspective\n' +
      '• Middle mouse drag — orbit, wheel — zoom\n\n' +
      'Project\n' +
      '• Ctrl+S — Save, Ctrl+Shift+S — Save As, Ctrl+O — Open\n' +
      '• Ctrl+Z — Undo, Ctrl+Shift+Z or Ctrl+Y — Redo\n' +
      '• F1 or ? — open this guide',
    next: ['transform', 'save', 'views'],
  },
  {
    id: 'install',
    title: 'Installing, updating and uninstalling',
    keywords: [
      'install',
      'installer',
      'setup',
      'uninstall',
      'update',
      'desktop shortcut',
      'start menu',
      'smartscreen',
      'unknown publisher',
      'signed',
      'exe',
    ],
    body:
      'Run Shredder-Setup-<version>.exe. It installs to C:\\Shredder for all users, adds Start Menu shortcuts and appears in Settings → Apps.\n\n' +
      'Uninstalling keeps your projects in Documents\\Shredder.\n\n' +
      'The installer is not code-signed, so Windows SmartScreen may say "Unknown publisher" the first time. Choose More info → Run anyway. That warning can only be removed with an Authenticode certificate, not by changing the installer.',
    next: ['save', 'files'],
  },
  {
    id: 'troubleshoot-white',
    title: 'A model imports white or grey',
    keywords: [
      'white',
      'white model',
      'model is white',
      'imported model is white',
      'shows up white',
      'grey model',
      'model is grey',
      'grey',
      'no texture',
      'missing texture',
      'model has no colour',
      'black model',
      'texture not showing',
      'flat colour',
    ],
    body:
      'Most often the image was not inside the file. Shredder only imports base-colour textures that the model actually carries.\n\n' +
      'Try this:\n' +
      '1. Re-export from the source app with textures embedded. A .glb is the most reliable.\n' +
      '2. Make sure the mesh has UV coordinates; without UVs a texture cannot be placed.\n' +
      '3. Check the Edit tab after import: Texture should say Packed.\n' +
      '4. If the mesh only has a flat colour, set Base color in the Edit tab.\n\n' +
      'Normal, roughness and metallic maps are not imported.',
    next: ['textures', 'materials', 'import-model'],
  },
  {
    id: 'model-scale',
    title: 'A model is tiny, huge or sideways',
    keywords: [
      'tiny',
      'huge',
      'too small',
      'too big',
      'scale wrong',
      'sideways',
      'rotated',
      'units',
      'centimetres',
      'millimetres',
      'z up',
      'upside down',
    ],
    body:
      'Shredder converts Z-up files to Y-up, rescales centimetre or millimetre models to metres, then centres the model and drops it onto the ground. Most Blender, Unity and CAD exports therefore land at a sensible size.\n\n' +
      'If it still looks wrong, select the imported group and use the Edit tab Scale fields, or press S in the viewport. A scale of 0.01 converts centimetres to metres; 0.001 converts millimetres.\n\n' +
      'For orientation, select the group and use the Rotation fields in the Edit tab.',
    next: ['transform', 'import-model', 'properties'],
  },
  {
    id: 'privacy',
    title: 'Privacy and offline use',
    keywords: [
      'privacy',
      'internet',
      'cloud',
      'account',
      'offline',
      'data',
      'tracking',
      'safe',
      'where stored',
    ],
    body:
      'Modelling in Shredder is entirely local. Projects, imported geometry and packed textures stay on your computer in Documents\\Shredder (desktop) or browser storage (preview). There is no account, cloud sync or telemetry.\n\n' +
      'The AI bridge listens only on 127.0.0.1 and refuses browser origins. This guide runs offline from built-in content. Only an MCP client or script that you start can drive the scene.',
    next: ['save', 'ai-bridge', 'help-chat'],
  },
  {
    id: 'groups',
    title: 'Groups and parts',
    keywords: ['group', 'parent', 'parts', 'hierarchy', 'imported structure', 'character group'],
    body:
      "Groups keep related objects together. A character is a group of body parts; an imported file is a group containing the file's node hierarchy and its meshes.\n\n" +
      'In Object mode, clicking any part selects its top-level group, so moving the group moves everything. In Pose mode you select the individual part. The Scene tab shows the tree and lets you collapse or expand it.\n\n' +
      'Deleting or duplicating a group affects all of its parts.',
    next: ['selection', 'outliner', 'pose'],
  },
  {
    id: 'interface',
    title: 'What each part of the window does',
    keywords: [
      'interface',
      'window',
      'layout',
      'panels',
      'tabs',
      'toolbar',
      'top bar',
      'status bar',
      'where is',
    ],
    body:
      'Top bar: File, Add and View menus; Object/Pose switch; undo and redo; Save; Files; Export GLB; Help.\n\n' +
      'Left strip: Select, Move, Rotate, Scale, Add, Frame and Character tools.\n\n' +
      'Viewport: the 3D scene. View buttons and Frame/All live in its top-right corner.\n\n' +
      'Right panel: Scene (object tree), Edit (properties), Character (builder), AI (bridge log) and Help (this guide).\n\n' +
      'Bottom bar: current mode, tool, bridge status and object count.',
    next: ['start', 'outliner', 'properties'],
  },
]

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9+.#]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function suggestionFor(topic: HelpTopic): HelpSuggestion {
  return { label: topic.title, question: topic.title }
}

function fallbackSuggestions(exclude?: string): HelpSuggestion[] {
  const picks = DEFAULT_FOLLOW_UPS.filter((id) => id !== exclude)
    .map((id) => HELP_TOPICS.find((topic) => topic.id === id))
    .filter((topic): topic is HelpTopic => Boolean(topic))
  return picks.map(suggestionFor)
}

function relatedFor(topic: HelpTopic, ranked: { topic: HelpTopic; score: number }[]): HelpSuggestion[] {
  const ids = topic.next
  if (ids && ids.length > 0) {
    const picked = ids
      .map((id) => HELP_TOPICS.find((entry) => entry.id === id))
      .filter((entry): entry is HelpTopic => Boolean(entry) && entry!.id !== topic.id)
    if (picked.length > 0) return picked.slice(0, 4).map(suggestionFor)
  }
  const nearby = ranked
    .filter((entry) => entry.topic.id !== topic.id && entry.score >= 1)
    .slice(0, 3)
    .map((entry) => suggestionFor(entry.topic))
  return nearby.length > 0 ? nearby : fallbackSuggestions(topic.id)
}

function scoreTopic(topic: HelpTopic, question: string, queryTokens: string[]) {
  const title = normalize(topic.title)
  let score = 0

  if (question.includes(title)) score += 12

  // Several keywords often share a word ("load model", "open model"); count
  // partial overlaps once so a topic cannot win by repeating "model".
  let keywordScore = 0
  for (const keyword of topic.keywords) {
    const phrase = normalize(keyword)
    if (!phrase) continue
    if (question.includes(phrase)) {
      keywordScore += 4 + Math.min(6, phrase.split(' ').length * 2)
    } else {
      const keywordTokens = tokenize(phrase)
      const overlap = keywordTokens.filter((token) => queryTokens.includes(token)).length
      keywordScore = Math.max(keywordScore, overlap * 1.8)
    }
  }
  score += keywordScore

  const titleTokens = tokenize(topic.title)
  score += titleTokens.filter((token) => queryTokens.includes(token)).length * 2

  const bodyTokens = new Set(tokenize(topic.body))
  score += queryTokens.filter((token) => bodyTokens.has(token)).length * 0.4

  if (queryTokens.length > 0) {
    const corpus = new Set([
      ...titleTokens,
      ...topic.keywords.flatMap((keyword) => tokenize(keyword)),
      ...bodyTokens,
    ])
    const covered = queryTokens.filter((token) => corpus.has(token)).length
    score += (covered / queryTokens.length) * 5
  }

  return score
}

function answerGreeting(question: string): HelpReply | null {
  if (/^(hi|hello|hey|yo|hiya|howdy|good (morning|afternoon|evening))\b/.test(question)) {
    return {
      matched: true,
      text:
        'Hello! Ask me anything about how Shredder works — importing models, characters, moving things around, saving, exporting or shortcuts.\n\n' +
        'If you are starting fresh, try "How do I import a model?" or "How do I add a character?".',
      related: [
        { label: 'Import a model', question: 'How do I import a model?' },
        { label: 'Add a character', question: 'How do I add a character?' },
        { label: 'Shortcuts', question: 'List every keyboard shortcut' },
      ],
    }
  }
  if (/^(thanks|thank you|thx|cheers|ty)\b/.test(question)) {
    return {
      matched: true,
      text: 'Happy to help. If another question comes up, just ask.',
      related: fallbackSuggestions(),
    }
  }
  if (/^(bye|goodbye|see you|that.s all)\b/.test(question)) {
    return {
      matched: true,
      text: 'See you. Your work autosaves, so you can close Shredder whenever you like.',
      related: [],
    }
  }
  return null
}

/**
 * Find the best help topic for a free-text question. Deliberately simple and
 * deterministic: the guide must work offline and never call the scene.
 */
export function answerHelp(rawQuestion: string): HelpReply {
  const question = normalize(rawQuestion)
  if (!question) {
    return {
      matched: false,
      text: 'Ask me a question about Shredder — for example how to import a model, add a character, save a project or export a GLB.',
      related: fallbackSuggestions(),
    }
  }

  const greeting = answerGreeting(question)
  if (greeting) return greeting

  // Keep the guide honest when someone asks it to act on the scene.
  if (/\b(can|could|will|would) (you|u) (change|edit|delete|remove|move|add|do|make|save|export|pose)\b/.test(question)) {
    return {
      matched: true,
      text:
        'I only explain how Shredder works — I cannot change, delete or export anything.\n\n' +
        'Use the app controls for that, or connect a model through the AI bridge if you want an assistant to edit the scene. I can tell you which buttons or shortcuts to use.',
      related: [
        { label: 'AI bridge', question: 'What is the AI bridge?' },
        { label: 'Shortcuts', question: 'List every keyboard shortcut' },
        { label: 'Where to start', question: 'Where do I start?' },
      ],
    }
  }

  if (/^(help|what can you do|what do you know|topics)\b/.test(question)) {
    return {
      matched: true,
      text:
        'I can explain every part of Shredder: importing models and textures, characters and posing, moving objects, the Scene and Edit tabs, saving and exporting, shortcuts, the AI bridge and troubleshooting.\n\n' +
        'Ask in your own words, or pick one of the topics below.',
      related: fallbackSuggestions(),
    }
  }

  const queryTokens = tokenize(question)
  const ranked = HELP_TOPICS.map((topic) => ({
    topic,
    score: scoreTopic(topic, question, queryTokens),
  })).sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < 5) {
    const suggestions = ranked.filter((entry) => entry.score > 0).slice(0, 3)
    return {
      matched: false,
      text:
        'I do not have a ready answer for that one yet. I know the most about importing models, characters, editing, saving, exporting, shortcuts and troubleshooting.\n\n' +
        'Try one of these topics, or rephrase the question:',
      related:
        suggestions.length > 0
          ? suggestions.map((entry) => suggestionFor(entry.topic))
          : fallbackSuggestions(),
    }
  }

  return {
    matched: true,
    text: best.topic.body,
    related: relatedFor(best.topic, ranked),
  }
}

export const SUGGESTED_QUESTIONS: HelpSuggestion[] = [
  { label: 'Import a model', question: 'How do I import a model?' },
  { label: 'Add a character', question: 'How do I add a character?' },
  { label: 'Move things', question: 'How do I move, rotate or scale an object?' },
  { label: 'Save or export', question: 'What is the difference between saving and exporting?' },
  { label: 'White model', question: 'My imported model is white, what should I do?' },
  { label: 'Shortcuts', question: 'List every keyboard shortcut' },
]
