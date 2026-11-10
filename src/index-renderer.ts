export { }
import { showToast } from './utils/toastUtils'
import { SVG_EMPTY_FOLDER } from './utils/svgUtils'
import * as XLSX from 'xlsx'

const cardsDiv = document.getElementById('cards')!
const searchInput = document.getElementById('search') as HTMLInputElement
const toggleBtn = document.getElementById('toggle')!
const themeBtn = document.getElementById('theme-toggle')!
const themeIcon = document.getElementById('theme-icon')!
const themeText = document.getElementById('theme-text')!
const btnThemeDark = document.getElementById('btn-theme-dark') as HTMLButtonElement
const btnThemeLight = document.getElementById('btn-theme-light') as HTMLButtonElement
const clearCacheBtn = document.getElementById('clear-cache')!
const clipboardUpperToggleBtn = document.getElementById('clipboard-upper-toggle')!
const statusDot = document.getElementById('status-dot')!
const statusInfo = document.getElementById('status-info')!
const statusRefreshBtn = document.getElementById('status-refresh-btn')!
const devicesCount = document.getElementById('devices-count')!
const statRecciCount = document.getElementById('stat-recci-count')
const statTotalCount = document.getElementById('stat-total-count')
const statTodaySub = document.getElementById('stat-today-sub')
const btnExportExcel = document.getElementById('btn-export-excel')

// Navigation Tabs
const tabHistory = document.getElementById('tab-history')!
const tabSnippets = document.getElementById('tab-snippets')!
const tabFormReader = document.getElementById('tab-form-reader') as HTMLButtonElement
const tabSettings = document.getElementById('tab-settings')!
const viewHistory = document.getElementById('view-history')!
const viewSnippets = document.getElementById('view-snippets')!
const viewFormReader = document.getElementById('view-form-reader')!
const viewSettings = document.getElementById('view-settings')!

// Settings Controls
const sShortcutModelCopy = document.getElementById('shortcut-model-copy') as HTMLInputElement
const sShortcutClear = document.getElementById('shortcut-clear') as HTMLInputElement
const sShortcutMonitoring = document.getElementById('shortcut-monitoring') as HTMLInputElement
const sPopupSize = document.getElementById('popup-size') as HTMLSelectElement
const sPopupTimeout = document.getElementById('popup-timeout') as HTMLInputElement
const sAutoStart = document.getElementById('auto-start') as HTMLInputElement
const sPreventDuplicate = document.getElementById('prevent-duplicate') as HTMLInputElement
const sClipboardUpper = document.getElementById('clipboard-upper') as HTMLInputElement
const sSoundEnabled = document.getElementById('sound-enabled') as HTMLInputElement
const sFormReaderTabEnabled = document.getElementById('form-reader-tab-enabled') as HTMLInputElement
const sFormReaderApiKey = document.getElementById('form-reader-api-key') as HTMLInputElement
const btnCheckUpdate = document.getElementById('btn-check-update')
const updateCheckStatus = document.getElementById('update-check-status')

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay')!
const modalTitle = document.getElementById('modal-title')!
const modalText = document.getElementById('modal-text')!
const modalConfirm = document.getElementById('modal-confirm')!
const modalCancel = document.getElementById('modal-cancel')!

const api = (window as any).electronAPI

let monitoringEnabled = true
let clipboardUpperEnabled = true
let activeFilter = 'all'
let cachedDevices: any[] = []

// Confirmation Dialog Helper
export function showConfirm(title: string, message: string, confirmText = 'Evet, Sil'): Promise<boolean> {
  return new Promise((resolve) => {
    modalTitle.textContent = title
    modalText.textContent = message
    modalConfirm.textContent = confirmText

    modalOverlay.classList.add('active')

    const close = (result: boolean) => {
      modalOverlay.classList.remove('active')
      resolve(result)
    }

    modalConfirm.onclick = () => close(true)
    modalCancel.onclick = () => close(false)
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) close(false)
    }
  })
}
;(window as any).showConfirm = showConfirm

function formatDate(dateString: string): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return dateString
  return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

// Format model string for copy and display
function formatModelData(item: any): { cleanModel: string; cleanColor: string; fullStr: string } {
  let cleanModel = (item.model_name || '').toUpperCase().trim()
    .replace(/^ROBOROCK\s+/i, '').replace(/^ROBOROCK$/i, '').replace(/QREVO/g, 'Q REVO').trim()
  let cleanColor = (item.model_color || '').toUpperCase().trim()
    .replace(/QREVO/g, 'Q REVO').trim()

  if (cleanColor && cleanModel.endsWith(cleanColor)) {
    cleanModel = cleanModel.substring(0, cleanModel.length - cleanColor.length).trim()
  }

  const fullStr = cleanColor ? `${cleanModel} - ${cleanColor}` : cleanModel
  return { cleanModel, cleanColor, fullStr }
}

function renderCards() {
  const query = searchInput.value.toLowerCase().trim()
  const filtered = cachedDevices.filter((item: any) => {
    const status = (item.warranty_status || '').toUpperCase()
    const { fullStr } = formatModelData(item)

    // Filter chip matching
    if (activeFilter === 'recci') {
      if (!status.includes('RECCI') || status.includes('DOLMUŞ') || status.includes('FATURA')) return false
    } else if (activeFilter === 'expired') {
      if (!status.includes('DOLMUŞ') && !status.includes('FATURA')) return false
    } else if (activeFilter === 'out') {
      if (status.includes('RECCI') || status.includes('DOLMUŞ') || status.includes('FATURA')) return false
    }

    // Text search query matching
    if (!query) return true
    const serialMatch = (item.serial || '').toLowerCase().includes(query)
    const modelMatch = fullStr.toLowerCase().includes(query)
    const dateMatch = (item.warranty_end || '').toLowerCase().includes(query)
    return serialMatch || modelMatch || dateMatch
  })

  // Update counts
  if (devicesCount) {
    devicesCount.textContent = `${filtered.length} / ${cachedDevices.length} Cihaz`
  }
  updateDashboardStats()

  if (filtered.length === 0) {
    cardsDiv.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: rgba(255,255,255,0.02); border: 2px dashed rgba(255,255,255,0.08); border-radius: 20px;">
        ${SVG_EMPTY_FOLDER}
        <h3 style="font-size: 1.15rem; color: var(--text-primary); margin: 12px 0 6px;">Eşleşen cihaz bulunamadı</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">Farklı bir arama yapmayı veya filtreyi temizlemeyi deneyin.</p>
      </div>
    `
    return
  }

  const fragment = document.createDocumentFragment()

  filtered.forEach((item: any) => {
    const card = document.createElement('div')
    const status = (item.warranty_status || '').toUpperCase()
    const isRecci = status.includes('RECCI') && !status.includes('DOLMUŞ') && !status.includes('FATURA')
    const isExpiredRecci = status.includes('SÜRESİ DOLMUŞ') || status.includes('FATURA KONTROL') || (!isRecci && !!item.warranty_end)

    let cardClass = 'device-card'
    let badgeClass = 'status-badge none'
    let badgeText = '✕ GARANTİ DIŞI'

    if (isExpiredRecci) {
      cardClass += ' warning'
      badgeClass = 'status-badge recci-expired'
      badgeText = '⚠️ SÜRESİ DOLMUŞ (FATURA KONTROL)'
    } else if (isRecci) {
      cardClass += ' recci'
      badgeClass = 'status-badge recci'
      badgeText = '✓ RECCI GARANTİLİ'
    } else {
      cardClass += ' out-of-warranty'
    }

    const { fullStr } = formatModelData(item)
    const copyTextPayload = fullStr

    card.className = cardClass
    card.innerHTML = `
      <div class="card-top">
        <span class="serial-tag" title="Kopyalamak için tıklayın" data-serial="${item.serial}">
          <span>📋</span> ${item.serial}
        </span>
        <button class="card-delete-btn" title="Kayıttan Sil" data-delete="${item.serial}">✕</button>
      </div>

      <div class="${badgeClass}">${badgeText}</div>

      <div class="model-info">${fullStr || 'Model Belirtilmemiş'}</div>

      <div class="card-meta">
        <div class="meta-row">
          <span>Sorgu Tarihi:</span>
          <span style="color:var(--text-primary);">${formatDate(item.copy_date)}</span>
        </div>
        ${item.warranty_end ? `
        <div class="meta-row">
          <span>Garanti Bitiş:</span>
          <span style="color:#38bdf8; font-weight:600;">${item.warranty_end}</span>
        </div>` : ''}
      </div>

      <div class="card-footer">
        <button class="btn-copy-model" data-copy-text="${copyTextPayload}">
          <span>📋</span> <span>Model Kopyala</span>
        </button>
      </div>
    `
    fragment.appendChild(card)
  })

  cardsDiv.innerHTML = ''
  cardsDiv.appendChild(fragment)

  // Attach card event listeners
  cardsDiv.querySelectorAll('[data-serial]').forEach((el: any) => {
    el.onclick = () => {
      const serial = el.dataset.serial
      navigator.clipboard.writeText(serial)
      showToast(`${serial} panoya kopyalandı!`, 'info')
    }
  })

  cardsDiv.querySelectorAll('[data-copy-text]').forEach((btn: any) => {
    btn.onclick = () => {
      const text = btn.dataset.copyText
      navigator.clipboard.writeText(text)
      const span = btn.querySelector('span:last-child')
      if (span) {
        const orig = span.textContent
        span.textContent = 'Kopyalandı!'
        setTimeout(() => { span.textContent = orig }, 1500)
      }
      showToast(`${text} panoya kopyalandı!`, 'success')
    }
  })

  cardsDiv.querySelectorAll('[data-delete]').forEach((btn: any) => {
    btn.onclick = async () => {
      const serial = btn.dataset.delete
      const confirmed = await showConfirm(
        'Kaydı Sil',
        `${serial} seri numaralı cihaz geçmişten silinecektir. Emin misiniz?`,
        'Sil'
      )
      if (confirmed) {
        await api.deleteEntry(serial)
        loadCards()
        showToast('Kayıt silindi.', 'info')
      }
    }
  })
}

function loadCards() {
  cardsDiv.innerHTML = `
    <div class="device-card" style="opacity:0.5; pointer-events:none;">
      <div class="skeleton" style="width: 45%; height: 22px;"></div>
      <div class="skeleton" style="width: 30%; height: 24px;"></div>
      <div class="skeleton" style="width: 80%; height: 28px;"></div>
    </div>
    <div class="device-card" style="opacity:0.3; pointer-events:none;">
      <div class="skeleton" style="width: 40%; height: 22px;"></div>
      <div class="skeleton" style="width: 30%; height: 24px;"></div>
      <div class="skeleton" style="width: 70%; height: 28px;"></div>
    </div>
  `

  api.getCachedData().then((data: any[]) => {
    cachedDevices = Array.isArray(data) ? data : []
    cachedDevices.sort((a, b) => new Date(b.copy_date).getTime() - new Date(a.copy_date).getTime())
    renderCards()
  }).catch(() => {
    cardsDiv.innerHTML = '<div style="color:#ef4444; padding:20px;">Geçmiş verileri yüklenirken hata oluştu.</div>'
  })
}

// ── Search & Filter Listeners ──
searchInput.addEventListener('input', () => {
  renderCards()
})

document.querySelectorAll('.filter-chip').forEach((chip: any) => {
  chip.onclick = () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'))
    chip.classList.add('active')
    activeFilter = chip.dataset.filter || 'all'
    renderCards()
  }
})

// ── Tab Navigation ──
function switchTab(view: 'history' | 'settings' | 'snippets' | 'form-reader') {
  tabHistory.classList.toggle('active', view === 'history')
  tabSnippets.classList.toggle('active', view === 'snippets')
  if (tabFormReader) tabFormReader.classList.toggle('active', view === 'form-reader')
  tabSettings.classList.toggle('active', view === 'settings')

  viewHistory.classList.toggle('active', view === 'history')
  viewSnippets.classList.toggle('active', view === 'snippets')
  if (viewFormReader) viewFormReader.classList.toggle('active', view === 'form-reader')
  viewSettings.classList.toggle('active', view === 'settings')

  if (view === 'snippets') {
    loadSnippetsToUI()
  } else if (view === 'form-reader') {
    refreshFormReaderStatus()
  }
}

tabHistory.onclick = () => switchTab('history')
tabSnippets.onclick = () => switchTab('snippets')
if (tabFormReader) tabFormReader.onclick = () => switchTab('form-reader')
tabSettings.onclick = () => switchTab('settings')

api.onSwitchView((view: string) => {
  if (view === 'settings') switchTab('settings')
  else if (view === 'snippets') switchTab('snippets')
  else if (view === 'form-reader') switchTab('form-reader')
  else switchTab('history')
})

// ── Toolbar Actions ──
toggleBtn.onclick = () => {
  monitoringEnabled = !monitoringEnabled
  updateMonitoringUI(monitoringEnabled)
  api.toggleMonitoring(monitoringEnabled)
}

function updateMonitoringUI(enabled: boolean) {
  const span = toggleBtn.querySelector('span')
  if (span) {
    span.textContent = enabled ? '👁️ Pano İzleme: Aktif' : '👁️ Pano İzleme: Kapalı'
  }
  if (enabled) {
    toggleBtn.classList.add('btn-toggle-active')
  } else {
    toggleBtn.classList.remove('btn-toggle-active')
  }
}

api.onMonitoringToggled((enabled: boolean) => {
  monitoringEnabled = enabled
  updateMonitoringUI(enabled)
})

clipboardUpperToggleBtn.onclick = () => {
  clipboardUpperEnabled = !clipboardUpperEnabled
  updateUpperToggleUI(clipboardUpperEnabled)
  api.getSettings().then((s: any) => {
    api.saveSettings({ ...s, clipboardUpperEnabled })
  })
}

function updateUpperToggleUI(enabled: boolean) {
  const span = clipboardUpperToggleBtn.querySelector('span')
  if (span) {
    span.textContent = enabled ? '🔠 Büyük Harf Yapıştır: Aktif' : '🔠 Büyük Harf: Kapalı'
  }
  if (enabled) {
    clipboardUpperToggleBtn.classList.add('btn-toggle-active')
  } else {
    clipboardUpperToggleBtn.classList.remove('btn-toggle-active')
  }
  if (sClipboardUpper) {
    sClipboardUpper.checked = enabled
  }
}

clearCacheBtn.onclick = async () => {
  const confirmed = await showConfirm(
    'Tüm Geçmişi Temizle',
    'Tüm sorgulanan cihaz geçmişi veritabanından kalıcı olarak silinecektir. Devam etmek istiyor musunuz?',
    'Evet, Temizle'
  )
  if (confirmed) {
    await api.clearCache()
    cachedDevices = []
    renderCards()
    showToast('Tüm cihaz geçmişi temizlendi.', 'info')
  }
}

api.onCacheCleared(() => {
  cachedDevices = []
  renderCards()
})

api.onRefreshCards(() => {
  loadCards()
})

// ── Excel Export ──
if (btnExportExcel) {
  btnExportExcel.onclick = () => {
    if (!cachedDevices || cachedDevices.length === 0) {
      showToast('Dışa aktarılacak cihaz kaydı bulunmuyor.', 'warning')
      return
    }

    try {
      const exportRows = cachedDevices.map(item => {
        const { fullStr } = formatModelData(item)
        return {
          'Seri Numarası': item.serial,
          'Model ve Renk': fullStr,
          'Garanti Durumu': item.warranty_status || '',
          'Sorgu Zamanı': formatDate(item.copy_date),
          'Garanti Bitiş': item.warranty_end || '-'
        }
      })

      const ws = XLSX.utils.json_to_sheet(exportRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Cihaz Geçmişi')
      const fileName = `AvoCheck_Garanti_Gecmisi_${new Date().toISOString().slice(0, 10)}.xlsx`
      XLSX.writeFile(wb, fileName)
      showToast('Excel dosyası başarıyla indirildi.', 'success')
    } catch (e: any) {
      console.error('Excel export error:', e)
      showToast('Excel aktarımı sırasında hata oluştu.', 'error')
    }
  }
}

// ── Server Status ──
statusRefreshBtn.onclick = () => {
  statusInfo.textContent = 'Kontrol ediliyor...'
  api.manualServerStatusRefresh()
}

api.onServerStatusUpdate((res: any) => {
  if (res && res.online) {
    statusDot.className = 'status-dot online'
    statusInfo.textContent = `Recci: ${res.latency}ms`
  } else {
    statusDot.className = 'status-dot offline'
    statusInfo.textContent = 'Sunucu: Kesik'
  }
})

// ── Dual Theme Management (Sadece Siyah & Beyaz) ──
let currentTheme: 'dark' | 'light' = 'dark'

function applyTheme(theme: string) {
  currentTheme = theme === 'light' ? 'light' : 'dark'
  document.body.classList.remove('dark', 'light')
  document.body.classList.add(currentTheme)

  if (currentTheme === 'light') {
    if (themeIcon) themeIcon.textContent = '🌙'
    if (themeText) themeText.textContent = 'Koyu Tema'
    btnThemeLight?.classList.add('active')
    btnThemeDark?.classList.remove('active')
  } else {
    if (themeIcon) themeIcon.textContent = '☀️'
    if (themeText) themeText.textContent = 'Açık Tema'
    btnThemeDark?.classList.add('active')
    btnThemeLight?.classList.remove('active')
  }
}

themeBtn.onclick = () => {
  const nextTheme: 'dark' | 'light' = currentTheme === 'dark' ? 'light' : 'dark'
  applyTheme(nextTheme)
  api.getSettings().then((s: any) => {
    api.saveSettings({ ...s, theme: nextTheme })
  })
}

if (btnThemeDark) {
  btnThemeDark.onclick = () => {
    applyTheme('dark')
    api.getSettings().then((s: any) => {
      api.saveSettings({ ...s, theme: 'dark' })
    })
  }
}

if (btnThemeLight) {
  btnThemeLight.onclick = () => {
    applyTheme('light')
    api.getSettings().then((s: any) => {
      api.saveSettings({ ...s, theme: 'light' })
    })
  }
}

function updateDashboardStats() {
  if (statTotalCount) statTotalCount.textContent = String(cachedDevices.length)

  const recciCount = cachedDevices.filter(d => {
    const s = (d.warranty_status || '').toUpperCase()
    return s.includes('GARANTİLİ') && !s.includes('DOLMUŞ') && !s.includes('FATURA')
  }).length
  if (statRecciCount) statRecciCount.textContent = String(recciCount)

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayCount = cachedDevices.filter(d => (d.copy_date || '').startsWith(todayStr)).length
  if (statTodaySub) statTodaySub.textContent = `Bugün taranan: ${todayCount} cihaz`
}

// ── Settings Auto-Save & Recorder Logic ──
async function loadSettingsToUI() {
  const s = await api.getSettings()

  sShortcutModelCopy.value = s.shortcuts?.copyModelColor || 'CommandOrControl+Shift+C'
  sShortcutClear.value = s.shortcuts?.clearCache || 'CommandOrControl+Shift+X'
  sShortcutMonitoring.value = s.shortcuts?.toggleMonitoring || 'CommandOrControl+Shift+M'

  sPopupSize.value = String(s.popupSizeLevel || 2)
  sPopupTimeout.value = String(s.popupTimeout || 5000)
  sAutoStart.checked = s.autoStartEnabled || false
  sPreventDuplicate.checked = s.preventDuplicatePopup || false
  sClipboardUpper.checked = s.clipboardUpperEnabled !== false
  if (sSoundEnabled) sSoundEnabled.checked = s.soundEnabled !== false
  if (sFormReaderTabEnabled) sFormReaderTabEnabled.checked = s.formReaderTabEnabled === true
  if (sFormReaderApiKey) sFormReaderApiKey.value = s.formReaderApiKey || ''
  if (formReaderInlineApiKey) formReaderInlineApiKey.value = s.formReaderApiKey || ''
  if (tabFormReader) {
    tabFormReader.style.display = s.formReaderTabEnabled === true ? '' : 'none'
  }

  clipboardUpperEnabled = s.clipboardUpperEnabled !== false
  updateUpperToggleUI(clipboardUpperEnabled)

  if (s.theme) applyTheme(s.theme)
}

async function saveCurrentSettings() {
  const currentSettings = await api.getSettings()
  const formReaderTabEnabled = sFormReaderTabEnabled ? sFormReaderTabEnabled.checked : Boolean(currentSettings.formReaderTabEnabled)
  const formReaderApiKey = sFormReaderApiKey ? sFormReaderApiKey.value.trim() : (currentSettings.formReaderApiKey || '')

  const settingsToSave = {
    ...currentSettings,
    shortcuts: {
      copyModelColor: sShortcutModelCopy.value,
      clearCache: sShortcutClear.value,
      toggleMonitoring: sShortcutMonitoring.value
    },
    popupSizeLevel: parseInt(sPopupSize.value),
    popupTimeout: parseInt(sPopupTimeout.value),
    autoStartEnabled: sAutoStart.checked,
    preventDuplicatePopup: sPreventDuplicate.checked,
    clipboardUpperEnabled: sClipboardUpper.checked,
    soundEnabled: sSoundEnabled ? sSoundEnabled.checked : true,
    formReaderTabEnabled,
    formReaderApiKey
  }

  try {
    await api.saveSettings(settingsToSave)
    clipboardUpperEnabled = sClipboardUpper.checked
    updateUpperToggleUI(clipboardUpperEnabled)
    if (tabFormReader) {
      tabFormReader.style.display = formReaderTabEnabled ? '' : 'none'
    }
    if (formReaderInlineApiKey) {
      formReaderInlineApiKey.value = formReaderApiKey
    }
    showToast('Ayarlar kaydedildi.', 'success')
  } catch (e: any) {
    showToast('Ayarlar kaydedilirken hata oluştu.', 'error')
  }
}

let saveTimeout: NodeJS.Timeout | null = null
function triggerAutoSave(debounceMs = 0) {
  if (saveTimeout) clearTimeout(saveTimeout)
  if (debounceMs > 0) {
    saveTimeout = setTimeout(saveCurrentSettings, debounceMs)
  } else {
    saveCurrentSettings()
  }
}

sPopupSize.addEventListener('change', () => triggerAutoSave(0))
sPopupTimeout.addEventListener('input', () => triggerAutoSave(500))
sAutoStart.addEventListener('change', () => triggerAutoSave(0))
sPreventDuplicate.addEventListener('change', () => triggerAutoSave(0))
sClipboardUpper.addEventListener('change', () => triggerAutoSave(0))
if (sSoundEnabled) sSoundEnabled.addEventListener('change', () => triggerAutoSave(0))
if (sFormReaderTabEnabled) sFormReaderTabEnabled.addEventListener('change', () => triggerAutoSave(0))
if (sFormReaderApiKey) sFormReaderApiKey.addEventListener('input', () => triggerAutoSave(600))

function setupShortcutRecorder(input: HTMLInputElement) {
  if (!input) return
  input.onkeydown = (e) => {
    e.preventDefault()
    const keys: string[] = []
    if (e.ctrlKey || e.metaKey) keys.push('CommandOrControl')
    if (e.shiftKey) keys.push('Shift')
    if (e.altKey) keys.push('Alt')

    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      keys.push(e.key.toUpperCase())
      input.value = keys.join('+')
      triggerAutoSave(0)
    }
  }
}

setupShortcutRecorder(sShortcutModelCopy)
setupShortcutRecorder(sShortcutClear)
setupShortcutRecorder(sShortcutMonitoring)

// ── Check Updates ──
if (btnCheckUpdate) {
  btnCheckUpdate.onclick = async () => {
    if (updateCheckStatus) updateCheckStatus.textContent = 'Güncellemeler kontrol ediliyor...'
    try {
      const res = await api.checkForUpdates()
      if (res && res.status === 'dev') {
        if (updateCheckStatus) updateCheckStatus.textContent = 'Geliştirici modundasınız. Canlı güncelleme pasif.'
      } else {
        if (updateCheckStatus) updateCheckStatus.textContent = 'En güncel sürümü kullanıyorsunuz.'
      }
    } catch {
      if (updateCheckStatus) updateCheckStatus.textContent = 'Güncelleme kontrolü başarısız oldu.'
    }
  }
}

// ── Metin Genişletici (Espanso Motoru) ──
const globalPrefixSelect = document.getElementById('global-prefix-select') as HTMLSelectElement
const toggleSnippetsGlobal = document.getElementById('toggle-snippets-global')!
const snippetEditId = document.getElementById('snippet-edit-id') as HTMLInputElement
const formCardHeading = document.getElementById('form-card-heading')!
const liveTriggerPreview = document.getElementById('live-trigger-preview')!
const snippetPrefix = document.getElementById('snippet-prefix') as HTMLSelectElement
const snippetTrigger = document.getElementById('snippet-trigger') as HTMLInputElement
const snippetTitle = document.getElementById('snippet-title') as HTMLInputElement
const snippetReplacement = document.getElementById('snippet-replacement') as HTMLTextAreaElement
const btnSaveSnippet = document.getElementById('btn-save-snippet')!
const btnSaveSnippetText = document.getElementById('btn-save-snippet-text')!
const btnCancelEditSnippet = document.getElementById('btn-cancel-edit-snippet')!
const snippetSearch = document.getElementById('snippet-search') as HTMLInputElement
const snippetsCount = document.getElementById('snippets-count')!
const snippetsList = document.getElementById('snippets-list')!
const snippetTestInput = document.getElementById('snippet-test-input') as HTMLTextAreaElement
const btnClearTestBox = document.getElementById('btn-clear-test-box')!

let snippetsConfig: any = { enabled: true, defaultPrefix: ':', snippets: [] }

function updateLiveTriggerPreview() {
  const p = (snippetPrefix.value || ':').trim()
  const t = (snippetTrigger.value || '').trim().replace(/^[:;/!.,#@]/, '')
  liveTriggerPreview.textContent = `${p}${t || 'ornek'}`
}

snippetPrefix.addEventListener('change', updateLiveTriggerPreview)
snippetTrigger.addEventListener('input', updateLiveTriggerPreview)

function resetSnippetForm() {
  snippetEditId.value = ''
  formCardHeading.textContent = '➕ Yeni Kısayol Ekle'
  btnSaveSnippetText.textContent = 'Kısayolu Kaydet'
  btnCancelEditSnippet.style.display = 'none'
  snippetPrefix.value = snippetsConfig.defaultPrefix || ':'
  snippetTrigger.value = ''
  snippetTitle.value = ''
  snippetReplacement.value = ''
  updateLiveTriggerPreview()
}

btnCancelEditSnippet.onclick = resetSnippetForm

async function loadSnippetsToUI() {
  try {
    snippetsConfig = await api.getSnippetsConfig()
    if (!snippetsConfig) return

    // Update global controls
    if (globalPrefixSelect) {
      globalPrefixSelect.value = snippetsConfig.defaultPrefix || ':'
    }
    if (snippetPrefix && !snippetEditId.value) {
      snippetPrefix.value = snippetsConfig.defaultPrefix || ':'
    }

    updateSnippetsGlobalToggleUI(snippetsConfig.enabled)
    renderSnippetsList()
    updateLiveTriggerPreview()
  } catch (err) {
    console.error('Failed to load snippets:', err)
  }
}

function updateSnippetsGlobalToggleUI(enabled: boolean) {
  if (enabled) {
    toggleSnippetsGlobal.className = 'btn btn-toggle-active'
    toggleSnippetsGlobal.innerHTML = '<span>⚡ Genişletici: Aktif</span>'
  } else {
    toggleSnippetsGlobal.className = 'btn'
    toggleSnippetsGlobal.innerHTML = '<span>⚡ Genişletici: Pasif</span>'
  }
}

toggleSnippetsGlobal.onclick = async () => {
  const next = !snippetsConfig.enabled
  const res = await api.setSnippetsGlobalEnabled(next)
  snippetsConfig.enabled = res
  updateSnippetsGlobalToggleUI(res)
  showToast(res ? 'Metin Genişletici aktif edildi.' : 'Metin Genişletici duraklatıldı.', res ? 'success' : 'info')
}

globalPrefixSelect.onchange = async () => {
  const newP = globalPrefixSelect.value
  await api.setSnippetsDefaultPrefix(newP)
  snippetsConfig.defaultPrefix = newP
  if (!snippetEditId.value) {
    snippetPrefix.value = newP
    updateLiveTriggerPreview()
  }
  showToast(`Varsayılan tetikleyici işareti '${newP}' olarak ayarlandı.`, 'info')
}

btnSaveSnippet.onclick = async () => {
  const trigger = snippetTrigger.value.trim().replace(/^[:;/!.,#@]/, '')
  const replacement = snippetReplacement.value.trim()

  if (!trigger) {
    showToast('Lütfen bir tetikleyici kelime girin (örn: adres).', 'warning')
    snippetTrigger.focus()
    return
  }
  if (!replacement) {
    showToast('Lütfen genişletilecek metni girin.', 'warning')
    snippetReplacement.focus()
    return
  }

  const prefix = snippetPrefix.value || ':'
  const title = snippetTitle.value.trim() || trigger
  const id = snippetEditId.value || undefined

  // Prevent duplicate: check in current snippets list
  const cleanTriggerLower = trigger.toLowerCase()
  const duplicate = (snippetsConfig.snippets || []).find((s: any) =>
    s.id !== id &&
    (s.prefix || ':') === prefix &&
    (s.trigger || '').toLowerCase() === cleanTriggerLower
  )
  if (duplicate) {
    showToast(`"${prefix}${trigger}" kısayolu zaten mevcut! Lütfen farklı bir tetikleyici belirleyin.`, 'warning')
    snippetTrigger.focus()
    return
  }

  try {
    await api.saveSnippet({ id, prefix, trigger, title, replacement })
    showToast(`"${prefix}${trigger}" kısayolu başarıyla kaydedildi!`, 'success')
    resetSnippetForm()
    await loadSnippetsToUI()
  } catch (err: any) {
    console.error('Save snippet error:', err)
    const errorMsg = (err?.message || '').replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Error: /, '')
    showToast(errorMsg || 'Kısayol kaydedilirken hata oluştu.', 'error')
  }
}

function renderSnippetsList() {
  const query = (snippetSearch.value || '').toLowerCase().trim()
  const list = (snippetsConfig.snippets || []).filter((s: any) => {
    if (!query) return true
    const fullTrig = ((s.prefix || '') + s.trigger).toLowerCase()
    const title = (s.title || '').toLowerCase()
    const rep = (s.replacement || '').toLowerCase()
    return fullTrig.includes(query) || title.includes(query) || rep.includes(query)
  })

  snippetsCount.textContent = `${list.length} Kısayol`

  if (list.length === 0) {
    snippetsList.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-secondary); background: var(--surface-card); border-radius: 12px; border: 1px dashed var(--border-subtle);">
        <div style="font-size: 1.5rem; margin-bottom: 8px;">⚡</div>
        <div style="font-weight: 600;">Eşleşen Kısayol Bulunamadı</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Soldaki formdan hemen yeni bir metin kısayolu ekleyebilirsiniz.</div>
      </div>
    `
    return
  }

  snippetsList.innerHTML = list.map((s: any) => {
    const fullTrig = (s.prefix || ':') + s.trigger
    const isOff = s.enabled === false
    return `
      <div class="snippet-item-card ${isOff ? 'disabled' : ''}" data-id="${s.id}">
        <div class="snippet-item-header">
          <div class="snippet-item-left">
            <span class="snippet-preview-pill">${fullTrig}</span>
            <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(s.title || s.trigger)}</strong>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <label class="toggle-switch" title="${isOff ? 'Aktif Et' : 'Devre Dışı Bırak'}">
              <input type="checkbox" class="snippet-toggle-btn" data-id="${s.id}" ${!isOff ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="snippet-item-text">${escapeHtml(s.replacement)}</div>

        <div class="snippet-item-actions">
          <button type="button" class="btn btn-copy-snip" data-id="${s.id}" style="padding: 4px 10px; font-size: 0.8rem;">
            📋 Kopyala
          </button>
          <button type="button" class="btn btn-edit-snip" data-id="${s.id}" style="padding: 4px 10px; font-size: 0.8rem;">
            ✏️ Düzenle
          </button>
          <button type="button" class="btn btn-danger btn-del-snip" data-id="${s.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="Sil">
            🗑️
          </button>
        </div>
      </div>
    `
  }).join('')

  // Wire buttons
  snippetsList.querySelectorAll('.snippet-toggle-btn').forEach((elem: any) => {
    elem.onchange = async () => {
      const id = elem.dataset.id
      const res = await api.toggleSnippet(id, elem.checked)
      const parentCard = elem.closest('.snippet-item-card')
      if (parentCard) parentCard.classList.toggle('disabled', !res)
      showToast(res ? 'Kısayol aktif edildi.' : 'Kısayol pasifleştirildi.', 'info')
    }
  })

  snippetsList.querySelectorAll('.btn-copy-snip').forEach((btn: any) => {
    btn.onclick = () => {
      const id = btn.dataset.id
      const item = snippetsConfig.snippets.find((s: any) => s.id === id)
      if (item) {
        navigator.clipboard.writeText(item.replacement)
        const oldText = btn.innerHTML
        btn.innerHTML = '✓ Kopyalandı'
        setTimeout(() => { btn.innerHTML = oldText }, 1200)
      }
    }
  })

  snippetsList.querySelectorAll('.btn-edit-snip').forEach((btn: any) => {
    btn.onclick = () => {
      const id = btn.dataset.id
      const item = snippetsConfig.snippets.find((s: any) => s.id === id)
      if (item) {
        snippetEditId.value = item.id
        snippetPrefix.value = item.prefix || ':'
        snippetTrigger.value = item.trigger
        snippetTitle.value = item.title || ''
        snippetReplacement.value = item.replacement
        formCardHeading.textContent = '✏️ Kısayolu Düzenle'
        btnSaveSnippetText.textContent = 'Değişiklikleri Güncelle'
        btnCancelEditSnippet.style.display = 'inline-flex'
        updateLiveTriggerPreview()
        snippetTrigger.focus()
      }
    }
  })

  snippetsList.querySelectorAll('.btn-del-snip').forEach((btn: any) => {
    btn.onclick = async () => {
      const id = btn.dataset.id
      const item = snippetsConfig.snippets.find((s: any) => s.id === id)
      if (!item) return
      const fullTrig = (item.prefix || ':') + item.trigger
      const confirmed = await showConfirm(
        'Kısayolu Sil',
        `"${fullTrig}" (${item.title || item.trigger}) kısayolunu silmek istediğinize emin misiniz?`
      )
      if (confirmed) {
        await api.deleteSnippet(id)
        if (snippetEditId.value === id) resetSnippetForm()
        await loadSnippetsToUI()
        showToast('Kısayol silindi.', 'info')
      }
    }
  })
}

snippetSearch.addEventListener('input', () => {
  renderSnippetsList()
})

btnClearTestBox.onclick = () => {
  snippetTestInput.value = ''
  snippetTestInput.focus()
}

function escapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ── AI Form Okuyucu (OCR & Müşteri Formu Ayrıştırıcı) ──
const formReaderStatusBadge = document.getElementById('form-reader-status-badge')
const formReaderUrlEl = document.getElementById('form-reader-url')
const formReaderInlineApiKey = document.getElementById('form-reader-inline-api-key') as HTMLInputElement
const btnToggleApiKeyVis = document.getElementById('btn-toggle-api-key-vis')
const btnSaveFormApiKey = document.getElementById('btn-save-form-api-key')
const btnFormReaderToggle = document.getElementById('btn-form-reader-toggle') as HTMLButtonElement
const btnFormReaderCopyUrl = document.getElementById('btn-form-reader-copy-url')
const btnFormReaderOpenFolder = document.getElementById('btn-form-reader-open-folder')
const formReaderQr = document.getElementById('form-reader-qr')
const formReaderQrCaption = document.getElementById('form-reader-qr-caption')
const formReaderDropzone = document.getElementById('form-reader-dropzone')
const formReaderFileInput = document.getElementById('form-reader-file-input') as HTMLInputElement
const formReaderThumbs = document.getElementById('form-reader-thumbs')
const formReaderRawText = document.getElementById('form-reader-raw-text') as HTMLTextAreaElement
const btnFormReaderClearPc = document.getElementById('btn-form-reader-clear-pc')
const formReaderPcStatus = document.getElementById('form-reader-pc-status')
const btnFormReaderSubmitPc = document.getElementById('btn-form-reader-submit-pc') as HTMLButtonElement
const formReaderResultText = document.getElementById('form-reader-result-text') as HTMLTextAreaElement
const formReaderLastMeta = document.getElementById('form-reader-last-meta')
const btnFormReaderCopyResult = document.getElementById('btn-form-reader-copy-result')

let formReaderRunning = false
let formReaderUrl = ''
let pcPhotos: Array<{ base64: string; mime: string; previewUrl: string }> = []

function playFormReadyChime() {
  if (sSoundEnabled && !sSoundEnabled.checked) return
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const notes = [587.33, 880] // D5 -> A5 pleasant two-tone chime
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.11)
      gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + i * 0.11 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.11 + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.11)
      osc.stop(ctx.currentTime + i * 0.11 + 0.26)
    })
  } catch { }
}

function applyFormReaderStatusUI(st: any) {
  if (!st) return
  formReaderRunning = Boolean(st.running)
  formReaderUrl = st.url || 'http://127.0.0.1:5055'

  if (formReaderUrlEl) formReaderUrlEl.textContent = formReaderUrl
  if (formReaderQr && st.qrSvg) {
    formReaderQr.innerHTML = st.qrSvg
    formReaderQr.style.opacity = formReaderRunning ? '1' : '0.35'
  }
  if (formReaderQrCaption) {
    formReaderQrCaption.innerHTML = formReaderRunning
      ? `<span style="color: var(--accent-lime);">● Aktif</span> — Kamerayla okutun`
      : 'Servis başlatıldığında<br>telefonla okutun'
  }
  if (formReaderStatusBadge) {
    formReaderStatusBadge.textContent = formReaderRunning ? 'ÇALIŞIYOR (:5055)' : 'KAPALI'
    formReaderStatusBadge.style.background = formReaderRunning ? 'rgba(16, 185, 129, 0.18)' : ''
    formReaderStatusBadge.style.color = formReaderRunning ? '#10b981' : ''
    formReaderStatusBadge.style.borderColor = formReaderRunning ? 'rgba(16, 185, 129, 0.4)' : ''
  }
  if (btnFormReaderToggle) {
    btnFormReaderToggle.innerHTML = formReaderRunning
      ? '<span>⏹️ Servisi Durdur (:5055)</span>'
      : '<span>▶️ Servisi Başlat (:5055)</span>'
  }
  if (st.lastResult && formReaderResultText && !formReaderResultText.value) {
    formReaderResultText.value = st.lastResult
  }
}

async function refreshFormReaderStatus() {
  try {
    const st = await api.getFormReaderStatus()
    applyFormReaderStatusUI(st)
  } catch { }
}

if (btnToggleApiKeyVis && formReaderInlineApiKey) {
  btnToggleApiKeyVis.onclick = () => {
    const isPwd = formReaderInlineApiKey.type === 'password'
    formReaderInlineApiKey.type = isPwd ? 'text' : 'password'
    if (sFormReaderApiKey) sFormReaderApiKey.type = isPwd ? 'text' : 'password'
  }
}

if (btnSaveFormApiKey && formReaderInlineApiKey) {
  btnSaveFormApiKey.onclick = async () => {
    const key = formReaderInlineApiKey.value.trim()
    if (sFormReaderApiKey) sFormReaderApiKey.value = key
    const currentSettings = await api.getSettings()
    await api.saveSettings({ ...currentSettings, formReaderApiKey: key })
    showToast('Gemini API anahtarı kaydedildi.', 'success')
  }
}

if (btnFormReaderToggle) {
  btnFormReaderToggle.onclick = async () => {
    btnFormReaderToggle.disabled = true
    try {
      if (formReaderInlineApiKey) {
        const inlineKey = formReaderInlineApiKey.value.trim()
        if (sFormReaderApiKey && inlineKey !== sFormReaderApiKey.value.trim()) {
          sFormReaderApiKey.value = inlineKey
          const s = await api.getSettings()
          await api.saveSettings({ ...s, formReaderApiKey: inlineKey })
        }
      }
      const st = formReaderRunning
        ? await api.stopFormReader()
        : await api.startFormReader()
      applyFormReaderStatusUI(st)
      if (st.error) {
        showToast(st.error, 'error')
      } else if (st.running) {
        showToast(`Form Okuyucu başlatıldı: ${st.url}`, 'success')
      } else {
        showToast('Form Okuyucu durduruldu.', 'info')
      }
    } catch (e: any) {
      showToast('İşlem başarısız: ' + (e?.message || e), 'error')
    } finally {
      btnFormReaderToggle.disabled = false
    }
  }
}

if (btnFormReaderCopyUrl) {
  btnFormReaderCopyUrl.onclick = () => {
    if (!formReaderUrl) return
    navigator.clipboard.writeText(formReaderUrl)
    showToast(`Bağlantı kopyalandı: ${formReaderUrl}`, 'success')
  }
}

if (btnFormReaderOpenFolder) {
  btnFormReaderOpenFolder.onclick = () => {
    api.openFormReaderFolder()
  }
}

async function compressFileToJpegBase64(file: File): Promise<{ base64: string; mime: string; previewUrl: string }> {
  const MAX_DIM = 2200
  const QUALITY = 0.85
  let bmp: ImageBitmap | HTMLImageElement
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any)
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = URL.createObjectURL(file)
    })
  }
  const w = bmp.width
  const h = bmp.height
  const scale = Math.min(1, MAX_DIM / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
  const base64 = dataUrl.split(',')[1] || ''
  return { base64, mime: 'image/jpeg', previewUrl: dataUrl }
}

function renderPcThumbs() {
  if (!formReaderThumbs) return
  formReaderThumbs.innerHTML = ''
  pcPhotos.forEach((p, idx) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:relative; aspect-ratio:3/4; border-radius:10px; overflow:hidden; border:1px solid var(--border-subtle); background:var(--surface-elevated);'
    wrap.innerHTML = `
      <img src="${p.previewUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">
      <span style="position:absolute; left:5px; bottom:5px; background:rgba(0,0,0,0.72); color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:6px;">Sayfa ${idx + 1}</span>
    `
    const del = document.createElement('button')
    del.type = 'button'
    del.textContent = '✕'
    del.style.cssText = 'position:absolute; right:4px; top:4px; width:22px; height:22px; border:0; border-radius:50%; background:rgba(0,0,0,0.75); color:#fff; font-size:12px; cursor:pointer;'
    del.onclick = () => {
      pcPhotos.splice(idx, 1)
      renderPcThumbs()
    }
    wrap.appendChild(del)
    formReaderThumbs.appendChild(wrap)
  })
}

async function addPcImageFiles(files: FileList | File[]) {
  const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
  if (arr.length === 0) return
  if (formReaderPcStatus) formReaderPcStatus.textContent = 'Fotoğraflar hazırlanıyor...'
  for (const f of arr) {
    try {
      const item = await compressFileToJpegBase64(f)
      pcPhotos.push(item)
    } catch {
      showToast('Bir fotoğraf okunamadı.', 'error')
    }
  }
  renderPcThumbs()
  if (formReaderPcStatus) formReaderPcStatus.textContent = `${pcPhotos.length} sayfa hazır`
}

if (formReaderDropzone && formReaderFileInput) {
  formReaderDropzone.onclick = () => formReaderFileInput.click()
  formReaderFileInput.onchange = async () => {
    if (formReaderFileInput.files) {
      await addPcImageFiles(formReaderFileInput.files)
      formReaderFileInput.value = ''
    }
  }
  formReaderDropzone.ondragover = (e) => {
    e.preventDefault()
    formReaderDropzone.style.borderColor = 'var(--accent-lime)'
  }
  formReaderDropzone.ondragleave = () => {
    formReaderDropzone.style.borderColor = 'var(--border-subtle)'
  }
  formReaderDropzone.ondrop = async (e) => {
    e.preventDefault()
    formReaderDropzone.style.borderColor = 'var(--border-subtle)'
    if (e.dataTransfer?.files) {
      await addPcImageFiles(e.dataTransfer.files)
    }
  }
}

// Allow Ctrl+V image paste when Form Reader tab is active
window.addEventListener('paste', async (e: ClipboardEvent) => {
  if (!viewFormReader || !viewFormReader.classList.contains('active')) return
  const items = e.clipboardData?.items
  if (!items) return
  const imgFiles: File[] = []
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) imgFiles.push(f)
    }
  }
  if (imgFiles.length > 0) {
    e.preventDefault()
    await addPcImageFiles(imgFiles)
    showToast(`${imgFiles.length} görsel yapıştırıldı.`, 'info')
  }
})

if (btnFormReaderClearPc) {
  btnFormReaderClearPc.onclick = () => {
    pcPhotos = []
    renderPcThumbs()
    if (formReaderRawText) formReaderRawText.value = ''
    if (formReaderPcStatus) formReaderPcStatus.textContent = 'Hazır'
  }
}

if (btnFormReaderSubmitPc) {
  btnFormReaderSubmitPc.onclick = async () => {
    const rawText = formReaderRawText ? formReaderRawText.value.trim() : ''
    if (pcPhotos.length === 0 && !rawText) {
      showToast('Lütfen önce fotoğraf ekleyin veya metin yapıştırın.', 'error')
      return
    }
    if (formReaderInlineApiKey) {
      const inlineKey = formReaderInlineApiKey.value.trim()
      if (sFormReaderApiKey && inlineKey !== sFormReaderApiKey.value.trim()) {
        sFormReaderApiKey.value = inlineKey
        const s = await api.getSettings()
        await api.saveSettings({ ...s, formReaderApiKey: inlineKey })
      }
    }
    btnFormReaderSubmitPc.disabled = true
    if (formReaderPcStatus) formReaderPcStatus.textContent = 'Gemini okuyor, lütfen bekleyin...'
    try {
      const res = await api.processFormFromPc({
        photos: pcPhotos.length > 0 ? pcPhotos.map((p) => ({ base64: p.base64, mime: p.mime })) : undefined,
        rawText: pcPhotos.length === 0 ? rawText : undefined
      })
      if (!res?.ok) {
        if (formReaderPcStatus) formReaderPcStatus.textContent = 'Hata oluştu'
        showToast(res?.error || 'Form ayrıştırılamadı.', 'error')
        return
      }
      if (formReaderPcStatus) formReaderPcStatus.textContent = '✓ Panoya kopyalandı!'
      pcPhotos = []
      renderPcThumbs()
      if (formReaderRawText) formReaderRawText.value = ''
    } catch (e: any) {
      if (formReaderPcStatus) formReaderPcStatus.textContent = 'Hata'
      showToast('Hata: ' + (e?.message || e), 'error')
    } finally {
      btnFormReaderSubmitPc.disabled = false
    }
  }
}

if (btnFormReaderCopyResult && formReaderResultText) {
  btnFormReaderCopyResult.onclick = () => {
    const val = formReaderResultText.value.trim()
    if (!val) return
    navigator.clipboard.writeText(val)
    showToast('Form metni panoya kopyalandı!', 'success')
  }
}

api.onFormReaderResult((ev: any) => {
  if (!ev || !ev.text) return
  if (formReaderResultText) formReaderResultText.value = ev.text
  if (formReaderLastMeta) {
    const srcLabel =
      ev.source === 'phone-photo'
        ? '📱 Telefondan (Fotoğraf)'
        : ev.source === 'phone-clip'
          ? '📱 Telefondan (Metin)'
          : '💻 Bilgisayardan'
    formReaderLastMeta.textContent = `${srcLabel} • ${formatDate(ev.timestamp)}`
  }
  playFormReadyChime()
  const firstLine = (ev.text.split(/\r?\n/)[0] || '').replace('Müşteri Adı Soyadı:', '').trim()
  showToast(
    `📄 Form panoya kopyalandı${firstLine ? `: ${firstLine}` : '!'}`,
    'success'
  )
})

// ── Init ──
loadSettingsToUI()
loadCards()
