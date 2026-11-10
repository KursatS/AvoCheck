using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;

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

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalFree(IntPtr hMem);

        [DllImport("user32.dll")]
        private static extern int ToUnicode(uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags);

        [DllImport("user32.dll")]
        private static extern bool GetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const ushort VK_BACK = 0x08;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12;
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

            // Safely initialize stream readers/writers without crashing on invalid console handles
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
                using (var curProcess = Process.GetCurrentProcess())
                using (var curModule = curProcess.MainModule)
                {
                    return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
                }
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
                    if (json.Contains("\"enabled\":false")) _globalEnabled = false;
                    else if (json.Contains("\"enabled\":true")) _globalEnabled = true;

                    var newSnippets = new List<SnippetItem>();
                    int idx = json.IndexOf("\"snippets\":");
                    if (idx != -1)
                    {
                        int startArr = json.IndexOf('[', idx);
                        int endArr = json.LastIndexOf(']');
                        if (startArr != -1 && endArr > startArr)
                        {
                            string arrContent = json.Substring(startArr + 1, endArr - startArr - 1);
                            int itemStart = 0;
                            while ((itemStart = arrContent.IndexOf('{', itemStart)) != -1)
                            {
                                int itemEnd = arrContent.IndexOf('}', itemStart);
                                if (itemEnd == -1) break;
                                string itemJson = arrContent.Substring(itemStart, itemEnd - itemStart + 1);

                                string id = ExtractJsonVal(itemJson, "id");
                                string pfx = ExtractJsonVal(itemJson, "prefix");
                                string trg = ExtractJsonVal(itemJson, "trigger");
                                string rep = ExtractJsonVal(itemJson, "replacement");
                                bool en = !itemJson.Contains("\"enabled\":false");

                                if (!string.IsNullOrEmpty(trg) && !string.IsNullOrEmpty(rep))
                                {
                                    newSnippets.Add(new SnippetItem
                                    {
                                        id = id,
                                        prefix = pfx ?? ":",
                                        trigger = trg,
                                        replacement = rep,
                                        enabled = en
                                    });
                                }
                                itemStart = itemEnd + 1;
                            }
                        }
                    }
                    _snippets = newSnippets;
                    WriteLine("{\"status\":\"CONFIG_APPLIED\",\"count\":" + _snippets.Count + "}");
                }
                catch (Exception ex)
                {
                    WriteError("Parse error: " + ex.Message);
                }
            }
        }

        private static string ExtractJsonVal(string json, string key)
        {
            string pattern = "\"" + key + "\":\"";
            int start = json.IndexOf(pattern);
            if (start == -1) return null;
            start += pattern.Length;
            StringBuilder sb = new StringBuilder();
            bool esc = false;
            for (int i = start; i < json.Length; i++)
            {
                char c = json[i];
                if (esc)
                {
                    if (c == 'n') sb.Append('\n');
                    else if (c == 'r') sb.Append('\r');
                    else if (c == 't') sb.Append('\t');
                    else if (c == '"') sb.Append('"');
                    else if (c == '\\') sb.Append('\\');
                    else sb.Append(c);
                    esc = false;
                }
                else if (c == '\\')
                {
                    esc = true;
                }
                else if (c == '"')
                {
                    return sb.ToString();
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                if (!_isExpanding && _globalEnabled)
                {
                    int vkCode = Marshal.ReadInt32(lParam);
                    HandleKeyDown(vkCode);
                }
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

                if (_rollingBuffer.Length > 40)
                {
                    _rollingBuffer.Remove(0, _rollingBuffer.Length - 40);
                }

                string currentText = _rollingBuffer.ToString();

                foreach (var s in _snippets)
                {
                    if (!s.enabled) continue;
                    string fullTrigger = (s.prefix ?? "") + s.trigger;
                    if (string.IsNullOrEmpty(fullTrigger)) continue;

                    if (currentText.EndsWith(fullTrigger, StringComparison.OrdinalIgnoreCase))
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

            uint scanCode = MapVirtualKey(vk, 0);
            StringBuilder sb = new StringBuilder(10);
            int res = ToUnicode(vk, scanCode, keyState, sb, sb.Capacity, 0);
            if (res > 0)
            {
                return sb.ToString();
            }
            return null;
        }

        private static bool FastSetClipboard(string text)
        {
            if (text == null) text = "";

            // Retry briefly up to 5 times (2ms apart) in case another app temporarily holds clipboard
            for (int retry = 0; retry < 5; retry++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        EmptyClipboard();

                        // UTF-16 null-terminated bytes
                        byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
                        IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                        if (hGlobal == IntPtr.Zero)
                        {
                            return false;
                        }

                        IntPtr target = GlobalLock(hGlobal);
                        if (target == IntPtr.Zero)
                        {
                            GlobalFree(hGlobal);
                            return false;
                        }

                        Marshal.Copy(bytes, 0, target, bytes.Length);
                        GlobalUnlock(hGlobal);

                        if (SetClipboardData(CF_UNICODETEXT, hGlobal) == IntPtr.Zero)
                        {
                            GlobalFree(hGlobal);
                            return false;
                        }

                        // Windows clipboard now owns hGlobal
                        return true;
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(2);
            }
            return false;
        }

        private static void TriggerExpansion(int backspaceCount, string replacement, string triggerName)
        {
            _isExpanding = true;
            Thread pasteThread = new Thread(() =>
            {
                try
                {
                    // 1. Instantly set replacement text to Windows Clipboard via raw Win32 (< 1ms)
                    bool clipOk = FastSetClipboard(replacement);
                    if (!clipOk)
                    {
                        // Fallback to WinForms Clipboard if Win32 lock failed
                        try { Clipboard.SetDataObject(replacement, true); } catch { }
                    }

                    // 2. Batch Send Backspaces atomically via SendInput (0ms latency, zero visible deletion)
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

                    // Micro-pause (5ms) to ensure target app window processes caret position before paste
                    Thread.Sleep(5);

                    // 3. Check if Shift is physically held down by user (e.g. typing a symbol trigger)
                    bool shiftWasDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;

                    var pasteList = new List<INPUT>();

                    // If Shift is down, release it temporarily so Ctrl+V doesn't become Ctrl+Shift+V
                    if (shiftWasDown)
                    {
                        INPUT shiftUp = new INPUT();
                        shiftUp.type = INPUT_KEYBOARD;
                        shiftUp.u.ki.wVk = VK_SHIFT;
                        shiftUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                        pasteList.Add(shiftUp);
                    }

                    // Ctrl Down
                    INPUT ctrlDown = new INPUT();
                    ctrlDown.type = INPUT_KEYBOARD;
                    ctrlDown.u.ki.wVk = VK_CONTROL;
                    ctrlDown.u.ki.dwFlags = 0;
                    pasteList.Add(ctrlDown);

                    // V Down
                    INPUT vDown = new INPUT();
                    vDown.type = INPUT_KEYBOARD;
                    vDown.u.ki.wVk = VK_V;
                    vDown.u.ki.dwFlags = 0;
                    pasteList.Add(vDown);

                    // V Up
                    INPUT vUp = new INPUT();
                    vUp.type = INPUT_KEYBOARD;
                    vUp.u.ki.wVk = VK_V;
                    vUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                    pasteList.Add(vUp);

                    // Ctrl Up
                    INPUT ctrlUp = new INPUT();
                    ctrlUp.type = INPUT_KEYBOARD;
                    ctrlUp.u.ki.wVk = VK_CONTROL;
                    ctrlUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
                    pasteList.Add(ctrlUp);

                    // Restore Shift if user is still holding it
                    if (shiftWasDown && ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0))
                    {
                        INPUT shiftDown = new INPUT();
                        shiftDown.type = INPUT_KEYBOARD;
                        shiftDown.u.ki.wVk = VK_SHIFT;
                        shiftDown.u.ki.dwFlags = 0;
                        pasteList.Add(shiftDown);
                    }

                    INPUT[] pasteInputs = pasteList.ToArray();
                    SendInput((uint)pasteInputs.Length, pasteInputs, Marshal.SizeOf(typeof(INPUT)));

                    WriteLine("{\"event\":\"EXPANDED\",\"trigger\":\"" + triggerName + "\"}");
                }
                catch (Exception ex)
                {
                    WriteError("Expand error: " + ex.Message);
                }
                finally
                {
                    Thread.Sleep(15);
                    _isExpanding = false;
                }
            });
            pasteThread.SetApartmentState(ApartmentState.STA);
            pasteThread.IsBackground = true;
            pasteThread.Start();
        }
    }
}
