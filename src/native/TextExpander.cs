using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;
using System.Globalization;
using System.Web.Script.Serialization;

namespace RecciTekTextExpander
{
    public class SnippetItem
    {
        public string id { get; set; }
        public string prefix { get; set; }
        public string trigger { get; set; }
        public string replacement { get; set; }
        public bool enabled { get; set; }
    }

    public class ExpanderConfig
    {
        public bool enabled { get; set; }
        public List<SnippetItem> snippets { get; set; }
    }

    class Program
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        private static LowLevelKeyboardProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;

        private static readonly object _lock = new object();
        private static List<SnippetItem> _snippets = new List<SnippetItem>();
        private static bool _globalEnabled = true;
        private static StringBuilder _rollingBuffer = new StringBuilder();
        private static bool _isExpanding = false;

        private static TextReader _stdinReader;
        private static TextWriter _stdoutWriter;
        private static TextWriter _stderrWriter;

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(IntPtr lpModuleName);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool OpenClipboard(IntPtr hWndNewOwner);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EmptyClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr GetClipboardData(uint uFormat);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalFree(IntPtr hMem);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint RegisterClipboardFormat(string lpszFormat);

        [DllImport("user32.dll")]
        private static extern uint GetClipboardSequenceNumber();

        [DllImport("user32.dll")]
        private static extern int ToUnicode(uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags);

        [DllImport("user32.dll")]
        private static extern int ToUnicodeEx(uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl);

        [DllImport("user32.dll")]
        private static extern bool GetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern short GetKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetKeyboardLayout(uint idThread);

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const ushort VK_BACK = 0x08;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12;
        private const ushort VK_CAPITAL = 0x14;
        private const ushort VK_V = 0x56;

        private const uint CF_UNICODETEXT = 13;
        private const uint GMEM_MOVEABLE = 0x0002;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [STAThread]
        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                WriteError("Unhandled: " + (e.ExceptionObject != null ? e.ExceptionObject.ToString() : "Unknown"));
            };

            try
            {
                _stdinReader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
            }
            catch
            {
                _stdinReader = Console.In;
            }

            try
            {
                _stdoutWriter = new StreamWriter(Console.OpenStandardOutput(), Encoding.UTF8) { AutoFlush = true };
            }
            catch
            {
                _stdoutWriter = Console.Out;
            }

            try
            {
                _stderrWriter = new StreamWriter(Console.OpenStandardError(), Encoding.UTF8) { AutoFlush = true };
            }
            catch
            {
                _stderrWriter = Console.Error;
            }

            try
            {
                Console.OutputEncoding = Encoding.UTF8;
                Console.InputEncoding = Encoding.UTF8;
            }
            catch { }

            Thread stdinThread = new Thread(ReadStdinLoop);
            stdinThread.IsBackground = true;
            stdinThread.Start();

            _hookID = SetHook(_proc);
            WriteLine("{\"status\":\"READY\"}");

            Application.Run();

            if (_hookID != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookID);
            }
        }

        private static void WriteLine(string msg)
        {
            try
            {
                if (_stdoutWriter != null)
                {
                    _stdoutWriter.WriteLine(msg);
                    _stdoutWriter.Flush();
                }
            }
            catch { }
        }

        private static void WriteError(string msg)
        {
            try
            {
                if (_stderrWriter != null)
                {
                    _stderrWriter.WriteLine(msg);
                    _stderrWriter.Flush();
                }
            }
            catch { }
        }

        private static IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            try
            {
                IntPtr hMod = GetModuleHandle(IntPtr.Zero);
                if (hMod == IntPtr.Zero)
                {
                    using (var curProcess = Process.GetCurrentProcess())
                    using (var curModule = curProcess.MainModule)
                    {
                        hMod = GetModuleHandle(curModule.ModuleName);
                    }
                }
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, hMod, 0);
            }
            catch (Exception ex)
            {
                WriteError("SetHook error: " + ex.Message);
                return IntPtr.Zero;
            }
        }

        private static void ReadStdinLoop()
        {
            try
            {
                string line;
                while (_stdinReader != null && (line = _stdinReader.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line)) continue;

                    if (line.StartsWith("QUIT", StringComparison.OrdinalIgnoreCase))
                    {
                        Application.Exit();
                        break;
                    }

                    ParseConfig(line);
                }
            }
            catch (Exception ex)
            {
                WriteError("Stdin error: " + ex.Message);
            }
        }

        private static void ParseConfig(string json)
        {
            lock (_lock)
            {
                try
                {
                    var jss = new JavaScriptSerializer();
                    var cfg = jss.Deserialize<ExpanderConfig>(json);
                    if (cfg != null)
                    {
                        _globalEnabled = cfg.enabled;
                        _snippets = cfg.snippets ?? new List<SnippetItem>();
                        WriteLine("{\"status\":\"CONFIG_APPLIED\",\"count\":" + _snippets.Count + ",\"globalEnabled\":" + (_globalEnabled ? "true" : "false") + "}");
                    }
                }
                catch (Exception ex)
                {
                    WriteError("Parse error: " + ex.Message);
                }
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
                {
                    if (!_isExpanding && _globalEnabled)
                    {
                        int vkCode = Marshal.ReadInt32(lParam);
                        HandleKeyDown(vkCode);
                    }
                }
            }
            catch (Exception ex)
            {
                WriteError("HookCallback error: " + ex.Message);
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        private static void HandleKeyDown(int vkCode)
        {
            lock (_lock)
            {
                if (vkCode == (int)VK_BACK)
                {
                    if (_rollingBuffer.Length > 0)
                    {
                        _rollingBuffer.Remove(_rollingBuffer.Length - 1, 1);
                    }
                    return;
                }

                if (vkCode == 0x0D || vkCode == 0x1B || vkCode == 0x09 ||
                    (vkCode >= 0x25 && vkCode <= 0x28))
                {
                    _rollingBuffer.Clear();
                    return;
                }

                string typed = GetCharFromVk((uint)vkCode);
                if (string.IsNullOrEmpty(typed)) return;

                _rollingBuffer.Append(typed);

                if (_rollingBuffer.Length > 50)
                {
                    _rollingBuffer.Remove(0, _rollingBuffer.Length - 50);
                }

                string currentText = _rollingBuffer.ToString();

                foreach (var s in _snippets)
                {
                    if (!s.enabled) continue;
                    string fullTrigger = (s.prefix ?? "") + s.trigger;
                    if (string.IsNullOrEmpty(fullTrigger)) continue;

                    bool matched = currentText.EndsWith(fullTrigger, StringComparison.CurrentCultureIgnoreCase) ||
                                   currentText.EndsWith(fullTrigger, StringComparison.InvariantCultureIgnoreCase) ||
                                   currentText.EndsWith(fullTrigger, StringComparison.OrdinalIgnoreCase);

                    if (matched)
                    {
                        _rollingBuffer.Clear();
                        TriggerExpansion(fullTrigger.Length, s.replacement, s.trigger);
                        break;
                    }
                }
            }
        }

        private static string GetCharFromVk(uint vk)
        {
            byte[] keyState = new byte[256];
            GetKeyboardState(keyState);

            if ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0) keyState[VK_SHIFT] = 0x80;
            if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) keyState[VK_CONTROL] = 0x80;
            if ((GetAsyncKeyState(VK_MENU) & 0x8000) != 0) keyState[VK_MENU] = 0x80;

            if ((GetKeyState(VK_CAPITAL) & 1) != 0) keyState[VK_CAPITAL] = 0x01;
            else keyState[VK_CAPITAL] = 0x00;

            uint scanCode = MapVirtualKey(vk, 0);
            StringBuilder sb = new StringBuilder(10);

            IntPtr fgWnd = GetForegroundWindow();
            uint fgThread = fgWnd != IntPtr.Zero ? GetWindowThreadProcessId(fgWnd, IntPtr.Zero) : 0;
            IntPtr layout = fgThread != 0 ? GetKeyboardLayout(fgThread) : IntPtr.Zero;

            int res = 0;
            if (layout != IntPtr.Zero)
            {
                res = ToUnicodeEx(vk, scanCode, keyState, sb, sb.Capacity, 0, layout);
            }
            else
            {
                res = ToUnicode(vk, scanCode, keyState, sb, sb.Capacity, 0);
            }

            if (res > 0)
            {
                return sb.ToString();
            }
            return null;
        }

        // ---------------------------------------------------------------
        // Clipboard snapshot / restore
        // ---------------------------------------------------------------
        private const int RESTORE_DELAY_MS = 500;

        private static readonly uint CF_EXCLUDE_MONITOR = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
        private static readonly uint CF_HISTORY = RegisterClipboardFormat("CanIncludeInClipboardHistory");
        private static readonly uint CF_CLOUD = RegisterClipboardFormat("CanUploadToCloudClipboard");

        private static readonly object _restoreLock = new object();
        private static string _pendingTextSnapshot = null;
        private static int _restoreGeneration = 0;

        private static bool OpenClipboardWithRetry()
        {
            for (int retry = 0; retry < 10; retry++)
            {
                if (OpenClipboard(IntPtr.Zero)) return true;
                Thread.Sleep(5);
            }
            return false;
        }

        private static bool PutClipboardBytes(uint fmt, byte[] data)
        {
            IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)Math.Max(data.Length, 1));
            if (hGlobal == IntPtr.Zero) return false;

            IntPtr target = GlobalLock(hGlobal);
            if (target == IntPtr.Zero)
            {
                GlobalFree(hGlobal);
                return false;
            }
            if (data.Length > 0) Marshal.Copy(data, 0, target, data.Length);
            GlobalUnlock(hGlobal);

            if (SetClipboardData(fmt, hGlobal) == IntPtr.Zero)
            {
                GlobalFree(hGlobal);
                return false;
            }
            return true;
        }

        private static void PutIgnoreMarkers()
        {
            if (CF_EXCLUDE_MONITOR != 0) PutClipboardBytes(CF_EXCLUDE_MONITOR, BitConverter.GetBytes(1));
            if (CF_HISTORY != 0) PutClipboardBytes(CF_HISTORY, BitConverter.GetBytes(0));
            if (CF_CLOUD != 0) PutClipboardBytes(CF_CLOUD, BitConverter.GetBytes(0));
        }

        private static string SnapshotClipboardText()
        {
            if (!OpenClipboardWithRetry()) return null;
            try
            {
                IntPtr h = GetClipboardData(CF_UNICODETEXT);
                if (h == IntPtr.Zero) return null;
                return Marshal.PtrToStringUni(h);
            }
            catch
            {
                return null;
            }
            finally
            {
                CloseClipboard();
            }
        }

        private static void RestoreClipboardText(string originalText)
        {
            if (originalText == null) return;
            if (!OpenClipboardWithRetry()) return;
            try
            {
                EmptyClipboard();
                PutClipboardBytes(CF_UNICODETEXT, Encoding.Unicode.GetBytes(originalText + "\0"));
            }
            catch (Exception ex)
            {
                WriteError("Restore error: " + ex.Message);
            }
            finally
            {
                CloseClipboard();
            }
        }

        private static bool FastSetClipboard(string text)
        {
            if (text == null) text = "";
            if (!OpenClipboardWithRetry()) return false;
            try
            {
                EmptyClipboard();
                bool ok = PutClipboardBytes(CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\0"));
                PutIgnoreMarkers();
                return ok;
            }
            finally
            {
                CloseClipboard();
            }
        }

        private static void TriggerExpansion(int backspaceCount, string replacement, string triggerName)
        {
            _isExpanding = true;
            Thread pasteThread = new Thread(() =>
            {
                string snapshot = null;
                int generation = 0;
                uint seqAfterSet = 0;
                try
                {
                    // 0. Save what the user had copied before expansion
                    lock (_restoreLock)
                    {
                        if (_pendingTextSnapshot == null) _pendingTextSnapshot = SnapshotClipboardText();
                        snapshot = _pendingTextSnapshot;
                        generation = ++_restoreGeneration;
                    }

                    // 1. Set replacement text to Windows Clipboard via raw Win32 (< 1ms)
                    bool clipOk = FastSetClipboard(replacement);
                    if (!clipOk)
                    {
                        try { Clipboard.SetDataObject(replacement, true); } catch { }
                    }
                    seqAfterSet = GetClipboardSequenceNumber();

                    // 2. Batch Send Backspaces to remove typed trigger word
                    if (backspaceCount > 0)
                    {
                        INPUT[] bsInputs = new INPUT[backspaceCount * 2];
                        for (int i = 0; i < backspaceCount; i++)
                        {
                            bsInputs[i * 2].type = INPUT_KEYBOARD;
                            bsInputs[i * 2].u.ki.wVk = VK_BACK;
                            bsInputs[i * 2].u.ki.dwFlags = 0;

                            bsInputs[i * 2 + 1].type = INPUT_KEYBOARD;
                            bsInputs[i * 2 + 1].u.ki.wVk = VK_BACK;
                            bsInputs[i * 2 + 1].u.ki.dwFlags = KEYEVENTF_KEYUP;
                        }
                        SendInput((uint)bsInputs.Length, bsInputs, Marshal.SizeOf(typeof(INPUT)));
                    }

                    // Pause (25ms) to ensure target app window / editor caret processes deletion
                    Thread.Sleep(25);

                    // 3. Send Ctrl+V paste with verified key holding
                    bool shiftWasDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                    if (shiftWasDown)
                    {
                        INPUT shiftUp = new INPUT();
                        shiftUp.type = INPUT_KEYBOARD;
                        shiftUp.u.ki.wVk = VK_SHIFT;
                        shiftUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                        SendInput(1, new INPUT[] { shiftUp }, Marshal.SizeOf(typeof(INPUT)));
                    }

                    // Ctrl Down
                    INPUT ctrlDown = new INPUT();
                    ctrlDown.type = INPUT_KEYBOARD;
                    ctrlDown.u.ki.wVk = VK_CONTROL;
                    ctrlDown.u.ki.dwFlags = 0;
                    SendInput(1, new INPUT[] { ctrlDown }, Marshal.SizeOf(typeof(INPUT)));

                    Thread.Sleep(10); // Hold Ctrl down so target app registers modifier

                    // V Down & Up
                    INPUT vDown = new INPUT();
                    vDown.type = INPUT_KEYBOARD;
                    vDown.u.ki.wVk = VK_V;
                    vDown.u.ki.dwFlags = 0;

                    INPUT vUp = new INPUT();
                    vUp.type = INPUT_KEYBOARD;
                    vUp.u.ki.wVk = VK_V;
                    vUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                    SendInput(2, new INPUT[] { vDown, vUp }, Marshal.SizeOf(typeof(INPUT)));

                    Thread.Sleep(10);

                    // Ctrl Up
                    INPUT ctrlUp = new INPUT();
                    ctrlUp.type = INPUT_KEYBOARD;
                    ctrlUp.u.ki.wVk = VK_CONTROL;
                    ctrlUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                    SendInput(1, new INPUT[] { ctrlUp }, Marshal.SizeOf(typeof(INPUT)));

                    if (shiftWasDown && ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0))
                    {
                        INPUT shiftDown = new INPUT();
                        shiftDown.type = INPUT_KEYBOARD;
                        shiftDown.u.ki.wVk = VK_SHIFT;
                        shiftDown.u.ki.dwFlags = 0;
                        SendInput(1, new INPUT[] { shiftDown }, Marshal.SizeOf(typeof(INPUT)));
                    }

                    WriteLine("{\"event\":\"EXPANDED\",\"trigger\":\"" + triggerName + "\"}");
                }
                catch (Exception ex)
                {
                    WriteError("Expand error: " + ex.Message);
                }
                finally
                {
                    Thread.Sleep(40);
                    _isExpanding = false;
                }

                // 4. Put the user's original clipboard back once the target app has completed paste
                try
                {
                    Thread.Sleep(RESTORE_DELAY_MS);
                    lock (_restoreLock)
                    {
                        if (generation != _restoreGeneration) return;
                        _pendingTextSnapshot = null;
                    }

                    if (snapshot != null && GetClipboardSequenceNumber() == seqAfterSet)
                    {
                        RestoreClipboardText(snapshot);
                    }
                }
                catch (Exception ex)
                {
                    WriteError("Restore error: " + ex.Message);
                }
            });
            pasteThread.SetApartmentState(ApartmentState.STA);
            pasteThread.IsBackground = true;
            pasteThread.Start();
        }
    }
}
