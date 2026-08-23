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
  Notification,
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
import { parseZReportData } from './bonusCalculator';
import { addPriorityDevice, updatePriorityDevice, deletePriorityDevice, subscribeToPriorityDevices, getUsers, createUser, updateUser, deleteUser, createDeviceCall, resolveDeviceCall, cancelDeviceCall, markDeviceCallRecipient, dismissDeviceCallBy, subscribeToDeviceCalls } from './ticketService';
import type { Unsubscribe } from 'firebase/firestore';
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
let priorityUnsubscribe: Unsubscribe | null = null;
let deviceCallsUnsubscribe: Unsubscribe | null = null;
let cachedPriorityDevices: any[] = [];
let cachedDeviceCalls: any[] = [];

function extractCopyText(data: any): string {
  if (!data) return '';

  const status = (data.warranty_status || '').toUpperCase();

  if (status.includes('KVK') && data.warranty_end) {
    return `GÜVENCE BİTİŞ TARİHİ : ${data.warranty_end}`;
  }

  if (status.includes('RECCI') && data.model_name && data.model_name !== 'MODEL BULUNAMADI') {
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
  setTimeout(checkServerStatus, 5000);
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
  if (!windowManager.isPopupVisible() || !currentPopupData) return;
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

// Helper functions for handleDetection to reduce complexity
function shouldSkipDetection(serial: string): boolean {
  if (!currentSettings.isLoggedIn) return true;
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
    checkPriorityMatch(serial);
  } catch (error) {
    windowManager.showPopup({
      serial,
      warranty_status: 'İnternet Bağlantı Hatası',
      is_error: true
    }, currentSettings.popupTimeout, currentSettings.popupSizeLevel);
  }
}

function checkPriorityMatch(serial: string): void {
  if (!serial) return;
  const match = cachedPriorityDevices.find(
    (d: any) => d.serial && d.serial.toUpperCase() === serial.toUpperCase()
  );
  if (match) {
    windowManager.getMainWindow()?.webContents.send('priority-device-match', match);
    windowManager.showPopup({
      variant: 'priority',
      id: match.id,
      serial,
      customer_name: match.customer_name,
      description: match.description,
      created_by: match.created_by,
      anchorDelay: currentSettings.popupTimeout
    }, 15000, currentSettings.popupSizeLevel);
  }
}

function setupIpcHandlers() {
  ipcMain.handle('get-cached-data', async () => await loadCache());
  ipcMain.handle('get-double-copy', async () => currentSettings.doubleCopyEnabled);

  ipcMain.handle('get-settings', async () => ({
    popupTimeout: currentSettings.popupTimeout,
    popupSizeLevel: currentSettings.popupSizeLevel,
    doubleCopyEnabled: currentSettings.doubleCopyEnabled,
    autoStartEnabled: currentSettings.autoStartEnabled,
    preventDuplicatePopup: currentSettings.preventDuplicatePopup,
    clipboardUpperEnabled: currentSettings.clipboardUpperEnabled !== false,
    shortcuts: currentSettings.shortcuts,
    role: currentSettings.role,
    personnelName: currentSettings.personnelName,
    username: currentSettings.username,
    isAdmin: currentSettings.isAdmin,
    isLoggedIn: currentSettings.isLoggedIn,
    theme: currentSettings.theme,
    workingHours: currentSettings.workingHours,
    rememberMe: currentSettings.rememberMe,
    autoLogin: currentSettings.autoLogin,
    savedUsername: currentSettings.savedUsername,
    savedPassword: currentSettings.savedPassword
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

  ipcMain.handle('logout', async () => {
    currentSettings = {
      ...currentSettings,
      isLoggedIn: false,
      personnelName: '',
      role: 'kargo_kabul',
      username: '',
      isAdmin: false,
      autoLogin: false
    };
    saveSettings(currentSettings);

    clipboardMonitor.stop();
    monitoringEnabled = true;
    if (statusInterval) {
      clearTimeout(statusInterval);
      statusInterval = null;
    }
    if (priorityUnsubscribe) {
      priorityUnsubscribe();
      priorityUnsubscribe = null;
    }
    if (deviceCallsUnsubscribe) {
      deviceCallsUnsubscribe();
      deviceCallsUnsubscribe = null;
    }
    windowManager.closeAllDeviceCallToasts();
    globalShortcut.unregisterAll();
    windowManager.closePopup();
    windowManager.closePriorityPopup();
    windowManager.getMainWindow()?.hide();
    const loginWindow = windowManager.getLoginWindow() || windowManager.createLoginWindow();
    loginWindow.show();
    loginWindow.focus();
    return true;
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
  ipcMain.on('open-admin', () => {
    windowManager.getMainWindow()?.webContents.send('switch-view', 'admin');
    windowManager.getMainWindow()?.show();
  });
  ipcMain.on('open-priority', () => {
    windowManager.getMainWindow()?.webContents.send('switch-view', 'priority');
    windowManager.getMainWindow()?.show();
  });

  ipcMain.handle('login-success', async () => {
    windowManager.onLoginSuccess();
    
    // Uygulama login olduğunda arka plan işlemlerini başlat
    clipboardMonitor.start();
    startServerStatusMonitor();
    startPriorityDevicesListener();
    startDeviceCallsListener();
    registerShortcuts();
    
    return true;
  });

  ipcMain.on('minimize-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.minimize();
  });

  ipcMain.on('close-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.close();
  });

  ipcMain.on('show-login-window', () => {
    const loginWindow = windowManager.getLoginWindow() || windowManager.createLoginWindow();
    loginWindow.show();
    loginWindow.focus();
  });

  ipcMain.on('open-main-view', (_, view) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('switch-view', view);
  });

  ipcMain.on('open-priority-device', (_, device) => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('switch-view', 'priority');
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-priority-device', device);
      }
    }, 180);
  });

  ipcMain.handle('calculate-zreport', async (_, fileData) => {
    try {
      let buffer: Buffer;
      if (typeof fileData === 'string') {
        buffer = fs.readFileSync(fileData);
      } else {
        buffer = Buffer.from(fileData);
      }
      return parseZReportData(buffer);
    } catch (error) {
      console.error('Z-Report calculation error:', error);
      throw error;
    }
  });

  ipcMain.handle('toggle-double-copy', async (_, enabled) => {
    currentSettings.doubleCopyEnabled = enabled;
    saveSettings(currentSettings);
    return enabled;
  });

  ipcMain.handle('save-note', async () => { });
  ipcMain.handle('get-note', async () => null);

  ipcMain.on('popup-hover-enter', () => {
    windowManager.pausePopupTimeout();
  });

  ipcMain.on('popup-hover-leave', () => {
    windowManager.resumePopupTimeout();
  });

  ipcMain.handle('clear-cache', async () => {
    await clearCache();
    return await loadCache();
  });

  ipcMain.on('manual-server-status-refresh', () => {
    checkServerStatus();
  });

  ipcMain.handle('delete-entry', async (_, s) => {
    await deleteEntry(s);
    return await loadCache();
  });

  ipcMain.handle('get-users', async () => {
    try {
      return await getUsers();
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
  });

  ipcMain.handle('create-user', async (_, data) => {
    try {
      const id = await createUser(data);
      return { success: true, id };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('update-user', async (_, id, data) => {
    try {
      await updateUser(id, data);
      return { success: true };
    } catch (error) {
      console.error('Error updating user:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('delete-user', async (_, id) => {
    try {
      await deleteUser(id);
      return { success: true };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('reset-user-xp', async (_, id) => {
    try {
      await resetUserXp(id);
      return { success: true };
    } catch (error) {
      console.error('Error resetting XP:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Priority Devices IPC ──────────────────────────────────────────
  ipcMain.handle('get-priority-devices', async () => cachedPriorityDevices);

  ipcMain.handle('add-priority-device', async (_, data) => {
    try {
      const id = await addPriorityDevice(data);
      return { success: true, id };
    } catch (error) {
      console.error('Error adding priority device:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('delete-priority-device', async (_, id) => {
    try {
      await deletePriorityDevice(id);
      return { success: true };
    } catch (error) {
      console.error('Error deleting priority device:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('update-priority-device', async (_, id, data) => {
    try {
      await updatePriorityDevice(id, data);
      return { success: true };
    } catch (error) {
      console.error('Error updating priority device:', error);
      return { success: false, error: String(error) };
    }
  });
  // ── Device Calls IPC ──────────────────────────────────────────
  ipcMain.handle('create-device-call', async (_, data) => {
    try {
      const id = await createDeviceCall(data);
      return { success: true, id };
    } catch (error) {
      console.error('Error creating device call:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('resolve-device-call', async (_, id, resolved_by) => {
    try {
      await resolveDeviceCall(id, resolved_by);
      return { success: true };
    } catch (error) {
      console.error('Error resolving device call:', error);
      return { success: false, error: String(error) };
    }
  });

  // Device call toast window action (from the native toast window)
  ipcMain.on('device-call-action', async (_, payload) => {
    const { action, callId } = payload;
    if (action === 'here') {
      const myName = currentSettings.personnelName || 'Bilinmiyor';
      try {
        await resolveDeviceCall(callId, myName);
      } catch (err) {
        console.error('device-call-action here error:', err);
      }
    } else if (action === 'cancel') {
      // Caller cancels the call — marks as cancelled in Firestore → all windows close
      try {
        await cancelDeviceCall(callId);
      } catch (err) {
        console.error('device-call-action cancel error:', err);
        // Even if Firestore fails, close this window locally
        windowManager.closeDeviceCallToast(callId);
      }
    } else if (action === 'nothere') {
      // Write dismissal to Firestore so caller sees it in their status list
      const myName = currentSettings.personnelName || 'Bilinmiyor';
      try {
        await dismissDeviceCallBy(callId, myName);
      } catch (err) {
        console.error('device-call-action nothere error:', err);
      }
      // Close only this user's toast window for this call — do NOT resolve
      windowManager.closeDeviceCallToast(callId);
    }
  });

  ipcMain.on('resize-device-call-toast', (_, payload) => {
    if (payload && payload.callId && typeof payload.height === 'number') {
      windowManager.resizeDeviceCallToast(payload.callId, payload.height);
    }
  });
}

function normalizeName(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '')
    .trim();
}

function startDeviceCallsListener() {
  if (deviceCallsUnsubscribe) {
    deviceCallsUnsubscribe();
    deviceCallsUnsubscribe = null;
  }

  // Track which calls we have already shown a toast for, and their last status
  const shownCalls = new Map<string, string>(); // callId -> status

  deviceCallsUnsubscribe = subscribeToDeviceCalls((calls: any[]) => {
    cachedDeviceCalls = calls;

    // Also notify main window renderer (for in-app state)
    const mainWin = windowManager.getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('device-calls-update', calls);
    }

    const myName = currentSettings.personnelName || '';
    const myUsername = currentSettings.username || '';
    const myRole = currentSettings.role;

    // Only show toasts for kargo_kabul
    if (myRole !== 'kargo_kabul') return;

    calls.forEach((call: any) => {
      const creatorClean = normalizeName(call.created_by);
      const isMine = creatorClean !== '' && (
        creatorClean === normalizeName(myName) ||
        creatorClean === normalizeName(myUsername)
      );

      const prevStatus = shownCalls.get(call.id);

      if (call.status === 'active') {
        if (!prevStatus) {
          // New call — open a toast window
          windowManager.showDeviceCallToast(call.id, {
            ...call,
            isMine
          });
          shownCalls.set(call.id, 'active');
          // Register this user as a recipient in Firestore (only for non-callers)
          if (!isMine && myName) {
            markDeviceCallRecipient(call.id, myName).catch(err =>
              console.error('markDeviceCallRecipient error:', err)
            );
          }
        } else if (prevStatus === 'active' && isMine) {
          // Relay live status update (recipients/dismissed_by) to caller's waiting window
          windowManager.sendDeviceCallStatusUpdate(call.id, {
            recipients: call.recipients || [],
            dismissed_by: call.dismissed_by || []
          });
        }
      } else if (call.status === 'resolved' || call.status === 'cancelled') {
        if (prevStatus === 'active') {
          if (call.status === 'resolved' && isMine && call.resolved_by) {
            // Tell the caller's toast to show resolution and auto-close after 8s
            windowManager.sendDeviceCallToastResolve(call.id, call);
            setTimeout(() => windowManager.closeDeviceCallToast(call.id), 8000);
          } else {
            // Others (or caller cancelled): close the toast immediately
            windowManager.closeDeviceCallToast(call.id);
          }
          shownCalls.set(call.id, call.status);
        }
      }
    });

    // Remove windows for calls that disappeared from Firestore entirely
    const currentIds = new Set(calls.map((c: any) => c.id));
    shownCalls.forEach((_, id) => {
      if (!currentIds.has(id)) {
        windowManager.closeDeviceCallToast(id);
        shownCalls.delete(id);
      }
    });
  });
}

// Helper to create the system tray
function createTray() {
  const mainWindow = windowManager.getMainWindow();

  // Robust icon path for both dev and prod
  let iconPath = path.join(__dirname, '../../assets/logo.png');

  if (!fs.existsSync(iconPath)) {
    // Fallback for some packaging structures
    iconPath = path.join(process.resourcesPath, 'assets/logo.png');
  }

  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('RecciTek WCheck');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Çıkış', click: () => windowManager.forceQuit() }
  ]));

  tray.on('double-click', () => {
    if (currentSettings && currentSettings.isLoggedIn) {
      mainWindow?.show();
      mainWindow?.focus();
    } else {
      const loginWin = windowManager.getLoginWindow();
      loginWin?.show();
      loginWin?.focus();
    }
  });
}

// Helper to register global shortcuts
function registerShortcuts() {
  globalShortcut.unregisterAll(); // Unregister all existing shortcuts

  if (!currentSettings || !currentSettings.isLoggedIn) return; // Login olmadıysa kısayolları kaydetme

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

function startPriorityDevicesListener() {
  if (priorityUnsubscribe) {
    priorityUnsubscribe();
    priorityUnsubscribe = null;
  }
  priorityUnsubscribe = subscribeToPriorityDevices((devices: any[]) => {
    cachedPriorityDevices = devices;
    BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
      if (!win.isDestroyed()) {
        win.webContents.send('priority-devices-update', devices);
      }
    });
  });
}



function initializeApp() {
  currentSettings = loadSettings();
  currentSettings.isLoggedIn = false; // Always force start in a logged out state
  windowManager = new WindowManager(__dirname);
  clipboardMonitor = new ClipboardMonitor(handleDetection);
  registerShortcuts(); // Will exit early due to isLoggedIn = false
  monitoringEnabled = true;

  const wasOpenedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true;
  const splash = wasOpenedAtLogin ? null : windowManager.createSplashWindow();
  const startupDelay = wasOpenedAtLogin ? 0 : 1800;

  setTimeout(() => {
    try {
      splash?.close();
    } catch { }

    const shouldAutoLogin = !!(currentSettings.autoLogin && currentSettings.rememberMe && currentSettings.savedUsername && currentSettings.savedPassword);

    // Instead of showing the main window directly, create it hidden and show the login window
    windowManager.createMainWindow(); // It starts hidden
    windowManager.createLoginWindow(!shouldAutoLogin);

    createTray();
    
    // Do NOT start monitors yet; wait for login success (ipcMain.handle('login-success'))

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

    let lastUpdateCheckResult: any = null;

    ipcMain.handle('check-for-updates', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        lastUpdateCheckResult = result;
        return { success: true, updateInfo: result?.updateInfo };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Güncelleme kontrolü başarısız' };
      }
    });

    ipcMain.on('start-update-download', async () => {
      try {
        // If we have a cancellationToken from the check, use it; otherwise re-check first
        if (lastUpdateCheckResult?.cancellationToken) {
          await autoUpdater.downloadUpdate(lastUpdateCheckResult.cancellationToken);
        } else {
          // Fallback: re-check and download
          const result = await autoUpdater.checkForUpdates();
          lastUpdateCheckResult = result;
          if (result?.cancellationToken) {
            await autoUpdater.downloadUpdate(result.cancellationToken);
          } else {
            await autoUpdater.downloadUpdate();
          }
        }
      } catch (err: any) {
        console.error('Download update error:', err?.message);
        const mainWindow = windowManager?.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-error', err?.message || 'İndirme başarısız');
        }
      }
    });

    ipcMain.on('install-update', () => {
      autoUpdater.autoInstallOnAppQuit = false;
      // Force quit: isSilent=false shows NSIS UI, isForceRunAfter=true restarts app after setup
      autoUpdater.quitAndInstall(false, true);
      // Force-kill the process (including tray) so setup.exe isn't blocked
      setTimeout(() => app.exit(0), 500);
    });

    // Run update check 3 seconds after startup
    setTimeout(() => {
      autoUpdater.checkForUpdates().then(result => {
        lastUpdateCheckResult = result;
      }).catch((err) => {
        console.log('Startup update check failed:', err?.message);
      });
    }, 3000);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (priorityUnsubscribe) {
    priorityUnsubscribe();
    priorityUnsubscribe = null;
  }
  if (deviceCallsUnsubscribe) {
    deviceCallsUnsubscribe();
    deviceCallsUnsubscribe = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

