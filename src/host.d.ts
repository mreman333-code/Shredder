export {}

declare global {
  interface AiBridgeStatus {
    state: 'starting' | 'ready' | 'error'
    /** Base URL models should call, for example http://127.0.0.1:3927 */
    url: string
    port: number
    tools: number
    /** Calls are refused while the bridge is paused from the AI panel. */
    paused?: boolean
    error?: string
  }

  /** One project as it lives on disk, used by the desktop file store. */
  interface DiskProjectFile {
    id: string
    name: string
    folderId: string | null
    externalPath?: string
    createdAt: number
    updatedAt: number
    doc: unknown
  }

  interface DiskProjectFolder {
    id: string
    name: string
    parentId: string | null
  }

  interface DiskLibrary {
    root: string
    folders: DiskProjectFolder[]
    files: DiskProjectFile[]
    activeFileId: string | null
    activeFolderId: string | null
  }

  /** A model file read by the desktop app, bytes as base64. */
  interface DiskModelFile {
    path: string
    name: string
    base64: string
    /** True when a Blender .blend archive was exported to GLB first. */
    converted?: boolean
  }

  interface DiskOpenedProject {
    path: string
    name: string
    /** Set when the file is already tracked in the library. */
    id?: string
    doc?: unknown
    /** Present when the picked file is a 3D model instead of a project. */
    model?: DiskModelFile
  }

  interface ModelsApi {
    openDialog: () => Promise<DiskModelFile | null>
    read: (target: string) => Promise<DiskModelFile>
  }

  interface DiskSaveResult {
    path: string
    name: string
  }

  /** Shell hooks used when the desktop window is about to close. */
  interface AppApi {
    /**
     * Main asks the page to flush pending work before closing. Resolve when the
     * save finished, reject when it failed: a rejection keeps the window open.
     */
    onSaveBeforeClose: (handler: () => void | Promise<void>) => () => void
  }

  interface ProjectsApi {
    root: () => Promise<string>
    load: () => Promise<DiskLibrary>
    save: (payload: {
      version: number
      folders: DiskProjectFolder[]
      files: DiskProjectFile[]
      activeFileId: string | null
      activeFolderId: string | null
    }) => Promise<{ root: string }>
    openDialog: () => Promise<DiskOpenedProject | null>
    saveAs: (payload: { suggestedName: string; content: string }) => Promise<DiskSaveResult | null>
    exportFile: (payload: {
      suggestedName: string
      content?: string
      base64?: string
      extension?: string
      label?: string
    }) => Promise<{ path: string } | null>
    read: (target: string) => Promise<DiskOpenedProject>
    reveal: (target: string) => Promise<void>
  }

  interface Window {
    /** Injected by the Electron preload script in the desktop build. */
    shredderHost?: {
      platform: 'desktop'
      app?: AppApi
      projects: ProjectsApi
      models: ModelsApi
      getAiStatus: () => Promise<AiBridgeStatus>
      setAiPaused: (paused: boolean) => Promise<boolean>
      onAiStatus: (handler: (status: AiBridgeStatus) => void) => () => void
      onAiRequest: (
        handler: (
          tool: string,
          args: Record<string, unknown>,
          session?: string,
        ) => Promise<unknown>,
      ) => () => void
    }
  }
}
