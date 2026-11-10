# AI Form Okuyucu (OCR & Müşteri Formu Ayrıştırıcı) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the `ocr_photo.py` mobile/desktop form reader into AvoCheck as an opt-in tab with manual server start/stop (`:5055`), configurable Gemini API key, QR code connection card, PC drag-and-drop/paste, and Tampermonkey-compatible clipboard output.

**Architecture:** A self-contained `FormReaderManager` in the Electron main process (`src/formReaderServer.ts`) serves the mobile HTML upload page (`GET /`), multipart photo endpoint (`POST /upload`), and raw text endpoint (`POST /clip`) on `0.0.0.0:5055`, calling Gemini REST API (`gemini-3.6-flash`) via Node `fetch`, saving photos + `form.txt` under `Documents/AvoCheck/Kayitlar/`, and writing the parsed template to the clipboard with the `ExcludeClipboardContentFromMonitorProcessing` marker. The renderer (`src/index.html`, `src/index-renderer.ts`) exposes a settings toggle (`formReaderTabEnabled`), a configurable API key (`formReaderApiKey`), server controls with an offline SVG QR code, and a PC-side photo/text drop zone.

**Tech Stack:** Electron 34, TypeScript 5.7, Node `http` / `os` / `fetch`, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-10-form-reader-design.md`

## Global Constraints

- Output template MUST match `FORM_TEMPLATE` (`Müşteri Adı Soyadı:`, `Telefon:`, `Adres:`, `Fatura Tarihi:`, `Şikayet / Arıza:`) and `COMPLAINT_RULES` from `ocr_photo.py` verbatim so the user's Tampermonkey script continues working unchanged.
- `formReaderTabEnabled` defaults to `false`; the `📄 Form Okuyucu` tab is hidden until enabled in Settings.
- Even when the tab is visible, the `:5055` HTTP server MUST start stopped on every app launch and only bind when manually started.
- Each user can enter and persist their own `formReaderApiKey` in `settings.json`.
- Clipboard writes from Form Reader MUST set the `ExcludeClipboardContentFromMonitorProcessing` format buffer so `ClipboardMonitor` does not treat numbers inside the parsed form as Roborock serial numbers.

## Review Focus

1. **Empty or missing API key (`formReaderApiKey === ""`):** Starting the server or submitting a form without an API key must return a clear Turkish error message (`"Lütfen önce Gemini API anahtarını girip kaydedin."`) instead of throwing or hanging.
2. **Port `5055` already in use (`EADDRINUSE`, e.g. old `ocr_photo.py` still running):** `start()` must catch the error and return `{ running: false, error: "5055 portu başka bir uygulama (örn. açık kalan Python scripti) tarafından kullanılıyor." }` without crashing the Electron main process.
3. **Multipart upload with no files or non-image parts:** `POST /upload` must return HTTP `400` JSON `{ ok: false, error: "Fotoğraf alınamadı." }` cleanly.
4. **Gemini returns malformed/incomplete text missing `REQUIRED_KEYS`:** `callGemini` must retry up to `MAX_RETRIES = 5` times and fail gracefully (`502` on `/upload`, fallback to raw text on `/clip`) while keeping the saved photos in `Kayitlar/`.
5. **Clipboard write triggering serial number popup:** Writing parsed form text to the clipboard must include `ExcludeClipboardContentFromMonitorProcessing` so `ClipboardMonitor` ignores it.

---

### Task 1: Settings Schema & Form Reader Server Engine

**Files:**
- Modify: `src/settingsManager.ts:5-25` and `src/settingsManager.ts:56-72`
- Create: `src/formReaderServer.ts`
- Create: `src/qrSvg.ts`

**Interfaces:**
- Produces in `src/settingsManager.ts`:
  - `AppSettings.formReaderTabEnabled?: boolean` (default `false`)
  - `AppSettings.formReaderApiKey?: string` (default `""`)
- Produces in `src/qrSvg.ts`:
  - `export function generateQrSvg(text: string): string`
- Produces in `src/formReaderServer.ts`:
  - `export interface FormReaderStatus { running: boolean; port: number; ip: string; url: string; qrSvg: string; saveDir: string; lastResult: string; error?: string }`
  - `export interface PcFormPayload { photos?: Array<{ base64: string; mime: string }>; rawText?: string }`
  - `export function isValidResponse(text: string): boolean`
  - `export function parseMultipartPhotos(body: Buffer, contentType: string): Array<{ data: Buffer; mime: string }>`
  - `export class FormReaderManager` with `static getInstance(): FormReaderManager`, `start(): Promise<FormReaderStatus>`, `stop(): Promise<FormReaderStatus>`, `getStatus(): FormReaderStatus`, `processFromPc(payload: PcFormPayload, apiKey: string): Promise<{ ok: boolean; text?: string; error?: string; savedFolder?: string | null }>`, `onResult(cb: (data: { text: string; source: 'phone-photo' | 'phone-clip' | 'pc'; timestamp: string }) => void): void`

- [ ] **Step 1: Write verification test script for `isValidResponse`, `parseMultipartPhotos`, `generateQrSvg`, missing API key guard, and port conflict handling**

Run a Node verification script checking:
- `isValidResponse` rejects short/incomplete strings and accepts strings containing all three `REQUIRED_KEYS` (`Müşteri Adı Soyadı:`, `Telefon:`, `Şikayet / Arıza:`).
- `parseMultipartPhotos` extracts binary photo buffers and MIME types from a `multipart/form-data` payload and returns `[]` on empty/malformed input.
- `generateQrSvg('http://192.168.1.10:5055')` returns a valid `<svg ...>...</svg>` string.
- `FormReaderManager.getInstance().processFromPc({ rawText: 'test' }, '')` returns `{ ok: false, error: 'Lütfen önce Gemini API anahtarını girip kaydedin.' }`.
- Starting `FormReaderManager` when another server already holds port `5055` resolves with `{ running: false, error: ... }` instead of throwing.

- [ ] **Step 2: Extend `AppSettings` in `src/settingsManager.ts`**

Add `formReaderTabEnabled?: boolean` (default `false`) and `formReaderApiKey?: string` (default `""`) to `AppSettings` and `defaultSettings`.

- [ ] **Step 3: Create `src/qrSvg.ts` and `src/formReaderServer.ts`**

Implement `generateQrSvg(text: string): string` (pure TypeScript Byte-mode QR code version 1–4 encoder outputting `<svg viewBox="...">`) in `src/qrSvg.ts`, and `FormReaderManager` in `src/formReaderServer.ts` with the exact prompts, `INDEX_HTML`, `MAX_RETRIES = 5`, `REQUEST_TIMEOUT_S = 25`, `MODEL_NAME = 'gemini-3.6-flash'`, photo saving under `path.join(getAppDataDir(), 'Kayitlar')`, and marked clipboard writer (`writeClipboardMarked(text: string)` writing both UTF-16 text and `ExcludeClipboardContentFromMonitorProcessing` buffer).

- [ ] **Step 4: Run verification test script and confirm all assertions pass**

Run: `npx tsx <test-script>` (or compile and run via Node/Electron)
Expected: PASS on all 5 checks.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/settingsManager.ts src/qrSvg.ts src/formReaderServer.ts
git commit -m "feat(form-reader): add FormReaderManager HTTP/Gemini service and QR generator"
```

---

### Task 2: IPC Wiring, Preload Bridge & Form Reader UI Tab

**Files:**
- Modify: `src/main.ts:28-32`, `src/main.ts:340-343`, `src/main.ts:517-522`
- Modify: `src/preload.ts:65-71`
- Modify: `src/index.html:1058-1071`, `src/index.html:1268-1272`, `src/index.html:1376-1430`
- Modify: `src/index-renderer.ts:285-310`, `src/index-renderer.ts:492-555`, `src/index-renderer.ts:860-874`

**Interfaces:**
- Consumes: `FormReaderManager` from `src/formReaderServer.ts`, `AppSettings` from `src/settingsManager.ts`.
- Produces IPC channels in `src/main.ts` & `src/preload.ts`:
  - `getFormReaderStatus: () => safeInvoke('form-reader:status')`
  - `startFormReader: () => safeInvoke('form-reader:start')`
  - `stopFormReader: () => safeInvoke('form-reader:stop')`
  - `processFormFromPc: (payload: PcFormPayload) => safeInvoke('form-reader:process-pc', payload)`
  - `openFormReaderFolder: () => safeInvoke('form-reader:open-folder')`
  - `onFormReaderResult: (callback: (data: any) => void) => ipcRenderer.on('form-reader:result', (_e, data) => callback(data))`

- [ ] **Step 1: Wire IPC channels in `src/main.ts` and `src/preload.ts`**

Register `form-reader:status`, `form-reader:start`, `form-reader:stop`, `form-reader:process-pc`, and `form-reader:open-folder` (using `shell.openPath`) in `setupIpcHandlers()`. Forward `FormReaderManager.getInstance().onResult` to `mainWindow.webContents.send('form-reader:result', data)`. Call `FormReaderManager.getInstance().stop()` in `app.on('will-quit')`.

- [ ] **Step 2: Add Form Reader tab, view, and Settings controls in `src/index.html`**

- Add `<button class="tab-btn" data-view="form-reader" id="tab-form-reader" style="display:none;"><span>📄</span><span>Form Okuyucu</span></button>` to `.nav-tabs`.
- Add `<section id="view-form-reader" class="view-section">...</section>` containing:
  1. Server control header card (`#btn-form-reader-toggle`, status badge `#form-reader-status-badge`, URL pill `#form-reader-url`, QR container `#form-reader-qr`, `#btn-form-reader-open-folder`, and inline API key input `#form-reader-inline-api-key` + save button `#btn-save-form-api-key`).
  2. PC input card (`#form-reader-dropzone`, `#form-reader-file-input`, `#form-reader-thumbs`, `#form-reader-raw-text`, `#btn-form-reader-submit-pc`).
  3. Result preview card (`#form-reader-result-text`, `#btn-form-reader-copy-result`, `#form-reader-last-meta`).
- In `#view-settings`, add a `"📄 AI Form Okuyucu Modülü"` settings group with toggle `#form-reader-tab-enabled` and password/text input `#form-reader-api-key`.

- [ ] **Step 3: Wire UI interactions, PC photo shrink/paste, and sound notification in `src/index-renderer.ts`**

- Update `switchTab(view: 'history' | 'snippets' | 'form-reader' | 'settings')` to toggle `tabFormReader` and `viewFormReader`.
- Sync `formReaderTabEnabled` and `formReaderApiKey` in `loadSettingsToUI()` and `saveCurrentSettings()`, immediately showing/hiding `#tab-form-reader`.
- Handle server start/stop, QR & IP display, PC drag-and-drop / file input / `Ctrl+V` image paste (resizing client-side to `MAX_DIM = 2200` JPEG `0.85`), raw text submission, and `onFormReaderResult` toast + chime sound (`playNotificationChime('recci')`).

- [ ] **Step 4: Build the application and verify zero errors**

Run: `npm run build`
Expected: Exit code `0` with main, preload, and renderer bundles built cleanly.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/main.ts src/preload.ts src/index.html src/index-renderer.ts docs/superpowers/specs/2026-11-10-form-reader-design.md docs/superpowers/plans/2026-11-10-form-reader.md
git commit -m "feat(form-reader): add opt-in Form Reader tab, settings, and IPC wiring"
```
