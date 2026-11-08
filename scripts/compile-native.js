const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function compileNative() {
    const csPath = path.join(__dirname, '..', 'src', 'native', 'TextExpander.cs');
    const resDir = path.join(__dirname, '..', 'resources');
    const outPath = path.join(resDir, 'TextExpander.exe');

    if (!fs.existsSync(csPath)) {
        console.error('[compile-native] TextExpander.cs not found at:', csPath);
        return;
    }

    if (!fs.existsSync(resDir)) {
        fs.mkdirSync(resDir, { recursive: true });
    }

    const cscCandidates = [
        'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
        'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    ];

    const cscPath = cscCandidates.find(p => fs.existsSync(p));
    if (!cscPath) {
        console.warn('[compile-native] csc.exe not found on system. Checking if existing binary exists...');
        if (fs.existsSync(outPath)) {
            console.log('[compile-native] Using existing precompiled TextExpander.exe.');
            return;
        }
        console.error('[compile-native] Cannot compile TextExpander.cs: no csc compiler.');
        return;
    }

    console.log('[compile-native] Compiling TextExpander.cs with:', cscPath);
    execSync(`"${cscPath}" /nologo /target:winexe /out:"${outPath}" "${csPath}"`, { stdio: 'inherit' });
    console.log('[compile-native] TextExpander.exe compiled successfully to:', outPath);
}

compileNative();
