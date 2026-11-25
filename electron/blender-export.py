"""Exports the scene Blender was opened with to a single GLB file.

Called by electron/models.cjs:
  blender --background --factory-startup model.blend --python blender-export.py -- out.glb
"""
import sys

import bpy


def target_path() -> str:
    if '--' in sys.argv:
        return sys.argv[sys.argv.index('--') + 1]
    return sys.argv[-1]


def main() -> None:
    out = target_path()
    # Materials, hierarchy and armatures all travel inside glTF.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True,
    )


try:
    main()
except Exception as error:  # noqa: BLE001 - report the Blender error to the app
    sys.stderr.write(f'Shredder export failed: {error}\n')
    sys.exit(1)
