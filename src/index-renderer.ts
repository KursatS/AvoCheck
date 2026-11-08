export { }
import { showToast } from './utils/toastUtils'
import { SVG_EMPTY_FOLDER } from './utils/svgUtils'
import * as XLSX from 'xlsx'

const cardsDiv = document.getElementById('cards')!
const searchInput = document.getElementById('search') as HTMLInputElement
const toggleBtn = document.getElementById('toggle')!
const themeBtn = document.getElementById('theme-toggle')!
const clearCacheBtn = document.getElementById('clear-cache')!
const clipboardUpperToggleBtn = document.getElementById('clipboard-upper-toggle')!
const statusDot = document.getElementById('status-dot')!
const statusInfo = document.getElementById('status-info')!
const statusRefreshBtn = document.getElementById('status-refresh-btn')!
const devicesCount = document.getElementById('devices-count')!
const btnExportExcel = document.getElementById('btn-export-excel')

// Navigation Tabs
const tabHistory = document.getElementById('tab-history')!
const tabSnippets = document.getElementById('tab-snippets')!
const tabSettings = document.getElementById('tab-settings')!
const viewHistory = document.getElementById('view-history')!
const viewSnippets = document.getElementById('view-snippets')!
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
function switchTab(view: 'history' | 'settings' | 'snippets') {
  tabHistory.classList.toggle('active', view === 'history')
  tabSnippets.classList.toggle('active', view === 'snippets')
  tabSettings.classList.toggle('active', view === 'settings')

  viewHistory.classList.toggle('active', view === 'history')
  viewSnippets.classList.toggle('active', view === 'snippets')
  viewSettings.classList.toggle('active', view === 'settings')

  if (view === 'snippets') {
    loadSnippetsToUI()
  }
}

tabHistory.onclick = () => switchTab('history')
tabSnippets.onclick = () => switchTab('snippets')
tabSettings.onclick = () => switchTab('settings')

api.onSwitchView((view: string) => {
  if (view === 'settings') switchTab('settings')
  else if (view === 'snippets') switchTab('snippets')
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
      const fileName = `RecciTek_Garanti_Gecmisi_${new Date().toISOString().slice(0, 10)}.xlsx`
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

// ── Theme Management ──
const ALL_THEMES = ['dark', 'midnight', 'ocean', 'sunset'] as const
const THEME_ICONS: Record<string, string> = {
  dark: '🌙',
  midnight: '🔮',
  ocean: '🌊',
  sunset: '🌅'
}
let currentTheme = 'dark'

function applyTheme(theme: string) {
  currentTheme = theme
  document.body.classList.remove(...ALL_THEMES)
  document.body.classList.add(theme)
  themeBtn.textContent = THEME_ICONS[theme] || '🌙'
}

themeBtn.onclick = () => {
  const idx = ALL_THEMES.indexOf(currentTheme as any)
  const next = ALL_THEMES[(idx + 1) % ALL_THEMES.length]
  applyTheme(next)
  api.getSettings().then((s: any) => {
    api.saveSettings({ ...s, theme: next })
  })
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

  clipboardUpperEnabled = s.clipboardUpperEnabled !== false
  updateUpperToggleUI(clipboardUpperEnabled)

  if (s.theme) applyTheme(s.theme)
}

async function saveCurrentSettings() {
  const currentSettings = await api.getSettings()
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
    clipboardUpperEnabled: sClipboardUpper.checked
  }

  try {
    await api.saveSettings(settingsToSave)
    clipboardUpperEnabled = sClipboardUpper.checked
    updateUpperToggleUI(clipboardUpperEnabled)
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

  try {
    await api.saveSnippet({ id, prefix, trigger, title, replacement })
    showToast(`"${prefix}${trigger}" kısayolu başarıyla kaydedildi!`, 'success')
    resetSnippetForm()
    await loadSnippetsToUI()
  } catch (err: any) {
    console.error('Save snippet error:', err)
    showToast('Kısayol kaydedilirken hata oluştu.', 'error')
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

// ── Init ──
loadSettingsToUI()
loadCards()
