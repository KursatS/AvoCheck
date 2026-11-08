import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';
import { is } from '@electron-toolkit/utils';
import { loadSettings, saveSettings } from './settingsManager';

export interface PopupSize {
    level: number;
    file: string;
    width: number;
    height: number;
    label: string;
}

export const POPUP_SIZE_LEVELS: PopupSize[] = [
    { level: 1, file: 'popup.html', width: 400, height: 300, label: 'Küçük' },
    { level: 2, file: 'popup.html', width: 460, height: 330, label: 'Orta' },
    { level: 3, file: 'popup.html', width: 500, height: 350, label: 'Büyük' }
];

type PopupKind = 'warranty' | 'priority';

export class WindowManager {
    private mainWindow: BrowserWindow | null = null;
    private loginWindow: BrowserWindow | null = null;
    private currentPopup: BrowserWindow | null = null;
    private priorityPopup: BrowserWindow | null = null;
    private popupTimeout: NodeJS.Timeout | null = null;
    private priorityPopupTimeout: NodeJS.Timeout | null = null;
    private popupVisible = false;
    private popupStartTime = 0;
    private popupRemaining = 0;
    private preloadPath = '';
    private mainWindowReady = false;
    private deviceCallToasts: Map<string, BrowserWindow> = new Map();

    constructor(private appPath: string) {
        this.preloadPath = path.join(__dirname, '../preload/index.js');
    }

    private loadFile(win: BrowserWindow, fileName: string): void {
        if (is.dev) {
            if (fileName === 'deviceCallToast.html') {
                // Standalone HTML — not part of Vite dev server, load from src/ directly
                // app.getAppPath() gives the project root in dev mode
                win.loadFile(path.join(app.getAppPath(), 'src', fileName));
            } else if (process.env['ELECTRON_RENDERER_URL']) {
                win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${fileName}`);
            } else {
                win.loadFile(path.join(__dirname, `../renderer/${fileName}`));
            }
        } else {
            win.loadFile(path.join(__dirname, `../renderer/${fileName}`));
        }
    }

    private getPopupBounds(sizeLevel: number, kind: PopupKind) {
        const size = POPUP_SIZE_LEVELS.find(l => l.level === sizeLevel) || POPUP_SIZE_LEVELS[2];
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const baseX = width - size.width - 20;
        const baseY = height - size.height - 60;
        return {
            size,
            x: baseX,
            y: kind === 'priority' ? Math.max(20, baseY - size.height - 18) : baseY
        };
    }

    private createPopupWindow(sizeLevel: number, kind: PopupKind): BrowserWindow {
        const { size, x, y } = this.getPopupBounds(sizeLevel, kind);
        return new BrowserWindow({
            width: size.width,
            height: size.height,
            show: false,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            x,
            y,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.preloadPath
            }
        });
    }

    createSplashWindow(): BrowserWindow {
        const splash = new BrowserWindow({
            width: 600,
            height: 400,
            frame: false,
            alwaysOnTop: true,
            resizable: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        this.loadFile(splash, 'splash.html');
        return splash;
    }

    createMainWindow(): BrowserWindow {
        const settings = loadSettings();
        const bounds = settings.windowBounds;

        this.mainWindow = new BrowserWindow({
            width: bounds?.width || 800,
            height: bounds?.height || 600,
            x: bounds?.x,
            y: bounds?.y,
            minWidth: 475,
            minHeight: 400,
            show: false,
            backgroundColor: '#0f172a',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.preloadPath
            },
            icon: path.join(__dirname, '../../assets/logo.png'),
            autoHideMenuBar: true
        });

        this.mainWindowReady = false;
        this.loadFile(this.mainWindow, 'index.html');

        let hasShown = false;
        const showWindow = () => {
            if (hasShown || !this.mainWindow || this.mainWindow.isDestroyed()) return;
            hasShown = true;
            this.mainWindowReady = true;
            this.mainWindow.show();
            this.mainWindow.focus();

            // Force reflow/repaint to prevent Windows Chromium flex layout glitch
            try {
                const size = this.mainWindow.getSize();
                this.mainWindow.setSize(size[0] + 1, size[1]);
                setTimeout(() => {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.setSize(size[0], size[1]);
                    }
                }, 50);
            } catch (err) { }

            this.mainWindow.webContents.send('refresh-cards');
        };

        this.mainWindow.once('ready-to-show', showWindow);
        this.mainWindow.webContents.once('did-finish-load', showWindow);
        setTimeout(showWindow, 1200);

        // Auto-recover if renderer crashes or freezes (prevents black screen on office GPUs)
        this.mainWindow.webContents.on('render-process-gone', (_event, details) => {
            console.warn('[WindowManager] Renderer process gone, reloading...', details);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.reload();
            }
        });

        this.mainWindow.on('unresponsive', () => {
            console.warn('[WindowManager] Main window unresponsive, reloading...');
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.reload();
            }
        });

        let saveBoundsTimer: NodeJS.Timeout | null = null;
        const saveBounds = () => {
            if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
            saveBoundsTimer = setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isMaximized()) {
                    const b = this.mainWindow.getBounds();
                    const s = loadSettings();
                    saveSettings({ ...s, windowBounds: b });
                }
            }, 800);
        };

        this.mainWindow.on('resize', saveBounds);
        this.mainWindow.on('move', saveBounds);

        this.mainWindow.on('close', (e) => {
            if (this.mainWindow) {
                e.preventDefault();
                this.mainWindow.hide();
            }
        });

        return this.mainWindow;
    }

    createLoginWindow(showOnReady: boolean = true): BrowserWindow {
        this.loginWindow = new BrowserWindow({
            width: 480,
            height: 480,
            frame: false,
            resizable: false,
            show: false,
            backgroundColor: '#0f172a',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.preloadPath
            },
            icon: path.join(__dirname, '../../assets/logo.png')
        });

        this.loadFile(this.loginWindow, 'login.html');
        if (showOnReady) {
            this.loginWindow.once('ready-to-show', () => this.loginWindow?.show());
        }

        this.loginWindow.on('closed', () => {
            if (!this.mainWindow?.isVisible()) {
                this.forceQuit();
            }
            this.loginWindow = null;
        });

        return this.loginWindow;
    }

    onLoginSuccess(): void {
        if (this.loginWindow && !this.loginWindow.isDestroyed()) {
            this.loginWindow.close();
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            let hasShown = false;
            const showMainWindow = () => {
                if (hasShown) return;
                if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
                hasShown = true;
                this.mainWindow.show();
                this.mainWindow.focus();

                // Force layout reflow to fix content shifting to top-left bug
                try {
                    const size = this.mainWindow.getSize();
                    this.mainWindow.setSize(size[0] + 1, size[1]);
                    setTimeout(() => {
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.setSize(size[0], size[1]);
                        }
                    }, 50);
                } catch (err) {
                    console.error('Failed to trigger window force-resize:', err);
                }

                this.mainWindow.webContents.send('refresh-cards');
            };

            if (this.mainWindowReady || !this.mainWindow.webContents.isLoadingMainFrame()) {
                showMainWindow();
            } else {
                this.mainWindow.once('ready-to-show', showMainWindow);
                this.mainWindow.webContents.once('did-finish-load', showMainWindow);
            }
        }
    }

    getMainWindow(): BrowserWindow | null {
        return this.mainWindow;
    }

    getLoginWindow(): BrowserWindow | null {
        return this.loginWindow;
    }

    showPopup(info: any, timeoutDuration: number, sizeLevel: number): void {
        const kind: PopupKind = info?.variant === 'priority' ? 'priority' : 'warranty';
        if (kind === 'priority') {
            this.showPriorityPopup(info, timeoutDuration, sizeLevel);
            return;
        }
        this.showWarrantyPopup(info, timeoutDuration, sizeLevel);
    }

    private showWarrantyPopup(info: any, timeoutDuration: number, sizeLevel: number): void {
        this.closePopup();

        this.currentPopup = this.createPopupWindow(sizeLevel, 'warranty');
        this.loadFile(this.currentPopup, 'popup.html');

        this.currentPopup.once('ready-to-show', () => {
            if (!this.currentPopup) return;
            this.currentPopup.show();
            this.popupVisible = true;

            const settings = loadSettings();
            const payload = { ...info, sizeLevel, theme: settings.theme || 'dark', variant: 'warranty' };
            this.currentPopup.webContents.send('popup-data', payload, timeoutDuration);

            this.popupStartTime = Date.now();
            this.popupRemaining = timeoutDuration;
            this.popupTimeout = setTimeout(() => this.closePopup(), timeoutDuration);
        });

        const popup = this.currentPopup;
        popup.on('closed', () => {
            if (this.currentPopup === popup) {
                this.currentPopup = null;
                this.popupVisible = false;
            }
        });
    }

    private showPriorityPopup(info: any, timeoutDuration: number, sizeLevel: number): void {
        this.closePriorityPopup();

        this.priorityPopup = this.createPopupWindow(sizeLevel, 'priority');
        this.loadFile(this.priorityPopup, 'popup.html');

        this.priorityPopup.once('ready-to-show', () => {
            if (!this.priorityPopup) return;
            this.priorityPopup.show();

            const settings = loadSettings();
            const payload = { ...info, sizeLevel, theme: settings.theme || 'dark', variant: 'priority' };
            this.priorityPopup.webContents.send('popup-data', payload, timeoutDuration);

            this.priorityPopupTimeout = setTimeout(() => this.closePriorityPopup(), timeoutDuration);
            const anchorDelay = typeof info?.anchorDelay === 'number' ? info.anchorDelay : settings.popupTimeout;
            setTimeout(() => {
                if (!this.priorityPopup || this.priorityPopup.isDestroyed()) return;
                const targetBounds = this.getPopupBounds(sizeLevel, 'warranty');
                this.animatePriorityPopupTo(targetBounds.x, targetBounds.y);
            }, Math.max(300, anchorDelay));
        });

        const popup = this.priorityPopup;
        popup.on('closed', () => {
            if (this.priorityPopup === popup) {
                this.priorityPopup = null;
            }
        });
    }

    closePopup(): void {
        if (this.popupTimeout) {
            clearTimeout(this.popupTimeout);
            this.popupTimeout = null;
        }
        if (this.currentPopup && !this.currentPopup.isDestroyed()) {
            this.currentPopup.close();
            this.currentPopup = null;
        }
        this.popupVisible = false;
    }

    closePriorityPopup(): void {
        if (this.priorityPopupTimeout) {
            clearTimeout(this.priorityPopupTimeout);
            this.priorityPopupTimeout = null;
        }
        if (this.priorityPopup && !this.priorityPopup.isDestroyed()) {
            this.priorityPopup.close();
            this.priorityPopup = null;
        }
    }

    private animatePriorityPopupTo(targetX: number, targetY: number): void {
        if (!this.priorityPopup || this.priorityPopup.isDestroyed()) return;

        const startBounds = this.priorityPopup.getBounds();
        const steps = 12;
        const duration = 240;
        const deltaX = (targetX - startBounds.x) / steps;
        const deltaY = (targetY - startBounds.y) / steps;
        let currentStep = 0;

        const interval = setInterval(() => {
            if (!this.priorityPopup || this.priorityPopup.isDestroyed()) {
                clearInterval(interval);
                return;
            }

            currentStep++;
            const nextX = Math.round(startBounds.x + deltaX * currentStep);
            const nextY = Math.round(startBounds.y + deltaY * currentStep);
            this.priorityPopup.setPosition(nextX, nextY);

            if (currentStep >= steps) {
                clearInterval(interval);
                if (this.priorityPopup && !this.priorityPopup.isDestroyed()) {
                    this.priorityPopup.setPosition(targetX, targetY);
                }
            }
        }, duration / steps);
    }

    isPopupVisible(): boolean {
        return this.popupVisible;
    }

    pausePopupTimeout(): void {
        if (this.popupTimeout) {
            clearTimeout(this.popupTimeout);
            this.popupTimeout = null;
            const elapsed = Date.now() - this.popupStartTime;
            this.popupRemaining = Math.max(0, this.popupRemaining - elapsed);
        }
    }

    resumePopupTimeout(): void {
        if (!this.popupTimeout && this.popupVisible && this.popupRemaining > 0) {
            this.popupStartTime = Date.now();
            this.popupTimeout = setTimeout(() => this.closePopup(), this.popupRemaining);
        }
    }

    showDeviceCallToast(callId: string, data: any): void {
        // Don't create a duplicate window for the same call
        if (this.deviceCallToasts.has(callId)) {
            const existing = this.deviceCallToasts.get(callId)!;
            if (!existing.isDestroyed()) {
                existing.webContents.send('device-call-toast-data', data);
                return;
            }
        }

        const { width } = screen.getPrimaryDisplay().workAreaSize;
        const toastWidth = 440;
        // Search state (others): model + serial + customer? + caller + 2 buttons
        // Waiting state (caller): model + serial + customer? + cancel button
        // Add room for customer line if present
        const hasCustomer = !!(data.customer_name && data.customer_name.trim());
        // isMine (caller/waiting view): badge + model + serial + [customer] + personnel list header + cancel btn
        // Others (search view): badge + model + serial + [customer] + caller + 2 action btns
        // Personnel list grows dynamically; start with enough for ~2 entries, window clips at max anyway
        const toastHeight = data.isMine
            ? (hasCustomer ? 280 : 256)
            : (hasCustomer ? 268 : 242);
        const x = Math.round((width - toastWidth) / 2);
        const y = 24;

        const win = new BrowserWindow({
            width: toastWidth,
            height: toastHeight,
            x,
            y,
            show: false,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            focusable: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.preloadPath
            }
        });

        // Keep it above everything including fullscreen apps
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        this.loadFile(win, 'deviceCallToast.html');
        this.deviceCallToasts.set(callId, win);

        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) {
                win.showInactive(); // show without stealing focus from active app
                // Small delay ensures renderer JS is ready before receiving the data
                setTimeout(() => {
                    if (!win.isDestroyed()) {
                        win.webContents.send('device-call-toast-data', data);
                    }
                }, 80);
            }
        });

        win.on('closed', () => {
            this.deviceCallToasts.delete(callId);
        });
    }

    sendDeviceCallToastResolve(callId: string, data: any): void {
        const win = this.deviceCallToasts.get(callId);
        if (win && !win.isDestroyed()) {
            win.webContents.send('device-call-toast-resolve', data);
        }
    }

    sendDeviceCallStatusUpdate(callId: string, statusData: any): void {
        const win = this.deviceCallToasts.get(callId);
        if (win && !win.isDestroyed()) {
            win.webContents.send('device-call-status-update', statusData);
        }
    }

    resizeDeviceCallToast(callId: string, height: number): void {
        const win = this.deviceCallToasts.get(callId);
        if (win && !win.isDestroyed()) {
            // Clamp window height between reasonable limits (e.g. 130px min, 460px max)
            const targetHeight = Math.max(130, Math.min(Math.ceil(height), 460));
            const [currentWidth] = win.getSize();
            win.setSize(currentWidth, targetHeight);
        }
    }

    closeDeviceCallToast(callId: string): void {
        const win = this.deviceCallToasts.get(callId);
        if (win && !win.isDestroyed()) {
            win.close();
        }
        this.deviceCallToasts.delete(callId);
    }

    closeAllDeviceCallToasts(): void {
        this.deviceCallToasts.forEach((win) => {
            if (!win.isDestroyed()) win.close();
        });
        this.deviceCallToasts.clear();
    }

    forceQuit(): void {
        this.closeAllDeviceCallToasts();
        [this.mainWindow, this.loginWindow, this.currentPopup, this.priorityPopup].forEach(win => {
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
        });
        app.exit(0);
    }
}
