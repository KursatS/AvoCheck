import { showToast } from './toastUtils'

export function initSettingsLogic(
    api: any,
    elements: any,
    refreshSidebarProfile: () => void
) {
    const {
        sPersonnelName, sUserRole, sShortcutModelCopy, sShortcutClear, sShortcutMonitoring,
        sPopupSize, sPopupTimeout, sAutoStart, sPreventDuplicate, sLogoutBtn,
        sClipboardUpper
    } = elements

    let initialRole = ''
    const logoutLabel = 'Oturumdan Çıkış Yap'

    async function loadSettingsToUI() {
        const s = await api.getSettings()

        sPersonnelName.value = (s.personnelName || '').toUpperCase()
        let displayRole = s.role
        if (displayRole === 'kargo_kabul') displayRole = 'Kargo Kabul'
        else if (displayRole === 'mh') displayRole = 'Müşteri Hizmetleri'
        else if (displayRole === 'admin') displayRole = 'Yönetici'
        sUserRole.value = displayRole || ''
        initialRole = s.role || ''

        sShortcutModelCopy.value = s.shortcuts?.copyModelColor || 'CommandOrControl+Shift+C'
        sShortcutClear.value = s.shortcuts?.clearCache || 'CommandOrControl+Shift+X'
        sShortcutMonitoring.value = s.shortcuts?.toggleMonitoring || 'CommandOrControl+Shift+M'

        sPopupSize.value = String(s.popupSizeLevel || 2)
        sPopupTimeout.value = String(s.popupTimeout || 5000)
        sAutoStart.checked = s.autoStartEnabled || false
        sPreventDuplicate.checked = s.preventDuplicatePopup || false
        sClipboardUpper.checked = s.clipboardUpperEnabled !== false

        if (sLogoutBtn) {
            sLogoutBtn.textContent = logoutLabel
        }
    }

    // Auto-save logic
    async function saveCurrentSettings() {
        const currentSettings = await api.getSettings()
        const settingsToSave = {
            ...currentSettings,
            personnelName: sPersonnelName.value.trim(),
            role: initialRole,
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
            refreshSidebarProfile()
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

    sPersonnelName.addEventListener('input', () => {
        const start = sPersonnelName.selectionStart
        const end = sPersonnelName.selectionEnd
        sPersonnelName.value = sPersonnelName.value.replace(/\s/g, '').toUpperCase()
        sPersonnelName.setSelectionRange(start, end)
        triggerAutoSave(500) // 500ms debounce
    })

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
                triggerAutoSave(0) // Save instantly on shortcut capture
            }
        }
    }

    setupShortcutRecorder(sShortcutModelCopy)
    setupShortcutRecorder(sShortcutClear)
    setupShortcutRecorder(sShortcutMonitoring)

    if (sLogoutBtn) {
        sLogoutBtn.onclick = async () => {
            const confirmed = await (window as any).showConfirm(
                'Oturumu Kapat',
                'Oturumdan çıkış yapmak istiyor musunuz?',
                'Çıkış Yap'
            )
            if (!confirmed) return

            try {
                await api.logout()
            } catch (e: any) {
                showToast('Oturum kapatılırken hata oluştu.', 'error')
            }
        }
    }

    return { loadSettingsToUI }
}
