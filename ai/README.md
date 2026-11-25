# Shredder connectors

Shredder exposes one live scene. Connectors do not open files themselves — they drive the
running app, so **Shredder must be running** (window open, project loaded) before any of the
calls below will answer. If it is closed, requests fail with a connection error.

Two ways in:

- **HTTP** — any model or script that can make requests, on this machine only.
- **MCP** — Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, or any MCP client.

## Projects on disk

In the desktop app every project is a real file. The library lives in `Documents/Shredder`,
folders become subfolders there, and each project is a `.blend` JSON document. **File → Open
Project…** and **File → Save As…** use native dialogs and can point anywhere; autosave then writes
back to that file's actual location. `list_files` includes the absolute `path` for projects saved
outside the library, and `open_file` accepts a file name, id, or absolute path. Projects from the
old browser store are copied to disk on first launch; after that the browser preview still uses
browser storage.

## Importing models

**File → Import Model…** imports the formats Unity reads, and **File → Open Project…** accepts
them too:

| Family            | Extensions                              |
| ----------------- | --------------------------------------- |
| glTF              | `.glb`, `.gltf`                         |
| Blender exports   | `.fbx`, `.obj`, `.dae`                  |
| Other DCC / CAD   | `.3ds`, `.stl`, `.ply`, `.3mf`, `.dxf`  |
| Blender archive   | `.blend` (needs Blender installed)      |

An import lands as ordinary project objects: one wrapper group for the file, the file's node
hierarchy as groups, one mesh object per mesh carrying the file's material colour and its
base-colour texture, and the file's bind skeleton when it is rigged (**View → Show skeleton**
draws it). Textures are packed into the project itself as embedded images, so a saved project and
an exported GLB both keep them without the original image files. Z-up formats are rotated to
Y-up, centimetre or millimetre files are rescaled to metres, and the model is centred and dropped
onto the ground plane. Geometry is stored inside the project file, so a saved project reopens
without the original asset; UVs and base colours are kept, textures are not.

`.blend` archives are opened by Blender itself in the background and exported to GLB first, so
Blender must be installed (set `SHREDDER_BLENDER` to `blender.exe` if it is somewhere unusual).
Without Blender, open the file in Blender and export GLB, FBX or OBJ.

Both the HTTP bridge and the MCP server expose the same 12 tools:

`get_scene`, `list_files`, `open_file`, `import_model`, `add_character`, `update_character`,
`transform_object`, `select_object`, `add_primitive`, `delete_object`, `save_file`, `export_glb`

## HTTP endpoint

Base URL: `http://127.0.0.1:3927`

| Method | Path         | Purpose                                                        |
| ------ | ------------ | -------------------------------------------------------------- |
| GET    | `/ai/health` | Liveness plus the tool names. `GET /ai` works too.             |
| GET    | `/ai/tools`  | Every tool as an OpenAI-style `{type:"function", function:{…}}`. |
| POST   | `/ai/call`   | Run one tool: `{"tool": "<name>", "arguments": { … }}`.        |

Successful call response: `{"ok": true, "result": …}`.
Errors: `404` unknown tool, `400` bad arguments or a failed tool, `403` if the request carries a
browser `Origin` header (web pages are not allowed to drive the app).

Check it is up:

```bash
curl http://127.0.0.1:3927/ai/health
# {"ok":true,"app":"Shredder","tools":["get_scene", …]}
```

Fetch the schemas and hand them to your model, then post the tool call it chooses:

```bash
curl http://127.0.0.1:3927/ai/tools

curl -X POST http://127.0.0.1:3927/ai/call \
  -H "content-type: application/json" \
  -d '{"tool":"get_scene","arguments":{}}'

curl -X POST http://127.0.0.1:3927/ai/call \
  -H "content-type: application/json" \
  -d '{"tool":"add_character","arguments":{"preset":"Scout","height":1.7}}'
```

Call `get_scene` first so the model uses real object names, then edit. Each tool's
`inputSchema` in `/ai/tools` is the full argument list (`add_character` takes `preset`, `name`,
`height`, `build`, `headSize`, `legLength`, `colors`, `position`; `transform_object` takes
`target` plus optional `position`, `rotation`, `scale`).

## Pausing and sessions

The app's **AI actions** panel lists every call with its arguments and result. It has a pause
switch: while paused, `POST /ai/call` answers `423` with an explanation and `GET /ai/health`
reports `"paused": true`. Reading the tool list still works.

Calls are grouped into sessions. The MCP server sends a stable session id per process
(`x-shredder-session`); HTTP callers may send the same header or a `session` field in the body,
and otherwise calls are grouped until two minutes of idle time. Each session in the panel has a
**Revert** button that restores the project to how it was before that session's first call.

## Installing

Run `Shredder-Setup-<version>.exe`. It installs for all users to the fixed path
`C:\Shredder`, adds Start Menu shortcuts and an uninstaller in Settings → Apps. Uninstalling
keeps your projects in `Documents\Shredder`.

The installer is not code-signed unless the build supplied a certificate, so Windows
SmartScreen can still show "Unknown publisher" on first run. That warning is removed by
Authenticode signing (`SHREDDER_SIGN_PFX` and `SHREDDER_SIGN_PASSWORD` when building), not by
using an installer.

## MCP config

The example ships as `resources/ai/mcp.example.json` (next to this file). Because the installer
always uses `C:\Shredder`, this config works as-is:

- Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json`
- Cursor: `%USERPROFILE%\.cursor\mcp.json`
- VS Code: `.vscode/mcp.json` in your workspace

```json
{
  "mcpServers": {
    "shredder": {
      "command": "C:\\Shredder\\Shredder.exe",
      "args": ["C:\\Shredder\\resources\\ai\\mcp-server.cjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "SHREDDER_URL": "http://127.0.0.1:3927"
      }
    }
  }
}
```

If you use the portable zip instead of the installer, extract it wherever you like and change
both paths to match that folder; the rest of the config is unchanged. Keep the doubled
backslashes (JSON escaping). `Shredder.exe` runs the MCP server through its own Electron
runtime because `ELECTRON_RUN_AS_NODE=1` is set, so no separate Node install is needed. Start
Shredder before the MCP client connects; restart the client after editing the config.

## Other ports

If 3927 is taken, start the app with a different port, e.g. PowerShell:
`$env:SHREDDER_AI_PORT=4000; .\Shredder.exe`, and point the client at the same port through
`SHREDDER_URL`. Both sides must match.
