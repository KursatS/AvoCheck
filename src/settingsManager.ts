import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface AppSettings {
  popupTimeout: number;
  popupSizeLevel: number;
  doubleCopyEnabled: boolean;
  autoStartEnabled: boolean;
  preventDuplicatePopup: boolean;
  clipboardUpperEnabled?: boolean;
  shortcuts?: {
    copyModelColor?: string;
    clearCache?: string;
    toggleMonitoring?: string;
  };
  role?: 'kargo_kabul' | 'mh' | 'admin';
  personnelName?: string;
  username?: string;
  isAdmin?: boolean;
  isLoggedIn?: boolean;
  rememberMe?: boolean;
  autoLogin?: boolean;
  savedUsername?: string;
  savedPassword?: string;
  theme?: 'dark' | 'midnight' | 'ocean' | 'sunset';
  workingHours?: {
    start: string;
    end: string;
  };
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function getSettingsPath(): string {
  return path.join(app.getPath('documents'), 'RecciTek', 'settings.json');
}

export function loadSettings(): AppSettings {
  const defaultSettings: AppSettings = {
    popupTimeout: 5000,
    popupSizeLevel: 2,
    doubleCopyEnabled: true,
    autoStartEnabled: false,
    preventDuplicatePopup: true,
    clipboardUpperEnabled: true,
    shortcuts: {
      copyModelColor: 'CommandOrControl+Shift+C',
      clearCache: 'CommandOrControl+Shift+X',
      toggleMonitoring: 'CommandOrControl+Shift+M'
    },
    role: 'kargo_kabul',
    personnelName: '',
    theme: 'dark',
    rememberMe: false,
    autoLogin: false,
    savedUsername: '',
    savedPassword: '',
    workingHours: {
      start: '09:30',
      end: '18:30'
    }
  };

  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const savedSettings = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { ...defaultSettings, ...savedSettings, isLoggedIn: true };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }

  return { ...defaultSettings, isLoggedIn: true };
}

export function saveSettings(settings: AppSettings): void {
  try {
    const settingsPath = getSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}
