import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getAppDataDir } from './settingsManager';
import { spawn, ChildProcess, execSync } from 'child_process';

export interface Snippet {
    id: string;
    prefix: string;
    trigger: string;
    title: string;
    replacement: string;
    enabled: boolean;
    createdAt: number;
}

export interface TextExpanderConfig {
    enabled: boolean;
    defaultPrefix: string;
    snippets: Snippet[];
}

export class TextExpanderManager {
    private static instance: TextExpanderManager | null = null;
    private config: TextExpanderConfig;
    private configPath: string;
    private process: ChildProcess | null = null;
    private isStopping = false;
    private restartCount = 0;
    private healthyTimer: NodeJS.Timeout | null = null;

    private constructor() {
        const docDir = getAppDataDir();
        if (!fs.existsSync(docDir)) {
            try {
                fs.mkdirSync(docDir, { recursive: true });
            } catch (err) {
                console.error('[TextExpander] Failed to create documents dir:', err);
            }
        }
        this.configPath = path.join(docDir, 'snippets.json');
        this.config = this.loadConfig();
    }

    public static getInstance(): TextExpanderManager {
        if (!TextExpanderManager.instance) {
            TextExpanderManager.instance = new TextExpanderManager();
        }
        return TextExpanderManager.instance;
    }

    private getDefaultConfig(): TextExpanderConfig {
        return {
            enabled: true,
            defaultPrefix: ':',
            snippets: [
                {
                    id: 'snip-1',
                    prefix: ':',
                    trigger: 'adres',
                    title: 'RecciTek Servis Adresi',
                    replacement: 'RecciTek Roborock Yetkili Servis Merkezi\nAdres: Atatürk Mah. Çavuşbaşı Cad. No:12/A Ümraniye / İstanbul\nİletişim: 0850 304 40 40',
                    enabled: true,
                    createdAt: Date.now() - 4000
                },
                {
                    id: 'snip-2',
                    prefix: ':',
                    trigger: 'kargo',
                    title: 'Yurtiçi Kargo Anlaşma Kodu',
                    replacement: 'Roborock Servis Gönderim Kodu: Yurtiçi Kargo - 987654321 (Alıcı: RecciTek Bilişim Ltd. Şti.)',
                    enabled: true,
                    createdAt: Date.now() - 3000
                },
                {
                    id: 'snip-3',
                    prefix: ':',
                    trigger: 'garanti',
                    title: 'Distribütör Garantisi Bilgisi',
                    replacement: 'Cihazınız RecciTek Roborock Türkiye Resmi İthalatçı ve Üretici Garantisi kapsamındadır.',
                    enabled: true,
                    createdAt: Date.now() - 2000
                },
                {
                    id: 'snip-4',
                    prefix: ':',
                    trigger: 'fatura',
                    title: 'Fatura İnceleme Uyarısı',
                    replacement: '⚠️ Üretici sisteminde cihaz garanti süresi bitmiş görünmektedir. Lütfen fatura üzerindeki satın alma tarihini ibraz ediniz.',
                    enabled: true,
                    createdAt: Date.now() - 1000
                }
            ]
        };
    }

    private loadConfig(): TextExpanderConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const parsed = JSON.parse(data);
                if (parsed && Array.isArray(parsed.snippets)) {
                    return parsed;
                }
            }
        } catch (err) {
            console.error('[TextExpander] Failed to load snippets.json:', err);
        }
        const def = this.getDefaultConfig();
        this.saveConfigToFile(def);
        return def;
    }

    private saveConfigToFile(cfg: TextExpanderConfig): void {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err) {
            console.error('[TextExpander] Failed to write snippets.json:', err);
        }
    }

    private getExecutablePath(): string | null {
        // 1. Packaged app resources
        const prodPath = path.join(process.resourcesPath || '', 'resources', 'TextExpander.exe');
        if (fs.existsSync(prodPath)) return prodPath;

        // 2. Project root resources folder
        const localPath = path.join(app.getAppPath(), 'resources', 'TextExpander.exe');
        if (fs.existsSync(localPath)) return localPath;

        // 3. Fallback compile if in dev mode
        const csPath = path.join(app.getAppPath(), 'src', 'native', 'TextExpander.cs');
        if (fs.existsSync(csPath)) {
            try {
                const resDir = path.join(app.getAppPath(), 'resources');
                if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
                const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
                if (fs.existsSync(cscPath)) {
                    console.log('[TextExpander] Compiling TextExpander.cs on demand...');
                    execSync(`"${cscPath}" /nologo /target:winexe /out:"${localPath}" "${csPath}"`);
                    if (fs.existsSync(localPath)) return localPath;
                }
            } catch (err) {
                console.error('[TextExpander] On-demand compilation failed:', err);
            }
        }

        return null;
    }

    public start(): void {
        if (this.process) return;

        const exePath = this.getExecutablePath();
        if (!exePath) {
            console.warn('[TextExpander] Executable not found, skipping background hook start.');
            return;
        }

        try {
            console.log('[TextExpander] Spawning native hook process from:', exePath);
            this.process = spawn(exePath, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.process.stdout?.on('data', (data) => {
                const msg = data.toString().trim();
                console.log('[TextExpander Hook]:', msg);
            });

            this.process.stderr?.on('data', (data) => {
                console.error('[TextExpander Error]:', data.toString().trim());
            });

            // Process survived for 5 seconds -> reset restart count
            if (this.healthyTimer) clearTimeout(this.healthyTimer);
            this.healthyTimer = setTimeout(() => {
                this.restartCount = 0;
            }, 5000);

            this.process.on('close', (code) => {
                console.log('[TextExpander] Process exited with code:', code);
                this.process = null;
                if (this.healthyTimer) clearTimeout(this.healthyTimer);

                // Auto restart if closed unexpectedly with circuit breaker
                if (!this.isStopping && this.config.enabled) {
                    this.restartCount++;
                    if (this.restartCount <= 4) {
                        const delay = Math.min(1000 * this.restartCount, 5000);
                        console.log(`[TextExpander] Restarting in ${delay}ms (attempt ${this.restartCount}/4)...`);
                        setTimeout(() => this.start(), delay);
                    } else {
                        console.warn('[TextExpander] Too many restart attempts. Background hook paused to avoid loop.');
                    }
                }
            });

            // Send initial config
            this.syncConfigToProcess();
        } catch (err) {
            console.error('[TextExpander] Failed to spawn hook process:', err);
        }
    }

    private syncConfigToProcess(): void {
        if (!this.process || !this.process.stdin) return;
        try {
            const payload = JSON.stringify({
                enabled: this.config.enabled,
                snippets: this.config.snippets.map(s => ({
                    id: s.id,
                    prefix: s.prefix || this.config.defaultPrefix || ':',
                    trigger: s.trigger,
                    replacement: s.replacement,
                    enabled: s.enabled
                }))
            });
            this.process.stdin.write(payload + '\n');
        } catch (err) {
            console.error('[TextExpander] Failed to send config to process:', err);
        }
    }

    public getConfig(): TextExpanderConfig {
        return { ...this.config };
    }

    public setGlobalEnabled(enabled: boolean): boolean {
        this.config.enabled = enabled;
        this.saveConfigToFile(this.config);
        this.syncConfigToProcess();
        return this.config.enabled;
    }

    public setDefaultPrefix(prefix: string): string {
        this.config.defaultPrefix = prefix || ':';
        this.saveConfigToFile(this.config);
        this.syncConfigToProcess();
        return this.config.defaultPrefix;
    }

    public saveSnippet(snippetData: {
        id?: string;
        prefix?: string;
        trigger: string;
        title?: string;
        replacement: string;
        enabled?: boolean;
    }): Snippet {
        const cleanTrigger = (snippetData.trigger || '').trim().replace(/^[:;/!.,#@]/, '');
        const cleanPrefix = (snippetData.prefix || this.config.defaultPrefix || ':').trim();
        const cleanTitle = (snippetData.title || cleanTrigger).trim();
        const cleanReplacement = snippetData.replacement || '';

        let target: Snippet;
        if (snippetData.id) {
            const index = this.config.snippets.findIndex(s => s.id === snippetData.id);
            if (index !== -1) {
                target = {
                    ...this.config.snippets[index],
                    prefix: cleanPrefix,
                    trigger: cleanTrigger,
                    title: cleanTitle,
                    replacement: cleanReplacement,
                    enabled: snippetData.enabled !== undefined ? snippetData.enabled : this.config.snippets[index].enabled
                };
                this.config.snippets[index] = target;
            } else {
                target = {
                    id: snippetData.id,
                    prefix: cleanPrefix,
                    trigger: cleanTrigger,
                    title: cleanTitle,
                    replacement: cleanReplacement,
                    enabled: snippetData.enabled ?? true,
                    createdAt: Date.now()
                };
                this.config.snippets.unshift(target);
            }
        } else {
            target = {
                id: 'snip-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                prefix: cleanPrefix,
                trigger: cleanTrigger,
                title: cleanTitle,
                replacement: cleanReplacement,
                enabled: snippetData.enabled ?? true,
                createdAt: Date.now()
            };
            this.config.snippets.unshift(target);
        }

        this.saveConfigToFile(this.config);
        this.syncConfigToProcess();
        return target;
    }

    public deleteSnippet(id: string): boolean {
        const prevLen = this.config.snippets.length;
        this.config.snippets = this.config.snippets.filter(s => s.id !== id);
        if (this.config.snippets.length !== prevLen) {
            this.saveConfigToFile(this.config);
            this.syncConfigToProcess();
            return true;
        }
        return false;
    }

    public toggleSnippet(id: string, enabled?: boolean): boolean {
        const snippet = this.config.snippets.find(s => s.id === id);
        if (snippet) {
            snippet.enabled = enabled !== undefined ? enabled : !snippet.enabled;
            this.saveConfigToFile(this.config);
            this.syncConfigToProcess();
            return snippet.enabled;
        }
        return false;
    }

    public stop(): void {
        this.isStopping = true;
        if (this.process) {
            try {
                this.process.stdin?.write('QUIT\n');
                setTimeout(() => {
                    if (this.process) {
                        this.process.kill();
                        this.process = null;
                    }
                }, 200);
            } catch (err) {
                this.process.kill();
                this.process = null;
            }
        }
    }
}
