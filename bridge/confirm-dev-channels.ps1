<#
.SYNOPSIS
  Answers Claude Code's "WARNING: Loading development channels" screen in the HQ
  console window without needing focus (works while the screen is locked).

.DESCRIPTION
  Attaches to the console of the given process, polls its screen until the warning's
  option text is visible, then writes one Enter key press straight into that console's
  input buffer (option 1, "I am using this for local development", is pre-selected).
  It sends Enter at most once, and only while that text is on screen.

  Run by start-hq.ps1 -AutoConfirm in a separate hidden process.
#>
param(
  [Parameter(Mandatory)] [int]$TargetPid,
  [int]$TimeoutSeconds = 90,
  [string]$LogFile,
  [string]$Marker = 'I am using this for local development'
)

function Write-Log($msg) {
  if (-not $LogFile) { return }
  for ($i = 0; $i -lt 10; $i++) {   # a sync client (OneDrive, Google Drive) can briefly lock the log
    try { Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format s) auto-confirm: $msg" -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 300 }
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HqConsole {
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI info);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ReadConsoleOutputCharacterW(IntPtr h, StringBuilder buf, uint len, COORD at, out uint read);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] recs, uint len, out uint written);

  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct SMALL_RECT { public short Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct CSBI {
    public COORD Size; public COORD Cursor; public ushort Attr; public SMALL_RECT Window; public COORD MaxSize;
  }
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)] public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int KeyDown;
    [FieldOffset(4)] public ushort RepeatCount;
    [FieldOffset(6)] public ushort VirtualKeyCode;
    [FieldOffset(8)] public ushort VirtualScanCode;
    [FieldOffset(10)] public char UnicodeChar;
    [FieldOffset(12)] public uint ControlKeyState;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }

  const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, SHARE_RW = 3, OPEN_EXISTING = 3;

  public static bool Attach(uint pid) { FreeConsole(); return AttachConsole(pid); }
  public static void Detach() { FreeConsole(); }

  // Text currently visible in the console window.
  public static string Screen() {
    IntPtr h = CreateFileW("CONOUT$", GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return null;
    try {
      CSBI info;
      if (!GetConsoleScreenBufferInfo(h, out info)) return null;
      int width = info.Size.X;
      var all = new StringBuilder();
      for (short y = info.Window.Top; y <= info.Window.Bottom; y++) {
        var line = new StringBuilder(width);
        uint read;
        COORD at; at.X = 0; at.Y = y;
        if (ReadConsoleOutputCharacterW(h, line, (uint)width, at, out read)) all.AppendLine(line.ToString(0, (int)read));
      }
      return all.ToString();
    } finally { CloseHandle(h); }
  }

  public static bool SendEnter() {
    IntPtr h = CreateFileW("CONIN$", GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return false;
    try {
      var recs = new INPUT_RECORD[2];
      for (int i = 0; i < 2; i++) {
        recs[i].EventType = 1; // KEY_EVENT
        recs[i].KeyEvent.KeyDown = i == 0 ? 1 : 0;
        recs[i].KeyEvent.RepeatCount = 1;
        recs[i].KeyEvent.VirtualKeyCode = 0x0D;  // VK_RETURN
        recs[i].KeyEvent.VirtualScanCode = 0x1C;
        recs[i].KeyEvent.UnicodeChar = '\r';
      }
      uint written;
      return WriteConsoleInputW(h, recs, 2, out written) && written == 2;
    } finally { CloseHandle(h); }
  }
}
'@

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { Write-Log "HQ window (pid $TargetPid) is gone"; exit 1 }
  if ([HqConsole]::Attach([uint32]$TargetPid)) {
    $screen = [HqConsole]::Screen()
    if ($screen -and $screen.Contains($Marker)) {
      $ok = [HqConsole]::SendEnter()
      [HqConsole]::Detach()
      if ($ok) { Write-Log 'warning screen found, Enter sent'; exit 0 }
      Write-Log 'warning screen found but Enter could not be written; confirm by hand'; exit 2
    }
    [HqConsole]::Detach()
  }
  Start-Sleep -Milliseconds 1000
}
Write-Log "warning screen not seen within $TimeoutSeconds s (nothing sent)"
exit 3
