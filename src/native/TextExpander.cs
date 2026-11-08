using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
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

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        private static extern int ToUnicode(uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags);

        [DllImport("user32.dll")]
        private static extern bool GetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        private const byte VK_BACK = 0x08;
        private const byte VK_SHIFT = 0x10;
        private const byte VK_CONTROL = 0x11;
        private const byte VK_MENU = 0x12;
        private const byte VK_V = 0x56;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        [STAThread]
        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            Thread stdinThread = new Thread(ReadStdinLoop);
            stdinThread.IsBackground = true;
            stdinThread.Start();

            _hookID = SetHook(_proc);
            Console.WriteLine("{\"status\":\"READY\"}");

            Application.Run();

            UnhookWindowsHookEx(_hookID);
        }

        private static IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
            using (var curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private static void ReadStdinLoop()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
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
                Console.Error.WriteLine("Stdin error: " + ex.Message);
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
                    Console.WriteLine("{\"status\":\"CONFIG_APPLIED\",\"count\":" + _snippets.Count + "}");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Parse error: " + ex.Message);
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

        private static void TriggerExpansion(int backspaceCount, string replacement, string triggerName)
        {
            _isExpanding = true;
            Thread pasteThread = new Thread(() =>
            {
                try
                {
                    for (int i = 0; i < backspaceCount; i++)
                    {
                        keybd_event(VK_BACK, 0, 0, UIntPtr.Zero);
                        keybd_event(VK_BACK, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                        Thread.Sleep(8);
                    }

                    Thread.Sleep(15);
                    for (int retry = 0; retry < 6; retry++)
                    {
                        try
                        {
                            Clipboard.SetDataObject(replacement, true);
                            break;
                        }
                        catch
                        {
                            Thread.Sleep(25);
                        }
                    }

                    Thread.Sleep(20);
                    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
                    keybd_event(VK_V, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(15);
                    keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

                    Console.WriteLine("{\"event\":\"EXPANDED\",\"trigger\":\"" + triggerName + "\"}");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Expand error: " + ex.Message);
                }
                finally
                {
                    Thread.Sleep(80);
                    _isExpanding = false;
                }
            });
            pasteThread.SetApartmentState(ApartmentState.STA);
            pasteThread.Start();
        }
    }
}
