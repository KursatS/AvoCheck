import { clipboard } from 'electron';
import { isSerialNumber } from './serialDetector';

// Standard Windows marker: content flagged with this format must be ignored by clipboard monitors.
// TextExpander.exe sets it on snippet text and on the restored original clipboard,
// so an expansion never triggers a duplicate warranty lookup.
const EXCLUDE_MONITOR_FORMAT = 'ExcludeClipboardContentFromMonitorProcessing';

function isMarkedToIgnore(): boolean {
    try {
        return clipboard.readBuffer(EXCLUDE_MONITOR_FORMAT).length > 0;
    } catch {
        return false;
    }
}

export class ClipboardMonitor {
    private lastClipboard: string = '';
    private interval: NodeJS.Timeout | null = null;
    private isEnabled: boolean = true;

    constructor(private onDetected: (serial: string) => void) { }

    start(intervalMs: number = 800) {
        if (this.interval) return;

        this.interval = setInterval(() => {
            if (!this.isEnabled) return;
            if (isMarkedToIgnore()) return;

            const text = clipboard.readText().trim();
            if (!text || text === this.lastClipboard) return;
            this.lastClipboard = text;

            if (isSerialNumber(text)) {
                this.onDetected(text);
            }
        }, intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
    }
}
