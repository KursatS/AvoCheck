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
  soundEnabled?: boolean;
  shortcuts?: {
    copyModelColor?: string;
    clearCache?: string;
    toggleMonitoring?: string;
  };
  theme?: 'dark' | 'light';
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function getAppDataDir(): string {
  const avoDir = path.join(app.getPath('documents'), 'AvoCheck');
  const legacyDir = path.join(app.getPath('documents'), 'RecciTek');

  if (!fs.existsSync(avoDir)) {
    if (fs.existsSync(legacyDir)) {
      try {
        if (typeof fs.cpSync === 'function') {
          fs.cpSync(legacyDir, avoDir, { recursive: true });
        }
      } catch (err) {
        console.error('Failed to migrate legacy documents:', err);
      }
    }
    if (!fs.existsSync(avoDir)) {
      try {
        fs.mkdirSync(avoDir, { recursive: true });
      } catch (err) {
        console.error('Failed to create AvoCheck directory:', err);
      }
    }
  }
  return avoDir;
}

export function getSettingsPath(): string {
  return path.join(getAppDataDir(), 'settings.json');
}

export function loadSettings(): AppSettings {
  const defaultSettings: AppSettings = {
    popupTimeout: 5000,
    popupSizeLevel: 2,
    doubleCopyEnabled: true,
    autoStartEnabled: false,
    preventDuplicatePopup: true,
    clipboardUpperEnabled: true,
    soundEnabled: true,
    shortcuts: {
      copyModelColor: 'CommandOrControl+Shift+C',
      clearCache: 'CommandOrControl+Shift+X',
      toggleMonitoring: 'CommandOrControl+Shift+M'
    },
    theme: 'dark'
  };

  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(data);
      // Normalize legacy theme names to 'dark' | 'light'
      let theme: 'dark' | 'light' = 'dark';
      if (parsed.theme === 'light') theme = 'light';
      return {
        ...defaultSettings,
        ...parsed,
        theme
      };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return defaultSettings;
}

export function saveSettings(settings: AppSettings): void {
  try {
    const p = getSettingsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}
