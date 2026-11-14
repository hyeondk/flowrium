[CmdletBinding()]
param(
  [string]$Version = '',
  [switch]$FromSource,
  [string]$InstallDir = '',
  [string]$Package = '',
  [string]$Checksums = '',
  [string]$SupportFile = '',
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Assert-Stopped {
  if (Get-Process -Name Flowrium -ErrorAction SilentlyContinue) { throw 'Flowrium이 실행 중입니다. 앱과 관련 작업을 종료한 뒤 다시 설치하세요.' }
}
function Convert-NativeVersion([string]$Value) {
  if ($Value -match '^(\d{6})_(0[1-9]|[1-9]\d)$') {
    $digits=$Matches[1]; $sequence=[int]$Matches[2]
    $year=[int]($digits.Substring(0,2)); $month=[int]($digits.Substring(2,2)); $day=[int]($digits.Substring(4,2))
    try { $date=[DateTime]::new((2000+$year),$month,$day) } catch { throw '릴리스 날짜를 확인해 주세요.' }
    if ($date.ToString('yyMMdd',[Globalization.CultureInfo]::InvariantCulture) -cne $digits) { throw '릴리스 날짜를 확인해 주세요.' }
    return ([string]$year + '.' + $month + '.' + ($day*100+$sequence))
  }
  if ($Value -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw '릴리스 버전 형식을 확인해 주세요.' }
  return $Value
}
function Assert-Version([string]$Value) { [void](Convert-NativeVersion $Value) }
function Get-ExpectedHash([string]$Name, [string]$Manifest) {
  $matchesFound = @()
  foreach ($line in [IO.File]::ReadAllLines($Manifest)) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?([^\s]+)\s*$' -and $Matches[2] -ceq $Name) { $matchesFound += $Matches[1].ToLowerInvariant() }
  }
  if ($matchesFound.Count -ne 1) { throw '릴리스 체크섬 목록에서 파일을 하나로 확인하지 못했습니다.' }
  return $matchesFound[0]
}
function Assert-Hash([string]$File, [string]$Name, [string]$Manifest) {
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -cne (Get-ExpectedHash $Name $Manifest)) { throw 'SHA-256 검증에 실패했습니다. 파일을 실행하지 않았습니다.' }
}
function Receive-File([string]$Url, [string]$Destination) {
  if (-not $Url.StartsWith('https://github.com/hyeondk/flowrium/releases/', [StringComparison]::Ordinal)) { throw '공식 릴리스 주소를 확인해 주세요.' }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $current = [Uri]$Url
  for ($redirect = 0; $redirect -lt 9; $redirect++) {
    if ($current.Scheme -ne 'https') { throw 'HTTPS 다운로드 주소만 사용할 수 있습니다.' }
    $request = [Net.HttpWebRequest]::Create($current); $request.AllowAutoRedirect = $false; $request.Timeout = 900000; $request.UserAgent = 'Flowrium installer'
    $response = $request.GetResponse()
    try {
      if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) { $current = [Uri]::new($current, [string]$response.Headers['Location']); continue }
      if ([int]$response.StatusCode -ne 200) { throw '릴리스 파일을 다운로드하지 못했습니다.' }
      $output = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
      try { $response.GetResponseStream().CopyTo($output) } finally { $output.Dispose() }
      return
    } finally { $response.Dispose() }
  }
  throw '다운로드 주소의 이동 횟수가 너무 많습니다.'
}
function Get-PEArchitecture([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $reader = [IO.BinaryReader]::new($stream)
  try {
    if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw 'Windows 실행 파일 형식을 확인해 주세요.' }
    $stream.Position = 60; $offset = $reader.ReadUInt32()
    if ($offset -gt $stream.Length - 6) { throw 'Windows 실행 파일 정보가 잘못됐습니다.' }
    $stream.Position = $offset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Windows 실행 파일 형식을 확인해 주세요.' }
    switch ($reader.ReadUInt16()) { 0x8664 { return 'x64' } 0x14c { return 'x86' } 0xaa64 { return 'arm64' } default { return 'unknown' } }
  } finally { $reader.Dispose(); $stream.Dispose() }
}
function Assert-PlainDirectory([string]$Directory) {
  $at = [IO.Path]::GetFullPath($Directory)
  while ($at) {
    if (Test-Path -LiteralPath $at) {
      $item = Get-Item -LiteralPath $at -Force
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '설치 폴더에 파일이나 다른 위치를 가리키는 연결이 있습니다.' }
    }
    $parent = [IO.Directory]::GetParent($at)
    if (-not $parent) { break }; $at = $parent.FullName
  }
}
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw '소스 빌드 단계에 실패했습니다. 기존 앱은 유지했습니다.' }
}
function Get-TreeManifest([string]$Directory) {
  $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  $pending = @($root); $records = @()
  while ($pending.Count -gt 0) {
    $at = $pending[0]; $pending = @($pending | Select-Object -Skip 1)
    foreach ($item in Get-ChildItem -LiteralPath $at -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '앱 백업에서 다른 위치를 가리키는 연결을 발견했습니다.' }
      $relative = $item.FullName.Substring($root.Length + 1)
      if ($item.PSIsContainer) { $records += 'D|' + $relative; $pending += $item.FullName }
      else { $records += 'F|' + $item.Length + '|' + (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash + '|' + $relative }
    }
  }
  return [string]::Join("`n", @($records | Sort-Object -CaseSensitive))
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Windows 64비트 전용 설치 파일입니다.' }
if ($Version) { Assert-Version $Version }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Flowrium' }
if ($InstallDir -notmatch '^[A-Za-z]:[\\/]') { throw '설치 폴더는 로컬 드라이브의 절대 경로로 지정하세요.' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if ($InstallDir -eq [IO.Path]::GetPathRoot($InstallDir) -or $InstallDir -match '[\x00-\x1f"`%]') { throw '설치 폴더를 일반적인 로컬 절대 경로로 지정하세요.' }
Assert-PlainDirectory $InstallDir
$dataDirectory = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Flowrium'))
if ($InstallDir.Equals($dataDirectory, [StringComparison]::OrdinalIgnoreCase) -or $InstallDir.StartsWith($dataDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or $dataDirectory.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '사용자 대화 데이터 폴더에는 앱을 설치할 수 없습니다.' }
if ($Package) {
  if (-not (Test-Path -LiteralPath $Package -PathType Leaf) -or -not $Checksums -or -not (Test-Path -LiteralPath $Checksums -PathType Leaf)) { throw '로컬 설치 파일과 SHA256SUMS.txt를 함께 지정하세요.' }
} elseif ($Checksums) { throw '로컬 체크섬은 -Package와 함께 지정하세요.' }
Assert-Stopped
$work = Join-Path ([IO.Path]::GetTempPath()) ('flowrium-install-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($work) | Out-Null
$backup = ''; $createdDestination = $false; $success = $false
try {
  $base = 'https://github.com/hyeondk/flowrium/releases/latest/download'
  if ($Version) { $tag=$Version; if (-not $Version.Contains('_')) { $tag='v'+$Version }; $base = 'https://github.com/hyeondk/flowrium/releases/download/' + $tag }
  if (-not $Checksums) { $Checksums = Join-Path $work 'SHA256SUMS.txt'; Receive-File ($base + '/SHA256SUMS.txt') $Checksums }
  $suffix = '-win-x64.exe'; if ($FromSource) { $suffix = '-source.tar.gz' }
  $pattern = '^Flowrium-(\d{6}_\d{2}|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)' + [Regex]::Escape($suffix) + '$'
  if (-not $Package) {
    $names = @([IO.File]::ReadAllLines($Checksums) | ForEach-Object { if ($_ -match '^([0-9a-fA-F]{64})\s+\*?(Flowrium-[^\s]+)\s*$' -and $Matches[2].EndsWith($suffix, [StringComparison]::Ordinal)) { $Matches[2] } })
    if ($names.Count -ne 1) { throw '릴리스의 설치 파일을 하나로 확인하지 못했습니다.' }
    $name = $names[0]; if ($name -notmatch $pattern) { throw '설치 파일 이름을 확인해 주세요.' }; $Package = Join-Path $work $name; Receive-File ($base + '/' + $name) $Package
  } else { $name = [IO.Path]::GetFileName($Package) }
  if ($name -notmatch $pattern) { throw '설치 파일의 제품 이름과 아키텍처를 확인해 주세요.' }
  $releaseVersion = $Matches[1]; $nativeReleaseVersion=Convert-NativeVersion $releaseVersion
  if ($Version -and $Version -cne $releaseVersion) { throw '설치 파일과 요청한 버전이 다릅니다.' }
  Assert-Hash $Package $name $Checksums
  Write-Output ('릴리스 검증 완료 / Flowrium ' + $releaseVersion)
  if ($FromSource) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $nodeCommand -or -not $npmCommand) { throw '소스 빌드에는 Node.js 24 이상과 npm이 필요합니다.' }
    $node = $nodeCommand.Source; $npm = $npmCommand.Source
    & $node -e "if(process.platform!=='win32'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])<24)process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Windows x64용 Node.js 24 이상을 사용하세요.' }
    $helper = Join-Path $work 'flowrium-install-support.cjs'
    if ($SupportFile) { Copy-Item -LiteralPath $SupportFile -Destination $helper } else { Receive-File ($base + '/flowrium-install-support.cjs') $helper }
    Assert-Hash $helper 'flowrium-install-support.cjs' $Checksums
    $sourceRoot = & $node $helper extract-source $Package (Join-Path $work 'source') $releaseVersion
    if ($LASTEXITCODE -ne 0) { throw '소스 묶음의 경로와 제품 검증에 실패했습니다.' }
    if ($VerifyOnly) { Write-Output '소스 검증 완료 / 빌드와 설치를 실행하지 않았습니다.'; $success = $true; return }
    Push-Location -LiteralPath $sourceRoot
    try { Invoke-Checked -Command $npm -Arguments @('ci'); Invoke-Checked -Command $npm -Arguments @('run', 'dist:win') } finally { Pop-Location }
    $Package = Join-Path $sourceRoot ('release\Flowrium-' + $releaseVersion + '-win-x64.exe')
    if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) { throw '직접 빌드한 Windows 설치 파일이 없습니다.' }
  }
  # NSIS 설치 프로그램은 x86 부트스트랩을 사용할 수 있으므로 설치된 앱을 다시 x64로 검사합니다.
  if ((Get-PEArchitecture $Package) -notin @('x64', 'x86')) { throw 'Windows x64 릴리스 설치 프로그램이 아닙니다.' }
  if ($VerifyOnly) { Write-Output '설치 파일 무결성 검증 완료 / 설치하지 않았습니다.'; $success = $true; return }
  Assert-Stopped; Assert-PlainDirectory $InstallDir
  if (Test-Path -LiteralPath $InstallDir) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'Flowrium.exe') -PathType Leaf)) { throw '설치 위치에 다른 자료가 있습니다. Flowrium 전용 폴더를 지정하세요.' }
    $backup = $InstallDir + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $originalManifest = Get-TreeManifest $InstallDir
    Copy-Item -LiteralPath $InstallDir -Destination $backup -Recurse -Force
    if ((Get-TreeManifest $backup) -cne $originalManifest -or (Get-TreeManifest $InstallDir) -cne $originalManifest) { throw '이전 앱의 백업 검증에 실패해 설치를 중단했습니다. 기존 앱은 유지했습니다.' }
  }
  Assert-Stopped
  $createdDestination = $true
  $installer = Start-Process -FilePath $Package -ArgumentList ('/S /D=' + $InstallDir) -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw 'Windows 설치 프로그램이 완료되지 않았습니다. 기존 앱을 복원합니다.' }
  $installedExe = Join-Path $InstallDir 'Flowrium.exe'
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf) -or (Get-PEArchitecture $installedExe) -ne 'x64') { throw '설치된 앱의 Windows x64 구조를 확인하지 못했습니다.' }
  $installedVersion = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
  try { $installedVersion = ([Version]::Parse(($installedVersion -split '[+ ]')[0])).ToString(3) } catch { throw '설치된 앱의 버전 정보를 확인하지 못했습니다.' }
  if ($installedVersion -ne ($nativeReleaseVersion -split '-')[0]) { throw '설치된 앱의 버전이 요청한 릴리스와 다릅니다.' }
  $success = $true
  Write-Output ('설치 완료 / ' + $installedExe)
  if ($backup) { Write-Output ('이전 앱 백업 / ' + $backup) }
  Write-Output '프로젝트와 대화 데이터는 보존했습니다. 설치한 앱을 직접 실행하세요. 서명되지 않은 다운로드에는 Windows 확인 화면이 표시될 수 있으며 이 설치기는 보안 정책을 변경하지 않습니다.'
} finally {
  if (-not $success -and $createdDestination) {
    if (Test-Path -LiteralPath $InstallDir) {
      $failed = $InstallDir + '.failed-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
      Move-Item -LiteralPath $InstallDir -Destination $failed
      Write-Warning ('실패한 설치 자료 보관 / ' + $failed)
    }
    if ($backup -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $InstallDir; Write-Warning '이전 앱을 원래 위치에 복원했습니다.' }
  }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
