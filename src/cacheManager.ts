import Database from 'better-sqlite3';
import * as path from 'path';
const electron = require('electron');
const { app } = electron;

let db: any = null;
export const CACHE_MAX_AGE_DAYS = 3;

function getCacheMaxAgeMs(): number {
  return CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export function initCache() {
  console.log('Initializing cache...');
  try {
    const dbDir = path.join(app.getPath('documents'), 'RecciTek');
    console.log('DB Directory:', dbDir);
    const fs = require('fs');

    // Create RecciTek directory in Documents if it doesn't exist
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, 'cache.db');
    db = new Database(dbPath);

    db.exec(`CREATE TABLE IF NOT EXISTS cache (
      serial TEXT PRIMARY KEY,
      model_name TEXT,
      model_color TEXT,
      warranty_status TEXT,
      copy_date TEXT,
      warranty_end TEXT,
      status TEXT
    )`);

    // Check if status column exists manually to avoid noisy SQLITE_ERROR
    const tableInfo = db.prepare('PRAGMA table_info(cache)').all();
    const hasStatus = tableInfo.some((col: any) => col.name === 'status');
    if (!hasStatus) {
      try {
        db.exec(`ALTER TABLE cache ADD COLUMN status TEXT`);
      } catch (err) {
        console.error('Failed to add status column:', err);
      }
    }

    // Purge entries older than 3 days to prevent stale warranty data
    purgeOldCache();
  } catch (err) {
    console.error('Error in initCache:', err);
  }
}

export function purgeOldCache(): void {
  if (!db) return;
  try {
    const staleThreshold = new Date(Date.now() - getCacheMaxAgeMs()).toISOString();
    const result = db.prepare('DELETE FROM cache WHERE copy_date < ?').run(staleThreshold);
    if (result.changes > 0) {
      console.log(`Cache: ${result.changes} eski kayit silindi (3 gunden eski).`);
    }
  } catch (err) {
    console.error('Error purging old cache:', err);
  }
}

interface CacheEntry {
  serial: string;
  model_name: string;
  model_color: string;
  warranty_status: string;
  copy_date: string;
  warranty_end?: string;
  status?: string;
}

export function loadCache(): Promise<CacheEntry[]> {
  if (!db) return Promise.resolve([]);
  try {
    const stmt = db.prepare('SELECT * FROM cache ORDER BY copy_date DESC LIMIT 500');
    return Promise.resolve(stmt.all() as CacheEntry[]);
  } catch (err) {
    console.error('Error loading cache:', err);
    return Promise.resolve([]);
  }
}

export function getCachedData(serial: string): Promise<CacheEntry | null> {
  if (!db) return Promise.resolve(null);
  try {
    const stmt = db.prepare('SELECT * FROM cache WHERE serial = ?');
    return Promise.resolve((stmt.get(serial) as CacheEntry) || null);
  } catch (err) {
    console.error('Error getting cached data:', err);
    return Promise.resolve(null);
  }
}

export function isCacheEntryStale(entry: Pick<CacheEntry, 'copy_date'> | null | undefined): boolean {
  if (!entry?.copy_date) return true;

  const copiedAt = new Date(entry.copy_date);
  if (Number.isNaN(copiedAt.getTime())) return true;

  return Date.now() - copiedAt.getTime() >= getCacheMaxAgeMs();
}

export function saveToCache(serial: string, info: any): Promise<void> {
  if (!db) return Promise.resolve();
  try {
    const entry: CacheEntry = {
      serial,
      model_name: info.model_name || '',
      model_color: info.model_color || '',
      warranty_status: info.warranty_status,
      copy_date: new Date().toISOString(),
      warranty_end: info.warranty_end,
      status: info.status || ''
    };
    const stmt = db.prepare(`INSERT OR REPLACE INTO cache (serial, model_name, model_color, warranty_status, copy_date, warranty_end, status) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(entry.serial, entry.model_name, entry.model_color, entry.warranty_status, entry.copy_date, entry.warranty_end, entry.status);
  } catch (err) {
    console.error('Error saving to cache:', err);
  }
  return Promise.resolve();
}

export function saveStatus(serial: string, status: string): Promise<void> {
  if (!db) return Promise.resolve();
  try {
    const stmt = db.prepare('UPDATE cache SET status = ? WHERE serial = ?');
    stmt.run(status, serial);
  } catch (err) {
    console.error('Error saving status:', err);
  }
  return Promise.resolve();
}

export function clearCache(): Promise<void> {
  if (!db) return Promise.resolve();
  try {
    const stmt = db.prepare('DELETE FROM cache');
    stmt.run();
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
  return Promise.resolve();
}

export function deleteEntry(serial: string): Promise<void> {
  if (!db) return Promise.resolve();
  try {
    const stmt = db.prepare('DELETE FROM cache WHERE serial = ?');
    stmt.run(serial);
  } catch (err) {
    console.error('Error deleting cache entry:', err);
  }
  return Promise.resolve();
}

export function getDatabasePath(): string {
  return path.join(app.getPath('documents'), 'RecciTek', 'cache.db');
}
