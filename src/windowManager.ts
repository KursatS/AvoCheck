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

export class WindowManager {
    private mainWindow: BrowserWindow | null = null;
    private currentPopup: BrowserWindow | null = null;
    private popupTimeout: NodeJS.Timeout | null = null;
    private popupVisible = false;
    private popupStartTime = 0;
    private popupRemaining = 0;
    private preloadPath = '';
    private mainWindowReady = false;

    constructor(private appPath: string) {
        this.preloadPath = path.join(__dirname, '../preload/index.js');
    }

    private loadFile(win: BrowserWindow, fileName: string): void {
        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
            win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${fileName}`);
        } else {
            win.loadFile(path.join(__dirname, `../renderer/${fileName}`));
        }
    }

    private getPopupBounds(sizeLevel: number) {
        const size = POPUP_SIZE_LEVELS.find(l => l.level === sizeLevel) || POPUP_SIZE_LEVELS[2];
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const winWidth = size.width;
        const winHeight = size.height;
        const baseX = width - winWidth - 20;
        const baseY = height - winHeight - 40;
        return {
            size,
            winWidth,
            winHeight,
            x: baseX,
            y: baseY
        };
    }

    private createPopupWindow(sizeLevel: number): BrowserWindow {
        const { winWidth, winHeight, x, y } = this.getPopupBounds(sizeLevel);
        return new BrowserWindow({
            width: winWidth,
            height: winHeight,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: false,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
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
            width: bounds?.width || 980,
            height: bounds?.height || 680,
            x: bounds?.x,
            y: bounds?.y,
            minWidth: 640,
            minHeight: 500,
            show: false,
            backgroundColor: settings.theme === 'light' ? '#ecefea' : '#0e1015',
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

            // Reflow resize
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

        this.mainWindow.webContents.on('render-process-gone', (_e, details) => {
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

    getMainWindow(): BrowserWindow | null {
        return this.mainWindow;
    }

    showPopup(info: any, timeoutDuration: number, sizeLevel: number): void {
        this.closePopup();

        this.currentPopup = this.createPopupWindow(sizeLevel);
        this.loadFile(this.currentPopup, 'popup.html');

        this.currentPopup.once('ready-to-show', () => {
            if (!this.currentPopup) return;
            this.currentPopup.show();
            this.popupVisible = true;

            const settings = loadSettings();
            const payload = { ...info, sizeLevel, theme: settings.theme || 'dark' };
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

    forceQuit(): void {
        [this.mainWindow, this.currentPopup].forEach(win => {
            if (win && !win.isDestroyed()) {
                win.destroy();
            }
        });
        app.exit(0);
    }
}
