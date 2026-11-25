# install-deps.ps1: Orbit's Node.js and Git offer on Windows (CONTRACT section 39, rules N4 and N6; Uplink 0.13.3).
#
# /orbit:orbit-setup step 1 runs it, from the PowerShell tool or from Git Bash, as:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin root>/scripts/install-deps.ps1" check|install
#
# Windows PowerShell 5.1, ASCII only, no PowerShell 7 syntax. It prints KEY=value lines (N4), one fact per line; Claude acts
# only on those, and every other line is shown to the person as it is.
# - check only reads: files, the registry, and --version of executables it has already located.
# - install installs what check offered, from the winget source only (N3: never a file this script fetches itself), under a
#   lock, then decides each tool again.
#
# Test mode (ORBIT_TEST_MODE set, and only then), for a test run under pwsh with stubs:
# - ORBIT_TEST_WINGET is the winget to run ("none", or unset: no winget);
# - ORBIT_TEST_REG is a file of "HKLM\SOFTWARE\Node.js=<InstallPath>" lines that stands in for the registry;
# - a winget stub's last output line "ORBIT_TEST_EXIT=<code>" stands in for its exit code (a stub can't exit 0x8A15010C);
# - ORBIT_TEST_PATHEXT stands in for PATHEXT where node is looked up, so a stub node.cmd is found as on Windows.
# node and git are found on PATH as always, so a test puts its stubs on PATH.

param([string]$Command = '')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$TestMode = [bool]$env:ORBIT_TEST_MODE
$OnWindows = ($env:OS -eq 'Windows_NT')
# Names on PATH carry an extension (node.exe, node.cmd): on Windows, and in a test that sets ORBIT_TEST_PATHEXT.
$PathHasExt = ($OnWindows -or ($TestMode -and [bool]$env:ORBIT_TEST_PATHEXT))
$MinNodeMajor = 22
$MinWinget = [version]'1.6.3482'
$LockMaxAgeMinutes = 30
$Hives = @('HKLM', 'HKCU')
$NodeKey = 'SOFTWARE\Node.js'
$GitKey = 'SOFTWARE\GitForWindows'
$NodeWingetLine = 'winget install --id OpenJS.NodeJS.24 -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity'
$GitWingetLine = 'winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity'

# winget's exit codes (N6), as unsigned hex: the person declined (also an installer exit of 1602 or 1223), or a policy blocked it.
$DeclinedCodes = @('0x8A15010C')
$DeclinedInstallerExits = @('1602', '1223')
$BlockedCodes = @('0x8A15003A', '0x8A15010F')

# Every line goes out through one writer, so winget's own lines and the key lines keep their order.
function Out-Line([string]$Text) { [Console]::Out.WriteLine($Text) }
function Slash([string]$Path) { return ($Path -replace '\\', '/') }
function Norm([string]$Path) {
  if (-not $Path) { return '' }
  return ((($Path -replace '\\', '/').TrimEnd('/')).ToLowerInvariant())
}
function Test-Under([string]$Path, [string]$Dir) {
  if (-not $Path -or -not $Dir) { return $false }
  $p = Norm $Path
  $d = Norm $Dir
  return ($p -eq $d -or $p.StartsWith($d + '/'))
}

# Runs an executable with arguments, waits at most $Seconds, and returns its exit code and output lines.
function Invoke-Capture([string]$Exe, [string[]]$ArgList, [int]$Seconds) {
  $quoted = @()
  foreach ($a in $ArgList) {
    if ($a -match '\s') { $quoted += ('"' + $a + '"') } else { $quoted += $a }
  }
  return (Invoke-CaptureLine $Exe ($quoted -join ' ') $Seconds)
}

# The same, with the argument string as it is (cmd.exe /s /c takes its own quoting).
function Invoke-CaptureLine([string]$Exe, [string]$Arguments, [int]$Seconds) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  try { [void]$proc.Start() } catch { return @{ Started = $false; TimedOut = $false; Code = $null; Out = @() } }
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit($Seconds * 1000)) {
    try { $proc.Kill() } catch { }
    return @{ Started = $true; TimedOut = $true; Code = $null; Out = @() }
  }
  $proc.WaitForExit()
  $text = $outTask.Result + "`n" + $errTask.Result
  $lines = @($text -split "`r`n|`n" | Where-Object { $_.Trim() -ne '' })
  return @{ Started = $true; TimedOut = $false; Code = $proc.ExitCode; Out = $lines }
}

# The vX.Y.Z a --version run printed, or $null when it failed, timed out or printed none.
function Read-Version($R) {
  if (-not $R.Started -or $R.TimedOut -or $R.Code -ne 0) { return $null }
  foreach ($l in $R.Out) {
    if ($l -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]('{0}.{1}.{2}' -f $Matches[1], $Matches[2], $Matches[3]) }
  }
  return $null
}

function Get-Version([string]$Exe) {
  return (Read-Version (Invoke-Capture $Exe @('--version') 10))
}

# A node that is not an .exe (a mise .cmd shim, an npm node.cmd) runs on Windows through cmd.exe, by its absolute path under
# SystemRoot: cmd /d /s /c ""<shim>" --version" (the outer quotes are cmd.exe /s own, so a path with spaces or brackets holds).
function Get-ShimVersion([string]$Path) {
  if (-not $OnWindows) { return (Get-Version $Path) }
  $root = $env:SystemRoot
  if (-not $root) { $root = $env:windir }
  if (-not $root) { return $null }
  $cmd = [System.IO.Path]::Combine($root, 'System32', 'cmd.exe')
  return (Read-Version (Invoke-CaptureLine $cmd ('/d /s /c ""' + $Path + '" --version"') 10))
}

function Test-Works([string]$Exe) {
  $r = Invoke-Capture $Exe @('--version') 10
  return ($r.Started -and -not $r.TimedOut -and $r.Code -eq 0)
}

# The first application named $Name on PATH; on Windows only an .exe (W6d: a .cmd git is never run). Used for git and winget.
function Find-OnPath([string]$Name) {
  $cmds = @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
  foreach ($c in $cmds) {
    if ($OnWindows -and ([System.IO.Path]::GetExtension($c.Source).ToLowerInvariant() -ne '.exe')) { continue }
    return $c.Source
  }
  return $null
}

# PATHEXT as a list (.COM;.EXE;.BAT;.CMD when it is unset), or the bare name only where names carry no extension.
function Get-PathExts {
  if ($TestMode -and $env:ORBIT_TEST_PATHEXT) {
    $pe = $env:ORBIT_TEST_PATHEXT
  } elseif ($OnWindows) {
    $pe = $env:PATHEXT
    if (-not $pe) { $pe = '.COM;.EXE;.BAT;.CMD' }
  } else {
    return @('')
  }
  return @($pe -split ';' | Where-Object { $_.Trim() -ne '' })
}

# The first node on PATH, as a shell finds it: each PATH folder in order, and in each one the PATHEXT extensions in order. Any
# extension: a node.cmd first on PATH (a mise shim, the npm node package) is the node a shell runs, so it is never no node.
function Find-NodeOnPath {
  $exts = @(Get-PathExts)
  foreach ($d in @(([string]$env:PATH) -split [System.IO.Path]::PathSeparator)) {
    $d = $d.Trim().Trim('"')
    if (-not $d) { continue }
    foreach ($e in $exts) {
      try {
        $f = [System.IO.Path]::Combine($d, 'node' + $e)
        if (Test-Path -LiteralPath $f -PathType Leaf) { return $f }
      } catch { }
    }
  }
  return $null
}

# True for a node a shell runs that is not an .exe (node.cmd, node.bat): its version goes through Get-ShimVersion.
function Test-Shim([string]$Path) {
  if (-not $PathHasExt) { return $false }
  return ([System.IO.Path]::GetExtension($Path).ToLowerInvariant() -ne '.exe')
}

# A key's InstallPath value, or $null. Test mode reads ORBIT_TEST_REG instead of the registry.
function Get-InstallPath([string]$Hive, [string]$Key) {
  if ($TestMode) {
    $file = $env:ORBIT_TEST_REG
    if (-not $file) { return $null }
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    foreach ($l in @(Get-Content -LiteralPath $file)) {
      $i = $l.IndexOf('=')
      if ($i -gt 0 -and $l.Substring(0, $i) -eq ($Hive + '\' + $Key)) { return $l.Substring($i + 1) }
    }
    return $null
  }
  try {
    $v = Get-ItemProperty -LiteralPath ('{0}:\{1}' -f $Hive, $Key) -Name InstallPath -ErrorAction Stop
    return [string]$v.InstallPath
  } catch { return $null }
}

function Find-Winget {
  if ($TestMode) {
    $w = $env:ORBIT_TEST_WINGET
    if (-not $w -or $w -eq 'none') { return $null }
    return $w
  }
  return Find-OnPath 'winget'
}

# 'ok', 'no_winget' (none at all) or 'old_winget' (older than 1.6.3482, or no version line within 10 s). Asked once per run.
$script:WingetState = $null
function Get-WingetState {
  if ($null -ne $script:WingetState) { return $script:WingetState }
  $state = 'old_winget'
  $w = Find-Winget
  if (-not $w) {
    $state = 'no_winget'
  } else {
    $r = Invoke-Capture $w @('--version') 10
    if (-not $r.Started) {
      $state = 'no_winget'
    } elseif (-not $r.TimedOut) {
      foreach ($l in $r.Out) {
        if ($l -match '^v(\d+)\.(\d+)\.(\d+)') {
          if ([version]('{0}.{1}.{2}' -f $Matches[1], $Matches[2], $Matches[3]) -ge $MinWinget) { $state = 'ok' }
          break
        }
      }
    }
  }
  $script:WingetState = $state
  return $state
}

# The folder a symlinked folder points to (nvm-windows' NVM_SYMLINK), or the folder itself.
function Resolve-Dir([string]$Dir) {
  try {
    $item = Get-Item -LiteralPath $Dir -Force -ErrorAction Stop
    if ($item.LinkType) {
      $t = @($item.Target)
      if ($t.Count -gt 0 -and $t[0]) { return [string]$t[0] }
    }
  } catch { }
  return $Dir
}

# A folder as backslash path segments, each one closed by a backslash, lower case: C:\Program Files\Volta is
# \c:\program files\volta\ so a tool folder matches as a whole segment, its last one included (Volta's shim folder).
function Seg([string]$Path) {
  if (-not $Path) { return '' }
  return (('\' + (($Path -replace '/', '\').Trim('\')) + '\').ToLowerInvariant())
}

# Who manages an older node first on PATH (N4's names): by the managers' variables, and by a tool folder as a whole path segment
# of the node's folder or the folder it resolves to (Volta's standard shim C:\Program Files\Volta\node.exe is volta).
function Get-ManagedTool([string]$NodePath) {
  $dir = Split-Path -Parent $NodePath
  $real = Resolve-Dir $dir
  $s = (Seg $real) + '|' + (Seg $dir)
  if ((Test-Under $dir $env:NVM_SYMLINK) -or (Test-Under $real $env:NVM_HOME) -or (Test-Under $dir $env:NVM_HOME)) { return 'nvm-windows' }
  if ((Test-Under $real $env:VOLTA_HOME) -or $s.Contains('\volta\')) { return 'volta' }
  if ((Test-Under $real $env:FNM_DIR) -or $s.Contains('\fnm_multishells\') -or $s.Contains('\fnm\')) { return 'fnm' }
  if ((Test-Under $real $env:MISE_DATA_DIR) -or $s.Contains('\mise\')) { return 'mise' }
  if ($s.Contains('\scoop\')) { return 'scoop' }
  if ($s.Contains('\chocolatey\')) { return 'chocolatey' }
  return 'other'
}

# As `node --version` prints it (v18.20.4), the same as install-deps.sh; unknown when node's --version failed.
function Format-Version($V) {
  if ($null -eq $V) { return 'unknown' }
  return ('v{0}.{1}.{2}' -f $V.Major, $V.Minor, $V.Build)
}

# check (N6): Node rules 1-4, then Git rules 1-3. Returns the key lines and what is offered.
function Get-Check {
  $lines = New-Object System.Collections.ArrayList
  $offerNode = $false
  $offerGit = $false
  $manual = ''

  # Node
  $node = Find-NodeOnPath
  if ($node -and (Test-Shim $node)) {
    $v = Get-ShimVersion $node                                                       # a shim first on PATH (node.cmd)
    if ($null -ne $v -and $v.Major -ge $MinNodeMajor) {
      [void]$lines.Add('NODE=' + (Slash $node))                                   # 1. 22 or newer: the shell's node works
    } else {
      [void]$lines.Add('MANAGED=' + (Get-ManagedTool $node) + ' ' + (Format-Version $v))   # 2. older or unknown: its tool's words
    }
  } elseif ($node) {
    $v = Get-Version $node
    if ($null -ne $v -and $v.Major -ge $MinNodeMajor) {
      [void]$lines.Add('NODE=' + (Slash $node))                                   # 1. 22 or newer first on PATH
    } else {
      $installed = $null
      foreach ($h in $Hives) { $ip = Get-InstallPath $h $NodeKey; if ($ip) { $installed = $ip; break } }
      if ($installed -and ((Norm (Split-Path -Parent $node)) -eq (Norm $installed))) {
        $ws = Get-WingetState                                                       # 2. older, from Node.js's own MSI
        if ($ws -eq 'ok') {
          [void]$lines.Add('OFFER_NODE=24')
          [void]$lines.Add('REPLACES=' + (Format-Version $v))
          $offerNode = $true
        } else {
          [void]$lines.Add('MANUAL=' + $ws)
          $manual = $ws
        }
      } else {
        [void]$lines.Add('MANAGED=' + (Get-ManagedTool $node) + ' ' + (Format-Version $v))   # 2. any other older node
      }
    }
  } elseif ($env:NVM_HOME) {
    [void]$lines.Add('MANAGED=nvm-windows none')                                    # 3. nvm-windows, no version selected
  } else {
    $found = $false
    $older = $null
    foreach ($h in $Hives) {                                                          # 3. the MSI's node, off PATH
      $ip = Get-InstallPath $h $NodeKey
      if (-not $ip) { continue }
      $exe = [System.IO.Path]::Combine($ip, 'node.exe')
      if (-not (Test-Path -LiteralPath $exe)) { continue }
      $v = Get-Version $exe
      if ($null -ne $v -and $v.Major -ge $MinNodeMajor) {
        [void]$lines.Add('NODE=' + (Slash $exe))
        [void]$lines.Add('NODE_OFF_PATH=1')
        $found = $true
        break
      }
      if ($null -eq $older) { $older = $v }
    }
    if (-not $found) {
      $ws = Get-WingetState                                                           # 4. nothing usable: offer it
      if ($ws -eq 'ok') {
        [void]$lines.Add('OFFER_NODE=24')
        if ($null -ne $older) { [void]$lines.Add('REPLACES=' + (Format-Version $older)) }
        $offerNode = $true
      } else {
        [void]$lines.Add('MANUAL=' + $ws)
        $manual = $ws
      }
    }
  }

  # Git
  $git = Find-OnPath 'git'
  if ($git -and (Test-Works $git)) {
    [void]$lines.Add('GIT=' + (Slash $git))                                          # 1. a working git on PATH
  } else {
    $candidates = @()                                                                 # 2. the same list as platform.toolPath('git')
    foreach ($h in $Hives) {
      $ip = Get-InstallPath $h $GitKey
      if ($ip) { $candidates += [System.IO.Path]::Combine($ip, 'cmd', 'git.exe') }
    }
    if ($env:ProgramFiles) { $candidates += [System.IO.Path]::Combine($env:ProgramFiles, 'Git', 'cmd', 'git.exe') }
    if ($env:LOCALAPPDATA) { $candidates += [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe') }
    $offPath = $null
    foreach ($c in $candidates) {
      if ((Test-Path -LiteralPath $c) -and (Test-Works $c)) { $offPath = $c; break }
    }
    if ($offPath) {
      [void]$lines.Add('GIT=' + (Slash $offPath))
      [void]$lines.Add('GIT_OFF_PATH=1')
    } else {
      $ws = Get-WingetState                                                           # 3. offer it
      if ($ws -eq 'ok') {
        [void]$lines.Add('OFFER_GIT=1')
        $offerGit = $true
      } elseif ($manual -ne $ws) {
        [void]$lines.Add('MANUAL=' + $ws)
      }
    }
  }
  return @{ Lines = $lines; OfferNode = $offerNode; OfferGit = $offerGit }
}

function Get-OrbitHome {
  if ($env:ORBIT_HOME) { return $env:ORBIT_HOME }
  $h = $env:USERPROFILE
  if (-not $h) { $h = $env:HOME }
  return [System.IO.Path]::Combine($h, '.orbit')
}

# The lock's text, or $null when it is not there or can't be read.
function Read-Lock([string]$Path) {
  try { return [System.IO.File]::ReadAllText($Path) } catch { return $null }
}

# A lock is live (BUSY) only when it could be read, names a running process, and is less than 30 minutes old.
function Test-LockLive($Text) {
  if ($null -eq $Text) { return $false }
  $t = @($Text -split "`r`n|`n")
  if ($t.Count -lt 2) { return $false }
  $holder = 0
  if (-not [int]::TryParse($t[0].Trim(), [ref]$holder)) { return $false }
  $start = [DateTime]::MinValue
  if (-not [DateTime]::TryParse($t[1].Trim(), [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$start)) { return $false }
  if (([DateTime]::UtcNow - $start.ToUniversalTime()).TotalMinutes -ge $LockMaxAgeMinutes) { return $false }
  $p = Get-Process -Id $holder -ErrorAction SilentlyContinue
  return ($null -ne $p)
}

# An error record as its innermost message, for the line printed before FAILED=.
function Get-ErrorText($Err) {
  $e = $Err.Exception
  while ($null -ne $e.InnerException) { $e = $e.InnerException }
  return $e.Message
}

# <ORBIT_HOME or ~/.orbit>\install-deps.lock, holding this pid and the start time. Returns State held (with Path and Body),
# busy (another live install holds it), or failed (with Error: the lock can't be written and no live lock is there).
function Enter-Lock {
  $dir = Get-OrbitHome
  $path = [System.IO.Path]::Combine($dir, 'install-deps.lock')
  $body = ('{0}' -f $PID) + "`n" + [DateTime]::UtcNow.ToString('o') + "`n"
  $err = 'unknown error'
  for ($try = 0; $try -lt 3; $try++) {
    $fs = $null
    try {
      [void][System.IO.Directory]::CreateDirectory($dir)
      $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    } catch { $err = Get-ErrorText $_ }
    if ($null -ne $fs) {
      $written = $false
      try {
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($body)
        $fs.Write($bytes, 0, $bytes.Length)
        $fs.Close()
        $written = $true
      } catch {
        $err = Get-ErrorText $_
        try { $fs.Dispose() } catch { }
      }
      if ($written) { return @{ State = 'held'; Path = $path; Body = $body } }
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue                # this run's own half-written lock
      break
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { break }                    # no lock there: it can't be written
    $seen = Read-Lock $path
    if (Test-LockLive $seen) { return @{ State = 'busy' } }
    # a dead, old or unreadable lock: read it again just before removing it, so a lock another install took meanwhile stays
    $again = Read-Lock $path
    if ($again -cne $seen) { continue }
    try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop } catch { $err = Get-ErrorText $_; break }
  }
  return @{ State = 'failed'; Error = ('install-deps: cannot write the lock ' + $path + ': ' + $err) }
}

# Removes the lock only while it is still this run's: its pid is this process and its text is what this run wrote.
function Exit-Lock($Lock) {
  if ($null -eq $Lock -or $Lock.State -ne 'held') { return }
  $now = Read-Lock $Lock.Path
  if ($null -eq $now) { return }
  $holder = @($now -split "`r`n|`n")[0].Trim()
  if ($holder -eq ('{0}' -f $PID) -and $now -ceq $Lock.Body) { Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction SilentlyContinue }
}

# winget's exit code as unsigned hex (0x8A15010C), from a signed or unsigned number.
function Format-Code($Code) {
  $u = [int64]$Code
  if ($u -lt 0) { $u = $u + 4294967296 }
  return ('0x{0:X8}' -f $u)
}

# N6's exit-code map: '' (installed), 'declined', 'blocked' or 'other'.
function Get-FailCode($Code, [string[]]$Output) {
  if ($null -eq $Code) { return 'other' }
  if ([int64]$Code -eq 0) { return '' }
  $hex = Format-Code $Code
  if ($DeclinedCodes -contains $hex) { return 'declined' }
  if ($DeclinedInstallerExits -contains ('{0}' -f $Code)) { return 'declined' }
  foreach ($l in $Output) {
    foreach ($x in $DeclinedInstallerExits) {
      if ($l -match ('exit code:?\s*' + $x + '\b')) { return 'declined' }
    }
  }
  if ($BlockedCodes -contains $hex) { return 'blocked' }
  return 'other'
}

# One winget install: its lines shown as they come, then FAILED=<tool>:<code> after its last line when it didn't install.
function Install-One([string]$Tool, [string]$Line) {
  $w = Find-Winget
  if (-not $w) { Out-Line ('FAILED=' + $Tool + ':other'); return }
  $argv = @($Line -split ' ' | Select-Object -Skip 1)
  $out = New-Object System.Collections.ArrayList
  & $w @argv 2>&1 | ForEach-Object {
    $s = [string]$_
    [void]$out.Add($s)
    Out-Line $s
  }
  $code = $LASTEXITCODE
  $shown = @($out | Where-Object { $_.Trim() -ne '' })
  if ($TestMode -and $shown.Count -gt 0 -and $shown[$shown.Count - 1] -match '^ORBIT_TEST_EXIT=(\S+)$') {
    $raw = $Matches[1]
    if ($raw.StartsWith('0x')) { $code = [Convert]::ToInt64($raw.Substring(2), 16) } else { $code = [int64]$raw }
    if ($shown.Count -gt 1) { $shown = @($shown[0..($shown.Count - 2)]) } else { $shown = @() }
  }
  $fail = Get-FailCode $code $shown
  if ($fail) {
    if ($shown.Count -gt 0) { Out-Line $shown[$shown.Count - 1] }
    Out-Line ('FAILED=' + $Tool + ':' + $fail)
  }
}

function Invoke-Install {
  $lock = Enter-Lock
  if ($lock.State -eq 'busy') { Out-Line 'BUSY=1'; return }
  try {
    $c = Get-Check
    if (-not $c.OfferNode -and -not $c.OfferGit) {
      foreach ($l in $c.Lines) { Out-Line $l }
      return
    }
    if ($lock.State -ne 'held') {
      # the lock can't be written (and no live install holds it): nothing is installed, each offered tool is FAILED=<tool>:other with
      # the error on the line before it (N7 shows the line before each key), node first, as install-deps.sh does
      if ($c.OfferNode) { Out-Line $lock.Error; Out-Line 'FAILED=node:other' }
      if ($c.OfferGit) { Out-Line $lock.Error; Out-Line 'FAILED=git:other' }
      foreach ($l in $c.Lines) {
        if ($l.StartsWith('OFFER_') -or $l.StartsWith('REPLACES=')) { continue }
        Out-Line $l
      }
      return
    }
    if ($c.OfferNode) { Install-One 'node' $NodeWingetLine }
    if ($c.OfferGit) { Install-One 'git' $GitWingetLine }
    # check decides each tool again; this running process keeps its old PATH, so a new install shows as *_OFF_PATH=1
    $script:WingetState = $null
    $after = Get-Check
    foreach ($l in $after.Lines) {
      if ($l.StartsWith('OFFER_') -or $l.StartsWith('REPLACES=')) { continue }
      Out-Line $l
    }
  } finally {
    Exit-Lock $lock
  }
}

switch ($Command) {
  'check' {
    $c = Get-Check
    foreach ($l in $c.Lines) { Out-Line $l }
  }
  'install' { Invoke-Install }
  default {
    [Console]::Error.WriteLine('usage: install-deps.ps1 check|install')
    exit 2
  }
}
exit 0
