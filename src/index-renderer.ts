export { }
import { showToast } from './utils/toastUtils'
import { SVG_EMPTY_FOLDER } from './utils/svgUtils'
import { initPriorityLogic } from './utils/priorityLogic'
import { initSettingsLogic } from './utils/settingsLogic'
import { initAdminLogic } from './utils/adminLogic'
import { initZReportLogic } from './utils/zreportLogic'
import { initDeviceCallLogic } from './utils/deviceCallLogic'
import { escapeHtml } from './utils/html'

//
const cardsDiv = document.getElementById('cards')!
const searchInput = document.getElementById('search') as HTMLInputElement
const toggleBtn = document.getElementById('toggle')!
const themeBtn = document.getElementById('theme-toggle')!
const clearCacheBtn = document.getElementById('clear-cache')!
const clipboardUpperToggleBtn = document.getElementById('clipboard-upper-toggle')!
const statusDot = document.getElementById('status-dot')!
const statusInfo = document.getElementById('status-info')!
const statusRefreshBtn = document.getElementById('status-refresh-btn')!

// Sidebar Elements
const sideName = document.getElementById('side-name')!
const navItems = document.querySelectorAll('.nav-item')
const viewSections = document.querySelectorAll('.view-section')

// Priority View Elements
const prioList = document.getElementById('priority-list')!
const pSerial = document.getElementById('p-serial') as HTMLInputElement
const pCustomer = document.getElementById('p-customer') as HTMLInputElement
const pDesc = document.getElementById('p-desc') as HTMLInputElement
const addPrioBtn = document.getElementById('add-priority-btn')!

// Settings View Elements
const sPersonnelName = document.getElementById('personnel-name') as HTMLInputElement
const sUserRole = document.getElementById('user-role') as HTMLInputElement
const sShortcutModelCopy = document.getElementById('shortcut-model-copy') as HTMLInputElement
const sShortcutClear = document.getElementById('shortcut-clear') as HTMLInputElement
const sShortcutMonitoring = document.getElementById('shortcut-monitoring') as HTMLInputElement
const sPopupSize = document.getElementById('popup-size') as HTMLSelectElement
const sPopupTimeout = document.getElementById('popup-timeout') as HTMLInputElement
const sAutoStart = document.getElementById('auto-start') as HTMLInputElement
const sPreventDuplicate = document.getElementById('prevent-duplicate') as HTMLInputElement
const sClipboardUpper = document.getElementById('clipboard-upper') as HTMLInputElement
const sLogoutBtn = document.getElementById('logout-btn') as HTMLButtonElement

// Z Report View Elements
const zreportDropZone = document.getElementById('zreport-drop-zone')!
const zreportFileInput = document.getElementById('zreport-file-input') as HTMLInputElement
const zreportResults = document.getElementById('zreport-results')!
const zreportAnalytics = document.getElementById('zreport-analytics')!

// Admin View Elements
const adminUserList = document.getElementById('admin-user-list')!
const btnAddUser = document.getElementById('btn-add-user')!
const adminModal = document.getElementById('admin-user-modal')!
const adminModalTitle = document.getElementById('admin-modal-title')!
const adminUserId = document.getElementById('admin-user-id') as HTMLInputElement
const adminUsername = document.getElementById('admin-user-username') as HTMLInputElement
const adminPassword = document.getElementById('admin-user-password') as HTMLInputElement
const adminFullname = document.getElementById('admin-user-fullname') as HTMLInputElement
const adminRole = document.getElementById('admin-user-role') as HTMLSelectElement
const btnCancelAdminModal = document.getElementById('btn-cancel-admin-modal')!
const btnSaveAdminUser = document.getElementById('btn-save-admin-user')!

// Device Call Elements
const sideDeviceCallBtn = document.getElementById('side-device-call-btn')!
const deviceCallModal = document.getElementById('device-call-modal')!
const dcallSerial = document.getElementById('dcall-serial') as HTMLInputElement
const dcallModel = document.getElementById('dcall-model') as HTMLInputElement
const dcallCustomer = document.getElementById('dcall-customer') as HTMLInputElement
const btnCancelDeviceCall = document.getElementById('btn-cancel-device-call')!
const btnSendDeviceCall = document.getElementById('btn-send-device-call')!
const deviceCallToastContainer = document.getElementById('device-call-toast-container')!
const dcallHistoryList = document.getElementById('device-call-history-list')
const dcallSearchInput = document.getElementById('device-call-search') as HTMLInputElement
const dcallStatusFilter = document.getElementById('device-call-status-filter') as HTMLSelectElement
const btnOpenDeviceCallModal = document.getElementById('btn-open-device-call-modal')


// Modal elements
const modalOverlay = document.getElementById('modal-overlay')!
const modalTitle = document.getElementById('modal-title')!
const modalText = document.getElementById('modal-text')!
const modalConfirm = document.getElementById('modal-confirm')!
const modalCancel = document.getElementById('modal-cancel')!

const api = (window as any).electronAPI

let monitoringEnabled = true
let currentRole = 'kargo_kabul'
let personnelName = ''

//
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

//
function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

//
function loadCards() {
    cardsDiv.innerHTML = `
        <div class="card" style="display:flex; flex-direction:column; gap:12px; pointer-events:none; opacity:0.7;">
            <div class="skeleton" style="width: 30%; height: 24px;"></div>
            <div class="skeleton" style="width: 100%; height: 60px;"></div>
            <div class="skeleton" style="width: 60%; height: 20px;"></div>
        </div>
        <div class="card" style="display:flex; flex-direction:column; gap:12px; pointer-events:none; opacity:0.5;">
            <div class="skeleton" style="width: 40%; height: 24px;"></div>
            <div class="skeleton" style="width: 100%; height: 60px;"></div>
            <div class="skeleton" style="width: 80%; height: 20px;"></div>
        </div>
    `

    api.getCachedData().then((data: any[]) => {
        cardsDiv.innerHTML = ''

        if (!data || data.length === 0) {
            cardsDiv.innerHTML = `
        <div class="empty-state">
          ${SVG_EMPTY_FOLDER}
          <h3>Henüz bir cihaz sorgulanmadı</h3>
          <p>Panoya bir seri numarası kopyaladığınızda burada görünecektir.</p>
        </div>
      `
            return
        }

        const query = searchInput.value.toLowerCase()
        data.sort((a: any, b: any) => new Date(b.copy_date).getTime() - new Date(a.copy_date).getTime())

        // FIX: BATCH DOM APPENDS
        const fragment = document.createDocumentFragment();

        data.forEach((item: any) => {
            if (item.serial.toLowerCase().includes(query)) {
                const card = document.createElement('div')
                let cardClass = 'card'
                const statusLabel = item.warranty_status

                if (statusLabel.includes('RECCI')) cardClass += ' recci'
                else if (statusLabel.includes('KVK')) cardClass += ' kvk'
                else cardClass += ' out-of-warranty'

                const isExpiredRecci = statusLabel.includes('SÜRESİ DOLMUŞ') || statusLabel.includes('FATURA KONTROL')
                const statusTagContent = isExpiredRecci
                    ? `<span style="color:#10b981;">RECCI GARANTİLİ</span> <span style="color:#f59e0b;font-weight:700;">(SÜRESİ DOLMUŞ - FATURA KONTROL)</span>`
                    : statusLabel

                let cleanModel = (item.model_name || 'Bilinmiyor').toUpperCase().trim()
                    .replace(/^ROBOROCK\s+/i, '').replace(/^ROBOROCK$/i, '').replace(/QREVO/g, 'Q REVO').trim()
                let cleanColor = (item.model_color || '').toUpperCase().trim()
                    .replace(/QREVO/g, 'Q REVO').trim()

                if (cleanColor && cleanModel.endsWith(cleanColor)) {
                    cleanModel = cleanModel.substring(0, cleanModel.length - cleanColor.length).trim()
                }

                const modelDisplayStr = cleanColor ? `${cleanModel} ${cleanColor}` : cleanModel

                card.className = cardClass
                card.style.position = 'relative'
                card.innerHTML = `
          <button class="delete-btn" onclick="deleteEntry('${item.serial}')">&#10005;</button>
          <div class="status-tag">${statusTagContent}</div>
          <p><strong>Seri:</strong> ${item.serial}</p>
          <p><strong>Model:</strong> ${modelDisplayStr}</p>
          <p><strong>Tarih:</strong> ${formatDate(item.copy_date)}</p>
          ${item.warranty_end ? `<p><strong>FT Biti\u015f:</strong> ${item.warranty_end}</p>` : ''}
        `
                fragment.appendChild(card)
            }
        })

        cardsDiv.appendChild(fragment)
    })
}

//
toggleBtn.onclick = () => {
    monitoringEnabled = !monitoringEnabled
    const span = toggleBtn.querySelector('span')
    if (span) {
        span.textContent = monitoringEnabled ? '\u{1F4CB} Clipboard \u0130zleme: Aktif' : '\u{1F4CB} Clipboard \u0130zleme: Devre D\u0131\u015f\u0131'
    }
    toggleBtn.style.opacity = monitoringEnabled ? '1' : '0.6'
    api.toggleMonitoring(monitoringEnabled)
}

//
const ALL_THEMES = ['dark', 'midnight', 'ocean', 'sunset'] as const
const THEME_ICONS: Record<string, string> = {
    dark: '\u{1F319}',
    midnight: '\u{1F52E}',
    ocean: '\u{1F30A}',
    sunset: '\u{1F305}'
}
let currentTheme = 'dark'

function applyTheme(theme: string) {
    currentTheme = theme
    document.body.classList.remove(...ALL_THEMES)
    document.body.classList.add(theme)
    themeBtn.textContent = THEME_ICONS[theme] || '\u{1F319}'
    document.querySelectorAll('.theme-card').forEach((c: any) => {
        c.classList.toggle('selected', c.dataset.theme === theme)
    })
}

themeBtn.onclick = () => {
    const idx = ALL_THEMES.indexOf(currentTheme as any)
    const next = ALL_THEMES[(idx + 1) % ALL_THEMES.length]
    applyTheme(next)
    api.getSettings().then((s: any) => {
        api.saveSettings({ ...s, theme: next })
    })
}

const themePicker = document.getElementById('theme-picker')
if (themePicker) {
    themePicker.addEventListener('click', (e: Event) => {
        const card = (e.target as HTMLElement).closest('.theme-card') as HTMLElement | null
        if (!card || !card.dataset.theme) return
        const theme = card.dataset.theme
        applyTheme(theme)
        api.getSettings().then((s: any) => {
            api.saveSettings({ ...s, theme })
        })
    })
}

api.getSettings().then((s: any) => {
    const theme = s.theme || 'dark'
    applyTheme(theme)
})


//
let mainSearchTimeout: NodeJS.Timeout
searchInput.oninput = () => {
    clearTimeout(mainSearchTimeout)
    mainSearchTimeout = setTimeout(() => {
        loadCards()
    }, 300)
}

//
function switchView(viewName: string) {
    viewSections.forEach(sec => sec.classList.remove('active'))
    navItems.forEach(item => item.classList.remove('active'))

    const targetSec = document.getElementById(`view-${viewName}`)
    const targetNavItem = document.querySelector(`[data-view="${viewName}"]`)

    if (targetSec && targetNavItem) {
        targetSec.classList.add('active')
        targetNavItem.classList.add('active')
    }

    // Refresh data based on view
    if (viewName === 'history') {
        loadCards()
        api.getSettings().then((s: any) => {
            updateClipboardUpperUI(s.clipboardUpperEnabled !== false)
        })
    }
    else if (viewName === 'priority') loadPriorityDevices()
    else if (viewName === 'admin') loadAdminUsers()
    else if (viewName === 'settings') loadSettingsToUI()
    else if (viewName === 'device-calls') deviceCallController.renderHistory()
}

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const view = (item as HTMLElement).dataset.view
        if (view) switchView(view)
    })
})

//
async function refreshSidebarProfile() {
    const settings = await api.getSettings()
    personnelName = settings.personnelName || 'İsimsiz'
    if (sideName) sideName.textContent = personnelName.toUpperCase()
}

//
clearCacheBtn.onclick = async () => {
    const confirmed = await showConfirm(
        'T\u00fcm Ge\u00e7mi\u015fi Temizle',
        'T\u00fcm sorgu ge\u00e7mi\u015finiz kal\u0131c\u0131 olarak silinecektir. Emin misiniz?',
        'T\u00fcm\u00fcn\u00fc Sil'
    )
    if (confirmed) {
        try {
            await api.clearCache()
            loadCards()
            showToast('T\u00fcm \u00f6nbellek ba\u015far\u0131yla temizlendi.', 'success')
        } catch (e: any) {
            showToast('Temizleme hatas\u0131: ' + e.message, 'error')
        }
    }
}

//
    ; (window as any).deleteEntry = async (serial: string) => {
        const confirmed = await showConfirm(
            'Kayd\u0131 Sil',
            `${serial} seri numaral\u0131 cihaz\u0131 listeden silmek istedi\u011finizden emin misiniz?`
        )
        if (confirmed) {
            try {
                await api.deleteEntry(serial)
                loadCards()
                showToast(`${serial} kayd\u0131 silindi.`, 'success')
            } catch (e: any) {
                showToast('Silinemedi: ' + e.message, 'error')
            }
        }
    }

function updateClipboardUpperUI(enabled: boolean) {
    const span = clipboardUpperToggleBtn.querySelector('span')
    if (span) {
        span.textContent = enabled ? '🔠 Büyük Harf Yapıştır: Aktif' : '🔠 Büyük Harf Yapıştır: Kapalı'
    }
    clipboardUpperToggleBtn.classList.toggle('btn-warning', !enabled)
    clipboardUpperToggleBtn.classList.toggle('btn-primary', enabled)
}

api.getSettings().then((s: any) => updateClipboardUpperUI(s.clipboardUpperEnabled !== false))

clipboardUpperToggleBtn.onclick = async () => {
    const s = await api.getSettings()
    const current = s.clipboardUpperEnabled !== false
    const next = !current
    try {
        await api.saveSettings({ ...s, clipboardUpperEnabled: next })
        updateClipboardUpperUI(next)
        showToast(`Büyük harf yapıştırma özelliği ${next ? 'etkinle\u015ftirildi' : 'devre d\u0131\u015f\u0131 b\u0131rak\u0131ld\u0131'}.`, 'info')
    } catch (e: any) {
        showToast('Büyük harf yapıştırma ayarı değiştirilemedi: ' + e.message, 'error')
    }
}

//
api.onServerStatusUpdate((status: { online: boolean; latency: number }) => {
    statusDot.className = 'status-dot ' + (status.online ? (status.latency > 1000 ? 'slow' : 'online') : 'offline')
    statusInfo.textContent = status.online ? `Sunucu: ${status.latency}ms` : 'Sunucu: Eri\u015filemiyor'
    statusRefreshBtn.classList.remove('rotating')
})

statusRefreshBtn.addEventListener('click', () => {
    statusRefreshBtn.classList.add('rotating')
    api.manualServerStatusRefresh()
})

api.onCacheCleared(() => loadCards())

api.onMonitoringToggled((enabled: boolean) => {
    monitoringEnabled = enabled
    const span = toggleBtn.querySelector('span')
    if (span) {
        span.textContent = monitoringEnabled ? '\u{1F4CB} Clipboard \u0130zleme: Aktif' : '\u{1F4CB} Clipboard \u0130zleme: Devre D\u0131\u015f\u0131'
    }
    toggleBtn.style.opacity = monitoringEnabled ? '1' : '0.6'
})

//

//
api.onPriorityDeviceMatch((device: any) => {
    const alertDiv = document.createElement('div')
    alertDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        background: #ef4444;
        color: white;
        padding: 16px 24px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(239, 68, 68, 0.4);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 300px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        animation: slideDownIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
    `

    alertDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:1.1rem;">&#9888;&#65039; ÖNCELİKLİ CİHAZ!</strong>
            <button id="close-priority-alert" style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer; padding:0 4px;">&#10005;</button>
        </div>
        <div style="font-size:0.95rem; font-weight:600;">${escapeHtml(device.customer_name)}</div>
        <div style="font-size:0.85rem; opacity:0.9; background:rgba(0,0,0,0.1); padding:8px; border-radius:8px;">${escapeHtml(device.description)}</div>
        <div style="margin-top: 8px; display: flex; justify-content: flex-end;">
            <button id="delete-priority-bound" style="background: rgba(239, 68, 68, 0.5); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;">Sistemden Sil</button>
        </div>
    `

    if (!document.getElementById('priority-animations')) {
        const style = document.createElement('style')
        style.id = 'priority-animations'
        style.textContent = `
            @keyframes slideDownIn {
                from { opacity: 0; transform: translate(-50%, -40px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            #delete-priority-bound:hover { background: #dc2626 !important; transform: scale(1.05); }
        `
        document.head.appendChild(style)
    }

    document.body.appendChild(alertDiv)

    const closeBtn = alertDiv.querySelector('#close-priority-alert') as HTMLElement
    closeBtn.onclick = () => alertDiv.remove()

    const deleteBtn = alertDiv.querySelector('#delete-priority-bound') as HTMLElement
    deleteBtn.onclick = async () => {
        const confirmed = await showConfirm(
            'Sistemden Kalıcı Olarak Sil',
            `${device.customer_name} cihazı işleme alındı olarak işaretlenecek ve listeden kalkacaktır. Emin misiniz?`,
            'Evet, Sil'
        )
        if (confirmed) {
            await api.deletePriorityDevice(device.id)
            if (alertDiv.parentNode) alertDiv.remove()
            loadPriorityDevices()
            showToast('Cihaz sistemden kalıcı olarak silindi.', 'success')
        }
    }
})

//
const { loadPriorityDevices, focusPriorityDevice } = initPriorityLogic(api, {
    prioList, addPrioBtn, pSerial, pCustomer, pDesc
})

const { loadSettingsToUI } = initSettingsLogic(api, {
    sPersonnelName, sUserRole, sShortcutModelCopy, sShortcutClear, sShortcutMonitoring,
    sPopupSize, sPopupTimeout, sAutoStart, sPreventDuplicate, sLogoutBtn,
    sClipboardUpper
}, refreshSidebarProfile)

// Global window function for deletion
;(window as any).deletePriority = async (id: string) => {
    const confirmed = await showConfirm(
        'Öncelikli Cihazı Sil',
        'Bu cihazı öncelikli listeden silmek istediğinize emin misiniz?',
        'Evet, Sil'
    )
    if (confirmed) {
        await api.deletePriorityDevice(id)
        loadPriorityDevices()
        showToast('Cihaz ba\u015far\u0131yla silindi.', 'success')
    }
}

//
Promise.all([
    api.getSettings(),
    api.getUsers().catch(() => [])
]).then(([s]: [any, any[]]) => {
    currentRole = s.role || 'kargo_kabul'
    personnelName = s.personnelName || ''
    
    const isAdmin = s.isAdmin === true || s.username === 'KursatS'

    // Sidebar role-based items
    const sideAdmin = document.getElementById('side-admin-btn')
    const sideDeviceCallBtn = document.getElementById('side-device-call-btn')

    if (sideDeviceCallBtn) sideDeviceCallBtn.style.display = currentRole === 'kargo_kabul' ? 'flex' : 'none'
    if (sideAdmin) sideAdmin.style.display = isAdmin ? 'flex' : 'none'
    
    refreshSidebarProfile()
    loadCards()
})

api.onRefreshCards(() => {
    api.getSettings().then((s: any) => {
        currentRole = s.role || 'kargo_kabul'
        personnelName = s.personnelName || ''
        
        const isAdmin = s.isAdmin === true || s.username === 'KursatS'
        const sideAdmin = document.getElementById('side-admin-btn')
        const sideDeviceCallBtn = document.getElementById('side-device-call-btn')

        if (sideDeviceCallBtn) sideDeviceCallBtn.style.display = s.role === 'kargo_kabul' ? 'flex' : 'none'
        if (sideAdmin) sideAdmin.style.display = isAdmin ? 'flex' : 'none'

        refreshSidebarProfile()
        loadCards()
    })
})

api.onFocusPriorityDevice((device: any) => {
    switchView('priority')
    loadPriorityDevices().then(() => {
        focusPriorityDevice(device)
    })
})

api.onPriorityDevicesUpdate(() => {
    loadPriorityDevices()
})

initZReportLogic(api, {
    zreportDropZone,
    zreportFileInput,
    zreportResults,
    zreportAnalytics
})

const { loadAdminUsers } = initAdminLogic(api, {
    adminUserList, btnAddUser, adminModal, adminModalTitle,
    adminUserId, adminUsername, adminPassword, adminFullname,
    adminRole, btnCancelAdminModal, btnSaveAdminUser
}, undefined as any)

//
;(function setupAutoUpdater() {
    const bar = document.createElement('div')
    bar.id = 'update-bar'
    bar.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-top:1px solid #38bdf8;padding:12px 24px;align-items:center;gap:14px;font-size:0.9rem;color:#f8fafc;box-shadow:0 -4px 24px rgba(0,0,0,0.5);'
    bar.innerHTML = `
        <span id="update-msg" style="font-weight:600;flex:1;">📢 Yeni sürüm mevcut!</span>
        <div id="update-progress-wrap" style="display:none;flex:1;max-width:200px;height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;">
            <div id="update-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#38bdf8,#0284c7);border-radius:4px;transition:width 0.3s;"></div>
        </div>
        <button id="update-action-btn" style="padding:8px 20px;border:none;border-radius:10px;background:linear-gradient(135deg,#38bdf8,#0284c7);color:#ffffff;cursor:pointer;font-size:0.85rem;font-weight:700;box-shadow:0 0 12px rgba(56,189,248,0.4);transition:all 0.2s;">İndir</button>
        <button id="update-dismiss-btn" style="padding:6px 10px;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:1.2rem;line-height:1;">&#10005;</button>
    `
    document.body.appendChild(bar)

    const updateMsg = document.getElementById('update-msg')!
    const progressWrap = document.getElementById('update-progress-wrap')!
    const progressBar = document.getElementById('update-progress-bar')!
    const actionBtn = document.getElementById('update-action-btn') as HTMLButtonElement
    const dismissBtn = document.getElementById('update-dismiss-btn')!

    const btnCheckUpdate = document.getElementById('btn-check-update') as HTMLButtonElement | null
    const updateCheckStatus = document.getElementById('update-check-status') as HTMLDivElement | null

    let updateState: 'idle' | 'available' | 'downloading' | 'ready' = 'idle'

    api.onUpdateAvailable((version: string) => {
        updateState = 'available'
        updateMsg.textContent = `📢 Yeni sürüm mevcut: v${version}`
        bar.style.display = 'flex'
        actionBtn.textContent = '⚡ İndir'
        actionBtn.disabled = false
        actionBtn.style.opacity = '1'
        actionBtn.style.background = 'linear-gradient(135deg,#38bdf8,#0284c7)'
        actionBtn.style.color = '#ffffff'
        actionBtn.style.boxShadow = '0 0 12px rgba(56,189,248,0.4)'
        actionBtn.style.cursor = 'pointer'

        if (updateCheckStatus) {
            updateCheckStatus.style.color = '#38bdf8'
            updateCheckStatus.textContent = `📢 Yeni sürüm bulundu: v${version}`
        }
        if (btnCheckUpdate) {
            btnCheckUpdate.textContent = '🔄 Tekrar Denetle'
            btnCheckUpdate.disabled = false
        }
    })

    api.onUpdateNotAvailable(() => {
        if (updateCheckStatus) {
            updateCheckStatus.style.color = '#4ade80'
            updateCheckStatus.textContent = '✓ Harika! En güncel sürümü kullanıyorsunuz.'
        }
        if (btnCheckUpdate) {
            btnCheckUpdate.textContent = '🔍 Güncellemeleri Kontrol Et'
            btnCheckUpdate.disabled = false
        }
    })

    api.onUpdateError((err: string) => {
        if (updateCheckStatus) {
            updateCheckStatus.style.color = '#f87171'
            updateCheckStatus.textContent = `⚠️ Kontrol hatası: ${err}`
        }
        // If error fires during download, restore the download button
        if (updateState === 'downloading') {
            updateState = 'available'
            actionBtn.textContent = '⚡ İndir'
            actionBtn.disabled = false
            actionBtn.style.opacity = '1'
            actionBtn.style.background = 'linear-gradient(135deg,#38bdf8,#0284c7)'
            actionBtn.style.boxShadow = '0 0 12px rgba(56,189,248,0.4)'
            actionBtn.style.cursor = 'pointer'
        }
        if (btnCheckUpdate) {
            btnCheckUpdate.textContent = '🔍 Güncellemeleri Kontrol Et'
            btnCheckUpdate.disabled = false
        }
    })

    api.onUpdateProgress((percent: number) => {
        progressWrap.style.display = 'block'
        progressBar.style.width = `${percent}%`
        updateMsg.textContent = `⏬ İndiriliyor... %${percent}`
    })

    api.onUpdateDownloaded(() => {
        updateState = 'ready'
        progressWrap.style.display = 'none'
        updateMsg.textContent = '✓ Güncelleme hazır! Uygulamayı yeniden başlatıp yükleyin.'
        actionBtn.textContent = '🚀 Şimdi Güncelle'
        actionBtn.disabled = false
        actionBtn.style.opacity = '1'
        actionBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
        actionBtn.style.color = '#ffffff'
        actionBtn.style.fontWeight = '800'
        actionBtn.style.boxShadow = '0 0 16px rgba(34, 197, 94, 0.6)'
        actionBtn.style.cursor = 'pointer'
    })

    actionBtn.onclick = () => {
        if (updateState === 'available' || updateState === 'idle') {
            updateState = 'downloading'
            actionBtn.textContent = '⏳ İndiriliyor...'
            actionBtn.style.opacity = '0.7'
            actionBtn.disabled = true
            api.startUpdateDownload()
        } else if (updateState === 'ready') {
            actionBtn.textContent = 'Yükleniyor...'
            actionBtn.disabled = true
            api.installUpdate()
        }
    }

    dismissBtn.onclick = () => {
        bar.style.display = 'none'
    }

    if (btnCheckUpdate) {
        btnCheckUpdate.onclick = async () => {
            btnCheckUpdate.disabled = true
            btnCheckUpdate.textContent = '⏳ Kontrol Ediliyor...'
            if (updateCheckStatus) {
                updateCheckStatus.style.color = '#94a3b8'
                updateCheckStatus.textContent = 'GitHub sunucularına bağlanılıyor...'
            }
            try {
                const res = await api.checkForUpdates()
                if (res && res.updateInfo && res.updateInfo.version) {
                    updateState = 'available'
                    updateMsg.textContent = `📢 Yeni sürüm mevcut: v${res.updateInfo.version}`
                    bar.style.display = 'flex'
                    actionBtn.textContent = '⚡ İndir'
                    actionBtn.disabled = false
                    actionBtn.style.opacity = '1'
                    actionBtn.style.background = 'linear-gradient(135deg,#38bdf8,#0284c7)'
                    actionBtn.style.color = '#ffffff'
                    actionBtn.style.boxShadow = '0 0 12px rgba(56,189,248,0.4)'
                    actionBtn.style.cursor = 'pointer'

                    if (updateCheckStatus) {
                        updateCheckStatus.style.color = '#38bdf8'
                        updateCheckStatus.textContent = `📢 Yeni sürüm bulundu: v${res.updateInfo.version}`
                    }
                    btnCheckUpdate.textContent = '🔄 Tekrar Denetle'
                }
            } catch (e: any) {
                if (updateCheckStatus) {
                    updateCheckStatus.style.color = '#f87171'
                    updateCheckStatus.textContent = '⚠️ Güncelleme kontrolü başlatılamadı.'
                }
                btnCheckUpdate.textContent = '🔍 Güncellemeleri Kontrol Et'
            } finally {
                btnCheckUpdate.disabled = false
                if (btnCheckUpdate.textContent === '⏳ Kontrol Ediliyor...') {
                    btnCheckUpdate.textContent = '🔍 Güncellemeleri Kontrol Et'
                }
            }
        }
    }
})()

// ── Device Call System ────────────────────────────────────────────────
const deviceCallController = initDeviceCallLogic(api, {
    dcallHistoryList,
    dcallSearchInput,
    dcallStatusFilter,
    btnOpenModal: btnOpenDeviceCallModal,
    deviceCallModal,
    dcallSerial,
    dcallModel,
    dcallCustomer,
    btnCancelModal: btnCancelDeviceCall,
    btnSendModal: btnSendDeviceCall
})

api.onDeviceCallsUpdate((calls: any[]) => {
    deviceCallController.updateData(calls, personnelName)
})

