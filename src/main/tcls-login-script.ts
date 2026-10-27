/** Static helper code. Credentials and paths are supplied separately over stdin. */
// Rendered label geometry adapted from shecong/LOL-GameAssistant; see THIRD-PARTY-NOTICES.txt.
export const TCLS_NATIVE_CODE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public sealed class RiftTclsWindow {
  public IntPtr Handle;
  public int Pid;
  public long Started;
  public string Path;
  public Rectangle Panel;
}
public sealed class RiftTclsProbe {
  public bool Verification;
  public bool Region;
  public AutomationElement Account, Password, Submit, Qq, PasswordMode;
}
public sealed class RiftTclsLabel {
  public string Text;
  public Rectangle Bounds;
}
public sealed class RiftTclsPlan {
  public bool ChooseQq;
  public Point Account, Password, Submit;
}
public static class RiftTclsDesktop {
  private static Process owner;
  public static void SetOwner(int pid) { owner = Process.GetProcessById(pid); }
  public static bool OwnerAlive() { try { return owner != null && !owner.HasExited; } catch { return false; } }
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] private struct KeyInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] private struct InputUnion {
    [FieldOffset(0)] public MouseInput Mouse;
    [FieldOffset(0)] public KeyInput Key;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Data; }
  private delegate bool EnumCallback(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int size);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr handle, out Rect rectangle);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr handle, ref Point point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  private static readonly string[] Verification = new[] {
    "请输入验证码", "安全验证", "滑动验证", "短信验证", "扫码验证", "人机验证", "账号或密码错误", "帐号或密码错误",
    "账号或密码不正确", "帐号或密码不正确", "密码错误", "登录失败", "登录异常", "账号被冻结", "帐号被冻结", "异地登录", "手机验证", "登录保护"
  };
  public static void InitializeDpi() {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
  }
  private static string Normalize(string text) {
    return new string((text ?? "").Where(c => !Char.IsWhiteSpace(c) && c != ':' && c != '：').ToArray());
  }
  private static bool ValidProcess(RiftTclsWindow window) {
    int pid; GetWindowThreadProcessId(window.Handle, out pid);
    if (pid != window.Pid) return false;
    try {
      using (var process = Process.GetProcessById(pid)) {
        return process.StartTime.ToUniversalTime().Ticks == window.Started &&
          String.Equals(process.MainModule.FileName, window.Path, StringComparison.OrdinalIgnoreCase);
      }
    } catch { return false; }
  }
  private static Rectangle Panel(IntPtr handle) {
    Rect rect; var point = Point.Empty;
    if (!GetClientRect(handle, out rect) || !ClientToScreen(handle, ref point)) throw new InvalidOperationException();
    int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
    // The rendered Tencent login panel sits at the right of the launcher.
    if (width < 800 || height < 450) return Rectangle.Empty;
    int left = width * 3 / 4;
    return new Rectangle(point.X + left, point.Y, width - left, height);
  }
  public static RiftTclsWindow[] FindWindows(string[] allowedPaths) {
    var windows = new List<RiftTclsWindow>();
    EnumWindows(delegate(IntPtr handle, IntPtr unused) {
      if (!IsWindowVisible(handle)) return true;
      var caption = new StringBuilder(512); GetWindowText(handle, caption, caption.Capacity);
      if (!caption.ToString().Contains("英雄联盟")) return true;
      int pid; GetWindowThreadProcessId(handle, out pid);
      try {
        using (var process = Process.GetProcessById(pid)) {
          string path = process.MainModule.FileName;
          if (!allowedPaths.Any(allowed => String.Equals(path, allowed, StringComparison.OrdinalIgnoreCase))) return true;
          windows.Add(new RiftTclsWindow { Handle = handle, Pid = pid, Started = process.StartTime.ToUniversalTime().Ticks, Path = path, Panel = Panel(handle) });
        }
      } catch { }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
  public static bool Foreground(RiftTclsWindow window) {
    return ValidProcess(window) && IsWindowVisible(window.Handle) && !IsIconic(window.Handle) &&
      GetAncestor(GetForegroundWindow(), 2) == window.Handle;
  }
  private static void Guard(RiftTclsWindow window) {
    if (!OwnerAlive() || !Foreground(window)) throw new InvalidOperationException();
  }
  private static void GuardPoint(RiftTclsWindow window, Point point) {
    Guard(window);
    if (window.Panel.IsEmpty || Panel(window.Handle) != window.Panel || !window.Panel.Contains(point) ||
      GetAncestor(WindowFromPoint(point), 2) != window.Handle) throw new InvalidOperationException();
  }
  public static bool NeedsVerification(IEnumerable<string> labels) {
    return labels.Any(label => {
      string text = Normalize(label);
      if (text == "验证码登录" || text == "短信验证码登录" || text == "使用验证码登录") return false;
      return text == "验证码" || Verification.Any(word => text.Contains(word));
    });
  }
  private static AutomationElement Unique(IEnumerable<AutomationElement> elements, params string[] names) {
    var matches = elements.Where(element => names.Contains(Normalize(element.Current.Name))).ToArray();
    return matches.Length == 1 ? matches[0] : null;
  }
  public static RiftTclsProbe Probe(RiftTclsWindow window) {
    var result = new RiftTclsProbe(); Guard(window);
    var root = AutomationElement.FromHandle(window.Handle);
    var found = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
    if (found.Count > 2000) return result;
    var edits = new List<AutomationElement>(); var actions = new List<AutomationElement>(); var labels = new List<string>();
    foreach (AutomationElement element in found) {
      var current = element.Current;
      if (!current.IsEnabled || current.IsOffscreen || current.ProcessId != window.Pid) continue;
      // Some providers expose field contents through Name: never read edit names or values.
      if (current.ControlType == ControlType.Edit) { edits.Add(element); continue; }
      labels.Add(current.Name);
      object pattern;
      if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add(element);
    }
    result.Verification = NeedsVerification(labels);
    var passwords = edits.Where(element => element.Current.IsPassword).ToArray();
    var accounts = edits.Where(element => !element.Current.IsPassword).ToArray();
    if (passwords.Length == 1 && accounts.Length == 1) {
      object accountValue, passwordValue;
      if (accounts[0].TryGetCurrentPattern(ValuePattern.Pattern, out accountValue) &&
        passwords[0].TryGetCurrentPattern(ValuePattern.Pattern, out passwordValue) &&
        !((ValuePattern)accountValue).Current.IsReadOnly && !((ValuePattern)passwordValue).Current.IsReadOnly) {
        result.Account = accounts[0]; result.Password = passwords[0];
        result.Submit = Unique(actions, "登录", "登錄", "登录游戏", "进入游戏", "QQ登录");
      }
    }
    if (edits.Count == 0 && Unique(actions, "微信登录") != null) result.Qq = Unique(actions, "QQ登录");
    result.PasswordMode = Unique(actions, "密码登录", "账号密码登录", "帐号密码登录", "使用密码登录");
    result.Region = passwords.Length == 0 && labels.Any(text => Normalize(text).Contains("选择大区") || Normalize(text).Contains("选择服务器"));
    return result;
  }
  public static void Invoke(RiftTclsWindow window, AutomationElement element) {
    Guard(window);
    if (element == null || element.Current.ProcessId != window.Pid) throw new InvalidOperationException();
    ((InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
  }
  public static void FillAccessible(RiftTclsWindow window, RiftTclsProbe form, string username, string password) {
    Guard(window); ((ValuePattern)form.Account.GetCurrentPattern(ValuePattern.Pattern)).SetValue(username);
    Guard(window); ((ValuePattern)form.Password.GetCurrentPattern(ValuePattern.Pattern)).SetValue(password);
    Invoke(window, form.Submit);
  }
  public static Bitmap CapturePanel(RiftTclsWindow window) {
    var rect = window.Panel;
    if (rect.IsEmpty) return null;
    foreach (var point in new[] { new Point(rect.Left + 2, rect.Top + 2), new Point(rect.Right - 3, rect.Top + 2),
      new Point(rect.Left + 2, rect.Bottom - 3), new Point(rect.Right - 3, rect.Bottom - 3), new Point(rect.Left + rect.Width / 2, rect.Top + rect.Height / 2) }) GuardPoint(window, point);
    var bitmap = new Bitmap(rect.Width, rect.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    try { using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(rect.Location, Point.Empty, rect.Size); return bitmap; }
    catch { bitmap.Dispose(); throw; }
  }
  private static RiftTclsLabel UniqueLabel(RiftTclsLabel[] labels, params string[] names) {
    var found = labels.Where(label => names.Contains(Normalize(label.Text))).ToArray();
    return found.Length == 1 ? found[0] : null;
  }
  public static RiftTclsPlan Plan(RiftTclsLabel[] labels, Size size) {
    var account = UniqueLabel(labels, "QQ账号", "QQ帐号");
    var password = UniqueLabel(labels, "QQ密码");
    var submit = UniqueLabel(labels, "进入游戏", "登录");
    if (account != null && password != null && submit != null) {
      int gap = password.Bounds.Top - account.Bounds.Top;
      if (gap < size.Height * .05 || gap > size.Height * .15 || Math.Abs(account.Bounds.Left - password.Bounds.Left) > size.Width * .08 ||
        submit.Bounds.Top <= password.Bounds.Bottom + gap || Math.Abs(submit.Bounds.Left + submit.Bounds.Width / 2 - size.Width / 2) > size.Width * .25) return null;
      int x = submit.Bounds.Left + submit.Bounds.Width / 2;
      var plan = new RiftTclsPlan { Account = new Point(x, account.Bounds.Top + gap / 2), Password = new Point(x, password.Bounds.Top + gap / 2), Submit = new Point(x, submit.Bounds.Top + submit.Bounds.Height / 2) };
      var bounds = new Rectangle(Point.Empty, size);
      return bounds.Contains(plan.Account) && bounds.Contains(plan.Password) && bounds.Contains(plan.Submit) ? plan : null;
    }
    var qq = UniqueLabel(labels, "QQ登录"); var wechat = UniqueLabel(labels, "微信登录");
    if (account == null && password == null && submit == null && qq != null && wechat != null &&
      wechat.Bounds.Top > qq.Bounds.Bottom && Math.Abs(qq.Bounds.Left - wechat.Bounds.Left) < size.Width * .25) {
      return new RiftTclsPlan { ChooseQq = true, Submit = new Point(qq.Bounds.Left + qq.Bounds.Width / 2, qq.Bounds.Top + qq.Bounds.Height / 2) };
    }
    return null;
  }
  private static void Send(Input[] input) {
    if (SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(Input))) != input.Length) throw new InvalidOperationException();
  }
  private static Input Key(ushort key, ushort scan, uint flags) { return new Input { Type = 1, Data = new InputUnion { Key = new KeyInput { Key = key, Scan = scan, Flags = flags } } }; }
  public static void Click(RiftTclsWindow window, Point relative) {
    var point = new Point(window.Panel.Left + relative.X, window.Panel.Top + relative.Y);
    GuardPoint(window, point); if (!SetCursorPos(point.X, point.Y)) throw new InvalidOperationException();
    GuardPoint(window, point);
    Send(new[] { new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = 2 } } }, new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = 4 } } } });
  }
  private static void Type(RiftTclsWindow window, Point point, string text) {
    Click(window, point); Thread.Sleep(100); Guard(window);
    Send(new[] { Key(0x11, 0, 0), Key(0x41, 0, 0), Key(0x41, 0, 2), Key(0x11, 0, 2) });
    foreach (char character in text) { Guard(window); Send(new[] { Key(0, character, 4), Key(0, character, 6) }); }
  }
  public static void FillRendered(RiftTclsWindow window, RiftTclsPlan form, string username, string password) {
    Type(window, form.Account, username); Type(window, form.Password, password); Click(window, form.Submit);
  }
}
`

export const TCLS_COMPILE_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing
Add-Type -TypeDefinition @'
${TCLS_NATIVE_CODE}
'@ -ReferencedAssemblies @([Diagnostics.Process].Assembly.Location, [Linq.Enumerable].Assembly.Location,
  [Windows.Automation.AutomationElement].Assembly.Location, [Windows.Automation.ControlType].Assembly.Location,
  [Windows.Rect].Assembly.Location, [Drawing.Bitmap].Assembly.Location)
`

export const TCLS_LOGIN_SCRIPT = String.raw`
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Report([string]$event) { [Console]::WriteLine((@{ event = $event } | ConvertTo-Json -Compress)) }
try {
  $request = [Console]::ReadLine() | ConvertFrom-Json
  ${TCLS_COMPILE_SCRIPT}
  [RiftTclsDesktop]::InitializeDpi()
  [RiftTclsDesktop]::SetOwner([int]$request.ownerPid)
  $paths = [string[]]$request.paths
  $submitted = $false
  $qqChosen = $false
  $passwordMode = $false
  $ocrAttempted = $false
  $engine = $null
  $clock = [Diagnostics.Stopwatch]::StartNew()
  Report 'window'
  function Await-WinRt($operation, [Type]$resultType) {
    $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(8000)) { throw 'WinRT timeout' }
    return $task.Result
  }
  while ($clock.Elapsed.TotalSeconds -lt 90) {
    if (-not [RiftTclsDesktop]::OwnerAlive()) { exit 0 }
    $windows = @([RiftTclsDesktop]::FindWindows($paths))
    # More than one official launcher is ambiguous. Never choose an account window at random.
    if ($windows.Count -gt 1) { Report 'unsupported'; exit 0 }
    if ($windows.Count -eq 0) { Start-Sleep -Milliseconds 700; continue }
    $window = $windows[0]
    if (-not [RiftTclsDesktop]::Foreground($window)) { Report 'foreground'; Start-Sleep -Milliseconds 700; continue }
    $probe = $null
    try { $probe = [RiftTclsDesktop]::Probe($window) } catch { }
    if ($null -ne $probe) {
      if ($probe.Verification) { Report 'verification'; exit 0 }
      if ($probe.Region) { Report 'region'; exit 0 }
      if (-not $submitted -and $null -ne $probe.Account -and $null -ne $probe.Password -and $null -ne $probe.Submit) {
        $submitted = $true
        Report 'uia'
        [RiftTclsDesktop]::FillAccessible($window, $probe, $request.username, $request.password)
        Report 'submitted'
        Start-Sleep -Milliseconds 1000
        continue
      }
      if (-not $submitted -and -not $qqChosen -and $null -ne $probe.Qq) {
        $qqChosen = $true
        [RiftTclsDesktop]::Invoke($window, $probe.Qq)
        Start-Sleep -Milliseconds 700
        continue
      }
      if (-not $submitted -and -not $passwordMode -and $null -ne $probe.PasswordMode) {
        $passwordMode = $true
        [RiftTclsDesktop]::Invoke($window, $probe.PasswordMode)
        Start-Sleep -Milliseconds 700
        continue
      }
    }
    if ($clock.Elapsed.TotalSeconds -lt 8) { Start-Sleep -Milliseconds 700; continue }
    if (-not $ocrAttempted) {
      $ocrAttempted = $true
      try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null
        [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
        $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
          $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
        } | Select-Object -First 1
        $language = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -like 'zh-Hans*' -or $_.LanguageTag -eq 'zh-CN' } | Select-Object -First 1
        if ($null -ne $language) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language) }
      } catch { $engine = $null }
    }
    if ($null -eq $engine) { Report 'ocrUnavailable'; exit 0 }
    $bitmap = $null; $memory = $null; $stream = $null; $software = $null
    try {
      $bitmap = [RiftTclsDesktop]::CapturePanel($window)
      if ($null -eq $bitmap) { Report 'unsupported'; exit 0 }
      if ($bitmap.Width -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $bitmap.Height -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { Report 'unsupported'; exit 0 }
      $memory = [IO.MemoryStream]::new()
      $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
      $memory.Position = 0
      $stream = [IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
      $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $software = Await-WinRt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await-WinRt ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
      $labels = [Collections.Generic.List[RiftTclsLabel]]::new()
      foreach ($line in $result.Lines) {
        $box = [Drawing.Rectangle]::Empty
        foreach ($word in $line.Words) {
          $rect = $word.BoundingRect
          $part = [Drawing.Rectangle]::new([int]$rect.X, [int]$rect.Y, [int]$rect.Width, [int]$rect.Height)
          if ($box.IsEmpty) { $box = $part } else { $box = [Drawing.Rectangle]::Union($box, $part) }
        }
        $label = [RiftTclsLabel]::new(); $label.Text = $line.Text; $label.Bounds = $box; $labels.Add($label)
      }
      if ([RiftTclsDesktop]::NeedsVerification([string[]]@($labels | ForEach-Object { $_.Text }))) { Report 'verification'; exit 0 }
      if (@($labels | Where-Object { $_.Text -match '选择大区|选择服务器|服务器列表' }).Count -gt 0) { Report 'region'; exit 0 }
      if (-not $submitted) {
        $plan = [RiftTclsDesktop]::Plan($labels.ToArray(), $bitmap.Size)
        if ($null -ne $plan) {
          if ($plan.ChooseQq -and -not $qqChosen) {
            $qqChosen = $true
            [RiftTclsDesktop]::Click($window, $plan.Submit)
          } elseif (-not $plan.ChooseQq) {
            $submitted = $true
            Report 'ocr'
            [RiftTclsDesktop]::FillRendered($window, $plan, $request.username, $request.password)
            Report 'submitted'
          }
        }
      }
    } finally {
      if ($null -ne $software) { $software.Dispose() }
      if ($null -ne $stream) { $stream.Dispose() }
      if ($null -ne $memory) { $memory.Dispose() }
      if ($null -ne $bitmap) { $bitmap.Dispose() }
    }
    Start-Sleep -Milliseconds 1000
  }
  Report 'timeout'
} catch {
  # UIA/WinRT exceptions may contain input values. Output only a fixed protocol event.
  Report 'failed'
  exit 1
}
`
