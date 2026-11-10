import { contextBridge, ipcRenderer, webUtils } from 'electron'

const safeInvoke = async (channel: string, ...args: any[]) => {
    try {
        return await ipcRenderer.invoke(channel, ...args)
    } catch (error: any) {
        console.error(`[IPC Error] Channel '${channel}':`, error)
        throw error
    }
}

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),

    // Main Window & Cache
    getCachedData: () => safeInvoke('get-cached-data'),
    deleteEntry: (serial: string) => safeInvoke('delete-entry', serial),
    clearCache: () => safeInvoke('clear-cache'),
    toggleMonitoring: (enabled: boolean) => ipcRenderer.send('toggle-monitoring', enabled),

    // Settings
    getSettings: () => safeInvoke('get-settings'),
    saveSettings: (settings: any) => safeInvoke('save-settings', settings),
    restartApp: (settings?: any) => safeInvoke('restart-app', settings),

    // Window Controls
    closeWindow: () => ipcRenderer.send('close-window'),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),

    // Popup
    onPopupData: (callback: any) =>
        ipcRenderer.on('popup-data', (_event, info, duration) => callback(info, duration)),
    popupHoverEnter: () => ipcRenderer.send('popup-hover-enter'),
    popupHoverLeave: () => ipcRenderer.send('popup-hover-leave'),

    // Server Status
    manualServerStatusRefresh: () => ipcRenderer.send('manual-server-status-refresh'),
    onServerStatusUpdate: (callback: any) =>
        ipcRenderer.on('server-status-update', (_event, value) => callback(value)),

    // Event Listeners
    onRefreshCards: (callback: any) => ipcRenderer.on('refresh-cards', () => callback()),
    onCacheCleared: (callback: any) => ipcRenderer.on('cache-cleared', () => callback()),
    onMonitoringToggled: (callback: any) =>
        ipcRenderer.on('monitoring-toggled', (_event, enabled) => callback(enabled)),
    onSwitchView: (callback: any) =>
        ipcRenderer.on('switch-view', (_event, view) => callback(view)),

    // Auto-Updater
    checkForUpdates: () => safeInvoke('check-for-updates'),
    onUpdateAvailable: (callback: any) =>
        ipcRenderer.on('update-available', (_event, version) => callback(version)),
    onUpdateNotAvailable: (callback: any) =>
        ipcRenderer.on('update-not-available', () => callback()),
    onUpdateError: (callback: any) =>
        ipcRenderer.on('update-error', (_event, error) => callback(error)),
    onUpdateProgress: (callback: any) =>
        ipcRenderer.on('update-progress', (_event, percent) => callback(percent)),
    onUpdateDownloaded: (callback: any) =>
        ipcRenderer.on('update-downloaded', () => callback()),
    startUpdateDownload: () => ipcRenderer.send('start-update-download'),
    installUpdate: () => ipcRenderer.send('install-update'),

    // Text Expander (Espanso-like Snippets)
    getSnippetsConfig: () => safeInvoke('get-snippets-config'),
    saveSnippet: (snippet: any) => safeInvoke('save-snippet', snippet),
    deleteSnippet: (id: string) => safeInvoke('delete-snippet', id),
    toggleSnippet: (id: string, enabled?: boolean) => safeInvoke('toggle-snippet', id, enabled),
    setSnippetsGlobalEnabled: (enabled: boolean) => safeInvoke('set-snippets-global-enabled', enabled),
    setSnippetsDefaultPrefix: (prefix: string) => safeInvoke('set-snippets-default-prefix', prefix),

    // AI Form Reader (OCR & Form Parser)
    getFormReaderStatus: () => safeInvoke('form-reader:status'),
    startFormReader: () => safeInvoke('form-reader:start'),
    stopFormReader: () => safeInvoke('form-reader:stop'),
    processFormFromPc: (payload: any) => safeInvoke('form-reader:process-pc', payload),
    openFormReaderFolder: () => safeInvoke('form-reader:open-folder'),
    onFormReaderResult: (callback: any) =>
        ipcRenderer.on('form-reader:result', (_event, data) => callback(data))
})
