import {
  app,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  clipboard,
  globalShortcut,
  net,
  dialog,
  BrowserWindow
} from 'electron';
import * as path from 'path';
import { is } from '@electron-toolkit/utils';
import { checkWarranty } from './warrantyChecker';
import {
  getCachedData,
  saveToCache,
  loadCache,
  initCache,
  clearCache,
  deleteEntry,
  isCacheEntryStale
} from './cacheManager';
import { WindowManager } from './windowManager';
import { loadSettings, saveSettings, AppSettings } from './settingsManager';
import { ClipboardMonitor } from './clipboardMonitor';
import { TextExpanderManager } from './textExpanderManager';
import * as fs from 'fs';
import { exec } from 'child_process';
import { autoUpdater } from 'electron-updater';

// Hardware acceleration & GPU recovery switches for Windows office GPUs (prevents black screen bug)
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-direct-composition');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    const mainWindow = windowManager?.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'RecciTek WCheck',
        message: 'Uygulama zaten çalışıyor.',
        detail: 'Lütfen sistem tepsisindeki (tray) simgeyi kontrol edin.',
        buttons: ['Tamam']
      });
    }
  });
}

let windowManager: WindowManager;
let clipboardMonitor: ClipboardMonitor;
let tray: Tray | null = null;
let currentSettings: AppSettings;
let monitoringEnabled = true;
let currentPopupData: any = null;
let lastDetectedSerial: string = '';
let statusInterval: NodeJS.Timeout | null = null;

function extractCopyText(data: any): string {
  if (!data) return '';

  if (data.model_name && data.model_name !== 'MODEL BULUNAMADI') {
    let cleanModel = (data.model_name || '').toUpperCase().trim()
      .replace(/^ROBOROCK\s+/i, '').replace(/^ROBOROCK$/i, '').replace(/QREVO/g, 'Q REVO').trim();
    let cleanColor = (data.model_color && data.model_color !== 'RENK BULUNAMADI')
      ? data.model_color.toUpperCase().replace(/QREVO/g, 'Q REVO').trim()
      : '';

    if (cleanColor && cleanModel.endsWith(cleanColor)) {
      cleanModel = cleanModel.substring(0, cleanModel.length - cleanColor.length).trim();
    }

    return cleanColor ? `${cleanModel} - ${cleanColor}` : cleanModel;
  }
  return '';
}

async function checkServerStatus(): Promise<void> {
  const start = Date.now();
  try {
    const request = net.request({
      method: 'HEAD',
      url: 'https://www.recciteknoloji.com/garantibelgesi2/',
      redirect: 'follow'
    });

    request.on('response', (response) => {
      const latency = Date.now() - start;
      const isOnline = response.statusCode === 200;
      windowManager.getMainWindow()?.webContents.send('server-status-update', {
        online: isOnline,
        latency: latency
      });
    });

    request.on('error', () => {
      windowManager.getMainWindow()?.webContents.send('server-status-update', {
        online: false,
        latency: 0
      });
    });

    request.end();
  } catch {
    windowManager.getMainWindow()?.webContents.send('server-status-update', {
      online: false,
      latency: 0
    });
  }
}

function startServerStatusMonitor() {
  if (statusInterval) clearInterval(statusInterval);
  setTimeout(checkServerStatus, 3000);
  const baseInterval = 5 * 60000;
  const scheduleNext = () => {
    const jitter = Math.floor(Math.random() * 120000);
    statusInterval = setTimeout(() => {
      checkServerStatus();
      scheduleNext();
    }, baseInterval + jitter);
  };
  scheduleNext();
}

function handleDoubleCopy(): void {
  const textToCopy = extractCopyText(currentPopupData);
  if (textToCopy) {
    clipboard.writeText(textToCopy);
    windowManager.closePopup();
  }
}

function handleClipboardUpper(): void {
  const text = clipboard.readText();
  if (text) {
    const upperText = text.toLocaleUpperCase('tr-TR');
    clipboard.writeText(upperText);

    if (process.platform === 'win32') {
      const vbsPath = path.join(app.getPath('userData'), 'paste.vbs');
      try {
        if (!fs.existsSync(vbsPath)) {
          fs.writeFileSync(vbsPath, 'WScript.Sleep 100\r\nSet w = CreateObject("WScript.Shell")\r\nw.SendKeys "^v"\r\n');
        }
        exec(`wscript.exe "${vbsPath}"`, (err) => {
          if (err) {
            console.error('VBScript paste failed:', err);
          }
        });
      } catch (e) {
        console.error('Error simulating paste:', e);
      }
    }
  }
}

function shouldSkipDetection(serial: string): boolean {
  if (currentSettings.preventDuplicatePopup && serial === lastDetectedSerial) return true;
  return false;
}

async function processWarrantyRequest(serial: string) {
  const cached = await getCachedData(serial);
  if (cached && !isCacheEntryStale(cached)) return cached;
  if (cached) await deleteEntry(serial);

  const warrantyInfo = await checkWarranty(serial);
  await saveToCache(serial, warrantyInfo);
  return warrantyInfo;
}

async function handleDetection(serial: string): Promise<void> {
  if (shouldSkipDetection(serial)) return;
  lastDetectedSerial = serial;

  try {
    const data = await processWarrantyRequest(serial);
    currentPopupData = data;
    windowManager.showPopup(data, currentSettings.popupTimeout, currentSettings.popupSizeLevel);
    windowManager.getMainWindow()?.webContents.send('refresh-cards');
  } catch (error) {
    windowManager.showPopup({
      serial,
      warranty_status: 'İnternet Bağlantı Hatası',
      is_error: true
    }, currentSettings.popupTimeout, currentSettings.popupSizeLevel);
  }
}

function setupIpcHandlers() {
  ipcMain.handle('get-cached-data', async () => await loadCache());
  ipcMain.handle('delete-entry', async (_, serial) => await deleteEntry(serial));
  ipcMain.handle('clear-cache', async () => await clearCache());
  ipcMain.handle('get-double-copy', async () => currentSettings.doubleCopyEnabled);

  ipcMain.handle('get-settings', async () => ({
    popupTimeout: currentSettings.popupTimeout,
    popupSizeLevel: currentSettings.popupSizeLevel,
    doubleCopyEnabled: currentSettings.doubleCopyEnabled,
    autoStartEnabled: currentSettings.autoStartEnabled,
    preventDuplicatePopup: currentSettings.preventDuplicatePopup,
    clipboardUpperEnabled: currentSettings.clipboardUpperEnabled !== false,
    shortcuts: currentSettings.shortcuts,
    role: currentSettings.role || 'kargo_kabul',
    personnelName: currentSettings.personnelName || '',
    theme: currentSettings.theme || 'dark'
  }));

  ipcMain.handle('save-settings', async (_, settings) => {
    currentSettings = { ...currentSettings, ...settings };
    saveSettings(currentSettings);
    registerShortcuts();

    app.setLoginItemSettings({
      openAtLogin: currentSettings.autoStartEnabled,
      path: app.getPath('exe')
    });
    return true;
  });

  ipcMain.handle('restart-app', async (_, settings) => {
    if (settings) {
      currentSettings = { ...currentSettings, ...settings };
      saveSettings(currentSettings);
    }
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on('toggle-monitoring', (_, enabled) => {
    monitoringEnabled = enabled;
    clipboardMonitor.setEnabled(enabled);
    windowManager.getMainWindow()?.webContents.send('monitoring-toggled', monitoringEnabled);
  });

  ipcMain.on('open-settings', () => {
    windowManager.getMainWindow()?.webContents.send('switch-view', 'settings');
    windowManager.getMainWindow()?.show();
  });

  ipcMain.on('open-main-view', (_, view) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('switch-view', view);
  });

  ipcMain.on('minimize-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.minimize();
  });

  ipcMain.on('close-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.close();
  });

  ipcMain.on('manual-server-status-refresh', () => {
    checkServerStatus();
  });

  ipcMain.handle('check-for-updates', async () => {
    if (is.dev) {
      return { status: 'dev' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        status: 'checked',
        updateInfo: result?.updateInfo
      };
    } catch (err: any) {
      console.error('Check for updates error:', err);
      return {
        status: 'error',
        error: err?.message || 'Güncelleme kontrolü başarısız'
      };
    }
  });

  // Stubs for clean compatibility
  ipcMain.handle('get-priority-devices', async () => []);
  ipcMain.handle('get-users', async () => []);
  ipcMain.handle('logout', async () => true);

  // Text Expander (Espanso-like Snippets) IPC Handlers
  ipcMain.handle('get-snippets-config', async () => {
    return TextExpanderManager.getInstance().getConfig();
  });

  ipcMain.handle('save-snippet', async (_, snippet) => {
    return TextExpanderManager.getInstance().saveSnippet(snippet);
  });

  ipcMain.handle('delete-snippet', async (_, id) => {
    return TextExpanderManager.getInstance().deleteSnippet(id);
  });

  ipcMain.handle('toggle-snippet', async (_, id, enabled) => {
    return TextExpanderManager.getInstance().toggleSnippet(id, enabled);
  });

  ipcMain.handle('set-snippets-global-enabled', async (_, enabled) => {
    return TextExpanderManager.getInstance().setGlobalEnabled(enabled);
  });

  ipcMain.handle('set-snippets-default-prefix', async (_, prefix) => {
    return TextExpanderManager.getInstance().setDefaultPrefix(prefix);
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();

  // Register the model - color copy shortcut if enabled
  if (currentSettings.doubleCopyEnabled !== false) {
    const copyShortcut = currentSettings.shortcuts?.copyModelColor || 'CommandOrControl+Shift+C';
    try {
      globalShortcut.register(copyShortcut, () => {
        handleDoubleCopy();
      });
    } catch (e) {
      console.error('Failed to register model copy shortcut:', e);
    }
  }

  // Register the clipboard upper shortcut if enabled
  if (currentSettings.clipboardUpperEnabled !== false) {
    try {
      globalShortcut.register('CommandOrControl+Shift+V', () => {
        handleClipboardUpper();
      });
    } catch (e) {
      console.error('Failed to register clipboard upper shortcut:', e);
    }
  }

  if (currentSettings.shortcuts) {
    // Clear Cache Shortcut
    if (currentSettings.shortcuts.clearCache) {
      try {
        globalShortcut.register(currentSettings.shortcuts.clearCache, async () => {
          await clearCache();
          const win = windowManager.getMainWindow();
          if (win) {
            win.webContents.send('cache-cleared');
          }
        });
      } catch (e) {
        console.error('Failed to register clearCache shortcut:', e);
      }
    }

    // Toggle Monitoring Shortcut
    if (currentSettings.shortcuts.toggleMonitoring) {
      try {
        globalShortcut.register(currentSettings.shortcuts.toggleMonitoring, () => {
          monitoringEnabled = !monitoringEnabled;
          clipboardMonitor.setEnabled(monitoringEnabled);
          const win = windowManager.getMainWindow();
          if (win) {
            win.webContents.send('monitoring-toggled', monitoringEnabled);
          }
        });
      } catch (e) {
        console.error('Failed to register toggleMonitoring shortcut:', e);
      }
    }
  }
}

function createTray() {
  const mainWindow = windowManager.getMainWindow();

  let iconPath = path.join(__dirname, '../../assets/logo.png');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(process.resourcesPath, 'assets/logo.png');
  }

  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('RecciTek WCheck Lite');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Göster',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { type: 'separator' },
    { label: 'Çıkış', click: () => windowManager.forceQuit() }
  ]));

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function initializeApp() {
  currentSettings = loadSettings();
  windowManager = new WindowManager(__dirname);
  clipboardMonitor = new ClipboardMonitor(handleDetection);
  clipboardMonitor.start();
  monitoringEnabled = true;

  const wasOpenedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true;
  const splash = wasOpenedAtLogin ? null : windowManager.createSplashWindow();
  const startupDelay = wasOpenedAtLogin ? 0 : 1500;

  setTimeout(() => {
    try {
      splash?.close();
    } catch { }

    const mainWindow = windowManager.createMainWindow();
    mainWindow.show();
    mainWindow.focus();

    createTray();
    startServerStatusMonitor();
    registerShortcuts();
    TextExpanderManager.getInstance().start();

    app.setLoginItemSettings({
      openAtLogin: currentSettings.autoStartEnabled,
      path: app.getPath('exe')
    });
  }, startupDelay);

  setupIpcHandlers();
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('RecciTek WCheck');
  }
  initCache();
  initializeApp();

  // Auto-updater setup (only in production)
  if (!is.dev) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      const mainWindow = windowManager?.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info.version);
      }
    });

    autoUpdater.on('update-not-available', () => {
      const mainWindow = windowManager?.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-not-available');
      }
    });

    autoUpdater.on('error', (err) => {
      const mainWindow = windowManager?.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', err?.message || 'Bilinmeyen hata');
      }
    });

    autoUpdater.on('download-progress', (progress) => {
      const mainWindow = windowManager?.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', Math.round(progress.percent));
      }
    });

    autoUpdater.on('update-downloaded', () => {
      const mainWindow = windowManager?.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded');
      }
    });
  }
});

app.on('will-quit', () => {
  clipboardMonitor?.stop();
  TextExpanderManager.getInstance().stop();
  globalShortcut.unregisterAll();
  if (statusInterval) clearInterval(statusInterval);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
