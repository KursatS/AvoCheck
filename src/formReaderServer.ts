import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { clipboard } from 'electron';
import { getAppDataDir, loadSettings } from './settingsManager';
import { generateQrSvg } from './qrSvg';

const PORT = 5055;
const MODEL_NAME = 'gemini-3.6-flash';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;
const THINKING_LEVEL = 'minimal';
const REQUEST_TIMEOUT_S = 25;
const MAX_OUTPUT_TOKENS = 1024;
const EXCLUDE_MONITOR_FORMAT = 'ExcludeClipboardContentFromMonitorProcessing';

export const FORM_TEMPLATE = `Müşteri Adı Soyadı: [Tespit edilen isim soyisim, bulunamazsa 'Belirtilmemiş']
Telefon: [Formatlanmış telefon numarası, bulunamazsa 'Belirtilmemiş']
Adres: [Tespit edilen açık adres, bulunamazsa 'Belirtilmemiş']
Fatura Tarihi: [Tespit edilen fatura veya satın alma tarihi (GG.AA.YYYY), bulunamazsa 'Belirtilmemiş']
Şikayet / Arıza: [Arızayı servis fişine yazılan KISA NOT gibi yaz (aşağıdaki kurallara uy)]
`;

export const COMPLAINT_RULES = `
ŞİKAYET / ARIZA YAZIM KURALLARI:
- Teknisyenin servis fişine elle yazdığı kısa not gibi yaz: telgraf üslubu, en fazla 12 kelime.
- Cümle kurma. "Cihazın", "ürünün", "müşteri", "belirtilmiştir", "beyan edilmektedir", "talep edilmektedir",
  "tespit edilmiştir", "rica edilmektedir", "olduğu", "-dığı" gibi kalıpları ASLA kullanma.
- Sadece arızanın kendisini yaz. Sebep tahmini, yorum, nezaket ifadesi, garanti açıklaması ekleme.
- Birden fazla arıza varsa virgülle ayır.
- Müşterinin açık bir talebi varsa (değişim, iade, fiyat bilgisi vb.) en sona kısaca ekle: "değişim talebi".
- Müşterinin yazdığı teknik detayı (hangi parça, hangi durumda) koru; anlamı değiştirme.

ÖRNEKLER (müşteri beyanı -> yazılacak):
"makine su vermiyor bakar mısınız" -> Su vermiyor
"cihaz hiç açılmıyor fişe takınca ışık yanmıyor" -> Açılmıyor, ışık yanmıyor
"tıraş başlığındaki metal kesicinin dişleri kırıldı, garantiden değişsin olmazsa yenisi" -> Kesici başlık dişleri kırık, değişim talebi
"süpürge çekmiyor bir de ses yapıyor" -> Çekmiyor, ses yapıyor
"şarj oluyor ama 5 dakikada bitiyor" -> Şarj 5 dakikada bitiyor
`;

export const SYSTEM_PROMPT = `Sen teknik servis kayıt ve kabul biriminde çalışan profesyonel bir personelsin.
Sana kağıttan OCR ile taranmış ham metin verilecek. 
Bu metindeki yazım hatalarını düzelterek ve bilgileri ayıklayarak SADECE aşağıdaki şablonda çıktı üret. 
Açıklama, selamlama veya fazladan metin ekleme:

` + FORM_TEMPLATE + COMPLAINT_RULES;

export const IMAGE_SYSTEM_PROMPT = `Sen teknik servis kayıt ve kabul biriminde çalışan profesyonel bir personelsin.
Sana bir müşteri formuna/kağıdına ait bir veya birkaç sayfanın fotoğrafı verilecek. Sayfaların hepsi AYNI müşteriye aittir, hepsini tek bir form olarak birlikte değerlendir.
Fotoğraflardaki (el yazısı dahil) metni oku, yazım hatalarını düzelterek ve bilgileri ayıklayarak SADECE aşağıdaki şablonda çıktı üret. 
Açıklama, selamlama veya fazladan metin ekleme:

` + FORM_TEMPLATE + COMPLAINT_RULES;

export const REQUIRED_KEYS = [
  'Müşteri Adı Soyadı:',
  'Telefon:',
  'Şikayet / Arıza:'
];

export interface FormReaderStatus {
  running: boolean;
  port: number;
  ip: string;
  url: string;
  qrSvg: string;
  saveDir: string;
  lastResult: string;
  error?: string;
}

export interface PcFormPayload {
  photos?: Array<{ base64: string; mime: string }>;
  rawText?: string;
}

export interface FormReaderResultEvent {
  text: string;
  source: 'phone-photo' | 'phone-clip' | 'pc';
  timestamp: string;
}

export function isValidResponse(text: string): boolean {
  if (!text || text.trim().length < 30) return false;
  return REQUIRED_KEYS.every((key) => text.includes(key));
}

export function parseMultipartPhotos(
  body: Buffer,
  contentType: string
): Array<{ data: Buffer; mime: string }> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m ? (m[1] || m[2]).trim() : '';
  if (!boundary || !body || body.length === 0) return [];

  const delim = Buffer.from(`--${boundary}`);
  const crlf2 = Buffer.from('\r\n\r\n');
  const results: Array<{ data: Buffer; mime: string }> = [];

  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const partStart = pos + delim.length;
    if (body.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) break;

    const nextDelim = body.indexOf(delim, partStart);
    if (nextDelim === -1) break;

    const headerEnd = body.indexOf(crlf2, partStart);
    if (headerEnd !== -1 && headerEnd < nextDelim) {
      const headerStr = body.subarray(partStart, headerEnd).toString('utf8');
      const dataStart = headerEnd + 4;
      // Strip trailing \r\n before next boundary
      let dataEnd = nextDelim;
      if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) {
        dataEnd -= 2;
      }

      if (/name="photos"/i.test(headerStr) && dataEnd > dataStart) {
        const mimeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(headerStr);
        const rawMime = mimeMatch ? mimeMatch[1].trim() : 'image/jpeg';
        const mime = rawMime.startsWith('image/') ? rawMime : 'image/jpeg';
        results.push({
          data: Buffer.from(body.subarray(dataStart, dataEnd)),
          mime
        });
      }
    }
    pos = nextDelim;
  }
  return results;
}

function getLocalIPv4(): string {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch { }
  return '127.0.0.1';
}

function writeClipboardMarked(text: string): void {
  try {
    if (typeof clipboard?.writeText === 'function') {
      clipboard.writeText(text);
      try {
        clipboard.writeBuffer(EXCLUDE_MONITOR_FORMAT, Buffer.from([1, 0, 0, 0]));
      } catch { }
    }
  } catch (err) {
    console.error('[FormReader] Clipboard write error:', err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
  systemPrompt: string,
  apiKey: string
): Promise<string | null> {
  let useThinking = true;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_S * 1000);

    try {
      const generationConfig: Record<string, any> = {
        temperature: 0.1,
        maxOutputTokens: MAX_OUTPUT_TOKENS
      };
      if (useThinking && THINKING_LEVEL) {
        generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts }],
          generationConfig
        }),
        signal: controller.signal
      });

      clearTimeout(timer);
      const json: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = JSON.stringify(json?.error || res.statusText).toLowerCase();
        console.warn(`[FormReader] Attempt ${attempt} HTTP ${res.status}:`, errMsg);
        if (useThinking && errMsg.includes('thinking')) {
          useThinking = false;
          continue;
        }
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }

      const candidateParts = json?.candidates?.[0]?.content?.parts || [];
      const resultText = candidateParts
        .map((p: any) => (typeof p?.text === 'string' && !p?.thought ? p.text : ''))
        .join('')
        .trim();

      console.log(`[FormReader] Gemini duration: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      if (isValidResponse(resultText)) {
        return resultText;
      }
      console.warn(`[FormReader] Attempt ${attempt}: response did not match template keys, retrying...`);
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[FormReader] Attempt ${attempt} error:`, err?.message || err);
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="AvoCheck Form">
<title>Servis Formu — AvoCheck</title>
<style>
  :root {
    --canvas: #f4f6f2;
    --surface: #ffffff;
    --surface-2: #e9ede6;
    --ink: #121814;
    --ink-muted: #5b6960;
    --line: #d6dfd2;
    --avocado: #65a30d;
    --avocado-bright: #84cc16;
    --avocado-ink: #ffffff;
    --emerald: #10b981;
    --danger: #ef4444;
    --shadow: 0 8px 24px rgba(18, 24, 20, 0.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --canvas: #0c100e;
      --surface: #151c18;
      --surface-2: #1e2822;
      --ink: #f1f5f2;
      --ink-muted: #8b9d91;
      --line: #28352d;
      --avocado: #84cc16;
      --avocado-bright: #a3e635;
      --avocado-ink: #0c100e;
      --shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0;
    padding: 16px;
    padding-top: calc(14px + env(safe-area-inset-top));
    padding-bottom: calc(28px + env(safe-area-inset-bottom));
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    background: var(--canvas);
    color: var(--ink);
    line-height: 1.4;
  }
  .shell { max-width: 480px; margin: 0 auto; }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-mark {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .brand h1 {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.025em;
    margin: 0;
  }
  .brand span {
    display: block;
    font-size: 12px;
    color: var(--ink-muted);
    font-weight: 500;
  }
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--line);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--emerald);
    box-shadow: 0 0 8px var(--emerald);
  }
  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    background: var(--surface-2);
    padding: 4px;
    border-radius: 14px;
    border: 1px solid var(--line);
    margin-bottom: 14px;
  }
  .mode-tab {
    border: 0;
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
  }
  .mode-tab.active {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 16px;
    margin-bottom: 14px;
    box-shadow: var(--shadow);
  }
  .capture-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 10px;
  }
  button.btn {
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    border: 0;
    border-radius: 14px;
    padding: 15px 14px;
    width: 100%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: transform 0.1s ease, opacity 0.15s ease;
  }
  button.btn:active { transform: scale(0.98); }
  button.btn:disabled { opacity: 0.42; pointer-events: none; }
  .btn-cam {
    background: var(--avocado);
    color: var(--avocado-ink);
  }
  .btn-lib {
    background: var(--surface-2);
    color: var(--ink);
    border: 1px solid var(--line);
  }
  .btn-send {
    background: var(--avocado);
    color: var(--avocado-ink);
    font-size: 16px;
    padding: 16px;
    box-shadow: 0 6px 20px rgba(132, 204, 22, 0.25);
  }
  input[type=file] { display: none; }
  .empty-hint {
    margin-top: 14px;
    padding: 18px 12px;
    border: 1.5px dashed var(--line);
    border-radius: 13px;
    text-align: center;
    color: var(--ink-muted);
    font-size: 13px;
  }
  #thumbs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 14px;
  }
  #thumbs:empty { display: none; }
  .thumb {
    position: relative;
    aspect-ratio: 3/4;
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .n {
    position: absolute;
    left: 6px;
    bottom: 6px;
    background: rgba(12, 16, 14, 0.78);
    color: #fff;
    font-family: "SF Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 7px;
    border-radius: 7px;
  }
  .thumb .x {
    position: absolute;
    right: 5px;
    top: 5px;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(12, 16, 14, 0.78);
    color: #fff;
    font-size: 14px;
    line-height: 28px;
    cursor: pointer;
  }
  #status {
    margin: 12px 4px 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink-muted);
    min-height: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  #status.err { color: var(--danger); }
  #status.ok { color: var(--emerald); }
  textarea {
    width: 100%;
    min-height: 210px;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px;
    font: 14px/1.45 "SF Mono", ui-monospace, Menlo, monospace;
    background: var(--surface-2);
    color: var(--ink);
    resize: vertical;
    outline: none;
  }
  .parsed-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }
  .pf-row {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 11px;
    padding: 9px 12px;
  }
  .pf-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--ink-muted);
    margin-bottom: 2px;
  }
  .pf-val {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    word-break: break-word;
  }
  .hidden { display: none !important; }
</style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">🥑</div>
        <div>
          <h1>Servis Formu</h1>
          <span>El yazısı ve matbu form okuyucu</span>
        </div>
      </div>
      <div class="live-pill">
        <span class="live-dot"></span>
        <span>PC Panoya Bağlı</span>
      </div>
    </div>

    <div class="mode-tabs">
      <button type="button" class="mode-tab active" id="tabPhoto">📷 Fotoğraf Gönder</button>
      <button type="button" class="mode-tab" id="tabText">📝 Metin Yapıştır</button>
    </div>

    <div id="panePhoto">
      <div class="card">
        <div class="capture-grid">
          <button type="button" id="btnCam" class="btn btn-cam">📷 Kamera</button>
          <button type="button" id="btnLib" class="btn btn-lib">🖼 Galeri</button>
        </div>
        <input id="camInput" type="file" accept="image/*" capture="environment">
        <input id="libInput" type="file" accept="image/*" multiple>
        <div id="emptyHint" class="empty-hint">
          Birden fazla sayfa çekebilirsin; hepsi tek müşteri formu olarak birleştirilir.
        </div>
        <div id="thumbs"></div>
      </div>
      <button type="button" id="btnSend" class="btn btn-send" disabled>⚡ Gönder ve Ayrıştır</button>
    </div>

    <div id="paneText" class="hidden">
      <div class="card">
        <textarea id="rawTextInput" placeholder="iPhone Canlı Metin (Live Text) veya kopyaladığın müşteri notunu buraya yapıştır..."></textarea>
      </div>
      <button type="button" id="btnSendText" class="btn btn-send">⚡ Metni Ayrıştır ve PC'ye Kopyala</button>
    </div>

    <div id="status"><span id="statusMsg"></span><span id="statusTimer"></span></div>

    <div id="resultCard" class="card hidden" style="margin-top:14px">
      <div id="parsedFields" class="parsed-fields"></div>
      <textarea id="result" readonly></textarea>
      <div class="capture-grid" style="margin-top:10px">
        <button type="button" id="btnCopy" class="btn btn-cam">📋 Telefona Kopyala</button>
        <button type="button" id="btnNew" class="btn btn-lib">🔄 Yeni Form</button>
      </div>
    </div>
  </div>

<script>
const MAX_DIM = 2200;
const QUALITY = 0.85;
let pages = [];
let timerInt = null;

const $ = id => document.getElementById(id);
const statusEl = $("status");
const statusMsg = $("statusMsg");
const statusTimer = $("statusTimer");

function setStatus(msg, state=""){
  statusMsg.textContent = msg;
  statusEl.className = state;
}

function startTimer(msg){
  const t0 = Date.now();
  setStatus(msg, "");
  statusTimer.textContent = "0.0 sn";
  if (timerInt) clearInterval(timerInt);
  timerInt = setInterval(() => {
    statusTimer.textContent = ((Date.now() - t0) / 1000).toFixed(1) + " sn";
  }, 100);
}

function stopTimer(){
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
  statusTimer.textContent = "";
}

$("tabPhoto").onclick = () => {
  $("tabPhoto").classList.add("active");
  $("tabText").classList.remove("active");
  $("panePhoto").classList.remove("hidden");
  $("paneText").classList.add("hidden");
};
$("tabText").onclick = () => {
  $("tabText").classList.add("active");
  $("tabPhoto").classList.remove("active");
  $("paneText").classList.remove("hidden");
  $("panePhoto").classList.add("hidden");
};

async function shrink(file){
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch(e) {
    bmp = await new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), "image/jpeg", QUALITY));
}

async function addFiles(fileList){
  setStatus("Fotoğraflar hazırlanıyor...");
  for (const f of fileList){
    try {
      const blob = await shrink(f);
      pages.push({ blob, url: URL.createObjectURL(blob) });
    } catch(e) { setStatus("Bir fotoğraf okunamadı.", "err"); }
  }
  render();
  setStatus(pages.length ? pages.length + " sayfa gönderime hazır." : "");
}

function render(){
  const t = $("thumbs"); t.innerHTML = "";
  $("emptyHint").classList.toggle("hidden", pages.length > 0);
  pages.forEach((p, i) => {
    const d = document.createElement("div"); d.className = "thumb";
    d.innerHTML = '<img src="' + p.url + '"><span class="n">Sayfa ' + (i+1) + '</span>';
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕";
    x.onclick = () => { pages.splice(i,1); render(); setStatus(pages.length ? pages.length + " sayfa hazır." : ""); };
    d.appendChild(x); t.appendChild(d);
  });
  $("btnSend").disabled = pages.length === 0;
}

function renderParsedFields(text){
  const box = $("parsedFields");
  box.innerHTML = "";
  const lines = (text || "").split(/\\r?\\n/).filter(Boolean);
  lines.forEach(line => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const row = document.createElement("div");
    row.className = "pf-row";
    const lbl = document.createElement("div");
    lbl.className = "pf-label";
    lbl.textContent = line.slice(0, idx).trim();
    const val = document.createElement("div");
    val.className = "pf-val";
    val.textContent = line.slice(idx + 1).trim();
    row.appendChild(lbl);
    row.appendChild(val);
    box.appendChild(row);
  });
}

function showResult(text){
  $("result").value = text;
  renderParsedFields(text);
  $("resultCard").classList.remove("hidden");
  $("resultCard").scrollIntoView({ behavior: "smooth" });
}

$("btnCam").onclick = () => $("camInput").click();
$("btnLib").onclick = () => $("libInput").click();
$("camInput").onchange = async e => { await addFiles(e.target.files); e.target.value = ""; };
$("libInput").onchange = async e => { await addFiles(e.target.files); e.target.value = ""; };

$("btnSend").onclick = async () => {
  if (!pages.length) return;
  const fd = new FormData();
  pages.forEach((p, i) => fd.append("photos", p.blob, "sayfa" + (i+1) + ".jpg"));
  $("btnSend").disabled = true;
  startTimer("Gemini okuyor...");
  try {
    const r = await fetch("/upload", { method: "POST", body: fd });
    const j = await r.json();
    stopTimer();
    if (!j.ok) throw new Error(j.error || "Bilinmeyen hata");
    showResult(j.text);
    setStatus("✓ Bilgisayar panosuna kopyalandı!", "ok");
  } catch(e) {
    stopTimer();
    setStatus("Hata: " + e.message, "err");
    $("btnSend").disabled = false;
  }
};

$("btnSendText").onclick = async () => {
  const txt = ($("rawTextInput").value || "").trim();
  if (!txt) { setStatus("Lütfen önce metin yapıştırın.", "err"); return; }
  $("btnSendText").disabled = true;
  startTimer("Metin ayrıştırılıyor...");
  try {
    const r = await fetch("/clip", {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Return-Json": "1" },
      body: txt
    });
    const j = await r.json();
    stopTimer();
    if (!j.ok) throw new Error(j.error || "Ayrıştırma başarısız");
    showResult(j.text);
    setStatus("✓ Bilgisayar panosuna kopyalandı!", "ok");
  } catch(e) {
    stopTimer();
    setStatus("Hata: " + e.message, "err");
  } finally {
    $("btnSendText").disabled = false;
  }
};

function copyText(text){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = $("result"); ta.removeAttribute("readonly"); ta.select(); ta.setSelectionRange(0, 99999);
  document.execCommand("copy"); ta.setAttribute("readonly", ""); ta.blur();
  return Promise.resolve();
}
$("btnCopy").onclick = async () => {
  await copyText($("result").value);
  $("btnCopy").textContent = "✓ Kopyalandı";
  setTimeout(() => $("btnCopy").textContent = "📋 Telefona Kopyala", 1500);
};

$("btnNew").onclick = () => {
  pages = []; render(); $("result").value = ""; $("rawTextInput").value = "";
  $("resultCard").classList.add("hidden"); setStatus("");
  window.scrollTo({ top: 0, behavior: "smooth" });
};
</script>
</body>
</html>`;

export class FormReaderManager {
  private static instance: FormReaderManager | null = null;
  private server: http.Server | null = null;
  private lastResult = '';
  private resultListeners: Array<(ev: FormReaderResultEvent) => void> = [];

  public static getInstance(): FormReaderManager {
    if (!FormReaderManager.instance) {
      FormReaderManager.instance = new FormReaderManager();
    }
    return FormReaderManager.instance;
  }

  public getSaveDir(): string {
    const dir = path.join(getAppDataDir(), 'Kayitlar');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch { }
    }
    return dir;
  }

  public onResult(cb: (ev: FormReaderResultEvent) => void): void {
    this.resultListeners.push(cb);
  }

  private emitResult(text: string, source: 'phone-photo' | 'phone-clip' | 'pc'): void {
    this.lastResult = text;
    const ev: FormReaderResultEvent = {
      text,
      source,
      timestamp: new Date().toISOString()
    };
    for (const cb of this.resultListeners) {
      try {
        cb(ev);
      } catch { }
    }
  }

  private getEffectiveApiKey(overrideKey?: string): string {
    if (overrideKey !== undefined) return overrideKey.trim();
    const s = loadSettings();
    return (s.formReaderApiKey || process.env.GEMINI_API_KEY || '').trim();
  }

  public getStatus(error?: string): FormReaderStatus {
    const ip = getLocalIPv4();
    const url = `http://${ip}:${PORT}`;
    return {
      running: this.server !== null && this.server.listening,
      port: PORT,
      ip,
      url,
      qrSvg: generateQrSvg(url),
      saveDir: this.getSaveDir(),
      lastResult: this.lastResult,
      ...(error ? { error } : {})
    };
  }

  private savePhotos(photos: Array<{ data: Buffer; mime: string }>): string | null {
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const folder = path.join(this.getSaveDir(), stamp);
      fs.mkdirSync(folder, { recursive: true });

      photos.forEach((p, idx) => {
        const ext = p.mime === 'image/png' ? '.png' : '.jpg';
        fs.writeFileSync(path.join(folder, `sayfa${idx + 1}${ext}`), p.data);
      });
      return folder;
    } catch (err) {
      console.error('[FormReader] Save photos error:', err);
      return null;
    }
  }

  public async start(overrideApiKey?: string): Promise<FormReaderStatus> {
    if (this.server && this.server.listening) {
      return this.getStatus();
    }

    const apiKey = this.getEffectiveApiKey(overrideApiKey);
    if (!apiKey) {
      return this.getStatus('Lütfen önce Gemini API anahtarını girip kaydedin.');
    }

    return new Promise<FormReaderStatus>((resolve) => {
      const srv = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('[FormReader] Request error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Sunucu hatası oluştu.' }));
          }
        });
      });

      const onError = (err: NodeJS.ErrnoException) => {
        srv.removeAllListeners();
        this.server = null;
        const msg =
          err.code === 'EADDRINUSE'
            ? '5055 portu başka bir uygulama (örn. açık kalan Python scripti) tarafından kullanılıyor.'
            : `Sunucu başlatılamadı: ${err.message}`;
        resolve(this.getStatus(msg));
      };

      srv.once('error', onError);
      srv.listen(PORT, '0.0.0.0', () => {
        srv.removeListener('error', onError);
        this.server = srv;
        resolve(this.getStatus());
      });
    });
  }

  public async stop(): Promise<FormReaderStatus> {
    if (!this.server) return this.getStatus();
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
    return this.getStatus();
  }

  public async processFromPc(
    payload: PcFormPayload,
    overrideApiKey?: string
  ): Promise<{ ok: boolean; text?: string; error?: string; savedFolder?: string | null }> {
    const apiKey = this.getEffectiveApiKey(overrideApiKey);
    if (!apiKey) {
      return { ok: false, error: 'Lütfen önce Gemini API anahtarını girip kaydedin.' };
    }

    if (payload.photos && payload.photos.length > 0) {
      const photoBuffers = payload.photos
        .map((p) => ({
          data: Buffer.from(p.base64, 'base64'),
          mime: p.mime && p.mime.startsWith('image/') ? p.mime : 'image/jpeg'
        }))
        .filter((p) => p.data.length > 0);

      if (photoBuffers.length === 0) {
        return { ok: false, error: 'Fotoğraf verisi boş.' };
      }

      const savedFolder = this.savePhotos(photoBuffers);
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
        photoBuffers.map((p) => ({
          inlineData: { mimeType: p.mime, data: p.data.toString('base64') }
        }));
      parts.push({
        text: 'Yukarıdaki sayfalar aynı müşteri formuna aittir. Şablona göre çıktı üret.'
      });

      const result = await callGemini(parts, IMAGE_SYSTEM_PROMPT, apiKey);
      if (!result) {
        return {
          ok: false,
          error: 'Gemini geçerli bir cevap üretemedi. API anahtarınızı ve bağlantınızı kontrol edin.',
          savedFolder
        };
      }

      if (savedFolder) {
        try {
          fs.writeFileSync(path.join(savedFolder, 'form.txt'), result, 'utf8');
        } catch { }
      }

      writeClipboardMarked(result);
      this.emitResult(result, 'pc');
      return { ok: true, text: result, savedFolder };
    }

    const rawText = (payload.rawText || '').trim();
    if (!rawText) {
      return { ok: false, error: 'Fotoğraf veya metin girilmedi.' };
    }

    const result = await callGemini(
      [{ text: `Taranan Form Metni:\n\n${rawText}` }],
      SYSTEM_PROMPT,
      apiKey
    );
    if (!result) {
      return {
        ok: false,
        error: 'Gemini geçerli bir cevap üretemedi. API anahtarınızı kontrol edin.'
      };
    }

    writeClipboardMarked(result);
    this.emitResult(result, 'pc');
    return { ok: true, text: result };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 64 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Dosya boyutu 64 MB sınırını aştı.' }));
        return;
      }
      chunks.push(buf);
    }
    const body = Buffer.concat(chunks);
    const apiKey = this.getEffectiveApiKey();

    if (req.method === 'POST' && url === '/clip') {
      const rawText = body.toString('utf8').trim();
      const wantsJson = req.headers['x-return-json'] === '1';
      if (!rawText) {
        res.writeHead(400, { 'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
        res.end(wantsJson ? JSON.stringify({ ok: false, error: 'Metin boş.' }) : 'EMPTY');
        return;
      }
      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': wantsJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
        res.end(wantsJson ? JSON.stringify({ ok: false, error: 'AvoCheck üzerinde Gemini API anahtarı tanımlı değil.' }) : 'NO_API_KEY');
        return;
      }

      const parsed = (await callGemini([{ text: `Taranan Form Metni:\n\n${rawText}` }], SYSTEM_PROMPT, apiKey)) || rawText;
      writeClipboardMarked(parsed);
      this.emitResult(parsed, 'phone-clip');

      if (wantsJson) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, text: parsed }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OK');
      }
      return;
    }

    if (req.method === 'POST' && url === '/upload') {
      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'AvoCheck üzerinde Gemini API anahtarı tanımlı değil.' }));
        return;
      }

      const photos = parseMultipartPhotos(body, req.headers['content-type'] || '');
      if (photos.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Fotoğraf alınamadı.' }));
        return;
      }

      const savedFolder = this.savePhotos(photos);
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
        photos.map((p) => ({
          inlineData: { mimeType: p.mime, data: p.data.toString('base64') }
        }));
      parts.push({
        text: 'Yukarıdaki sayfalar aynı müşteri formuna aittir. Şablona göre çıktı üret.'
      });

      const result = await callGemini(parts, IMAGE_SYSTEM_PROMPT, apiKey);
      if (!result) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: false,
            error: 'Gemini geçerli bir cevap üretemedi. Fotoğraflar bilgisayara kaydedildi, tekrar deneyebilirsin.'
          })
        );
        return;
      }

      if (savedFolder) {
        try {
          fs.writeFileSync(path.join(savedFolder, 'form.txt'), result, 'utf8');
        } catch { }
      }

      writeClipboardMarked(result);
      this.emitResult(result, 'phone-photo');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, text: result }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}
