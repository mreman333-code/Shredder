const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shredderHost', {
  platform: 'desktop',
  app: {
    // The main process asks for a final save before the window closes; the
    // answer decides whether the window closes or stays open.
    onSaveBeforeClose(handler) {
      const listener = async (_event, requestId) => {
        try {
          await handler()
          ipcRenderer.send('app:save-before-close-done', { requestId, ok: true })
        } catch (error) {
          ipcRenderer.send('app:save-before-close-done', {
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      ipcRenderer.on('app:save-before-close', listener)
      return () => ipcRenderer.removeListener('app:save-before-close', listener)
    },
  },
  getAiStatus() {
    return ipcRenderer.invoke('ai:status')
  },
  setAiPaused(paused) {
    return ipcRenderer.invoke('ai:set-paused', Boolean(paused))
  },
  onAiStatus(handler) {
    const listener = (_event, status) => handler(status)
    ipcRenderer.on('ai:status', listener)
    return () => ipcRenderer.removeListener('ai:status', listener)
  },
  projects: {
    root: () => ipcRenderer.invoke('projects:root'),
    load: () => ipcRenderer.invoke('projects:load'),
    save: (payload) => ipcRenderer.invoke('projects:save', payload),
    openDialog: () => ipcRenderer.invoke('projects:open-dialog'),
    saveAs: (payload) => ipcRenderer.invoke('projects:save-as', payload),
    exportFile: (payload) => ipcRenderer.invoke('projects:export-file', payload),
    read: (target) => ipcRenderer.invoke('projects:read', target),
    reveal: (target) => ipcRenderer.invoke('projects:reveal', target),
  },
  models: {
    openDialog: () => ipcRenderer.invoke('models:open-dialog'),
    read: (target) => ipcRenderer.invoke('models:read', target),
  },
  onAiRequest(handler) {
    const listener = async (_event, message) => {
      if (!message || typeof message.id !== 'string') return
      try {
        const result = await handler(message.tool, message.args ?? {}, message.session)
        ipcRenderer.send('ai:response', { id: message.id, ok: true, result })
      } catch (error) {
        ipcRenderer.send('ai:response', {
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    ipcRenderer.on('ai:request', listener)
    return () => ipcRenderer.removeListener('ai:request', listener)
  },
})
