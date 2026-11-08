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
    // Main Window Actions
    getCachedData: () => safeInvoke('get-cached-data'),
    deleteEntry: (serial: string) => safeInvoke('delete-entry', serial),
    clearCache: () => safeInvoke('clear-cache'),
    toggleMonitoring: (enabled: boolean) => ipcRenderer.send('toggle-monitoring', enabled),

    // Settings & Admin
    openSettings: () => ipcRenderer.send('open-settings'),
    openAdmin: () => ipcRenderer.send('open-admin'),
    getUsers: () => safeInvoke('get-users'),
    loginSuccess: () => safeInvoke('login-success'),
    getSettings: () => safeInvoke('get-settings'),
    saveSettings: (settings: any) => safeInvoke('save-settings', settings),
    restartApp: (settings?: any) => safeInvoke('restart-app', settings),
    logout: () => safeInvoke('logout'),
    showLoginWindow: () => ipcRenderer.send('show-login-window'),

    // Z Report Calculation
    calculateZReport: (fileData: ArrayBuffer | string) => safeInvoke('calculate-zreport', fileData),

    // Popup Specific
    onPopupData: (callback: any) =>
        ipcRenderer.on('popup-data', (_event, info, duration) => callback(info, duration)),
    popupHoverEnter: () => ipcRenderer.send('popup-hover-enter'),
    popupHoverLeave: () => ipcRenderer.send('popup-hover-leave'),
    openMainView: (view: string) => ipcRenderer.send('open-main-view', view),
    openPriorityDevice: (device: any) => ipcRenderer.send('open-priority-device', device),
    closeWindow: () => ipcRenderer.send('close-window'),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),

    // Server Status
    manualServerStatusRefresh: () => ipcRenderer.send('manual-server-status-refresh'),

    // Event Listeners
    onServerStatusUpdate: (callback: any) =>
        ipcRenderer.on('server-status-update', (_event, value) => callback(value)),
    onRefreshCards: (callback: any) =>
        ipcRenderer.on('refresh-cards', () => callback()),
    onCacheCleared: (callback: any) =>
        ipcRenderer.on('cache-cleared', () => callback()),
    onMonitoringToggled: (callback: any) =>
        ipcRenderer.on('monitoring-toggled', (_event, enabled) => callback(enabled)),
    onSwitchView: (callback: any) =>
        ipcRenderer.on('switch-view', (_event, view) => callback(view)),

    // Priority Devices
    getPriorityDevices: () => safeInvoke('get-priority-devices'),
    addPriorityDevice: (data: any) => safeInvoke('add-priority-device', data),
    updatePriorityDevice: (id: string, data: any) => safeInvoke('update-priority-device', id, data),
    deletePriorityDevice: (id: string) => safeInvoke('delete-priority-device', id),
    onPriorityDeviceMatch: (callback: any) =>
        ipcRenderer.on('priority-device-match', (_event, device) => callback(device)),
    onFocusPriorityDevice: (callback: any) =>
        ipcRenderer.on('focus-priority-device', (_event, device) => callback(device)),
    onPriorityDevicesUpdate: (callback: any) =>
        ipcRenderer.on('priority-devices-update', (_event, devices) => callback(devices)),

    // Device Calls
    createDeviceCall: (data: any) => safeInvoke('create-device-call', data),
    resolveDeviceCall: (id: string, resolved_by: string) => safeInvoke('resolve-device-call', id, resolved_by),
    onDeviceCallsUpdate: (callback: any) =>
        ipcRenderer.on('device-calls-update', (_event, calls) => callback(calls)),

    // Device Call Toast window channels
    onDeviceCallToastData: (callback: any) =>
        ipcRenderer.on('device-call-toast-data', (_event, data) => callback(data)),
    onDeviceCallToastResolve: (callback: any) =>
        ipcRenderer.on('device-call-toast-resolve', (_event, data) => callback(data)),
    onDeviceCallStatusUpdate: (callback: any) =>
        ipcRenderer.on('device-call-status-update', (_event, data) => callback(data)),
    deviceCallAction: (payload: any) => ipcRenderer.send('device-call-action', payload),
    resizeDeviceCallToast: (payload: { callId: string; height: number }) =>
        ipcRenderer.send('resize-device-call-toast', payload),

    // Admin CRUD
    createUser: (data: any) => safeInvoke('create-user', data),
    updateUser: (id: string, data: any) => safeInvoke('update-user', id, data),
    deleteUser: (id: string) => safeInvoke('delete-user', id),

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
    setSnippetsDefaultPrefix: (prefix: string) => safeInvoke('set-snippets-default-prefix', prefix)
})
