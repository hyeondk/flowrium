$ErrorActionPreference = 'Stop'
$folder = [IO.Path]::GetDirectoryName($env:FLOWRIUM_UPDATE_TARGET)
$receipt = $env:FLOWRIUM_UPDATE_RECEIPT
$parentClosed = $false
$installed = $false
$newApp = $null
$log = $env:FLOWRIUM_UPDATE_RESULT + '.log'
$encoding = New-Object Text.UTF8Encoding($false)
function Write-FlowriumUpdateTrace([string]$step, [hashtable]$detail = @{}) {
    $record = @{ at = [DateTime]::UtcNow.ToString('o'); step = $step; helperPid = $PID; detail = $detail }
    try { [IO.File]::AppendAllText($log, (ConvertTo-Json $record -Compress) + [Environment]::NewLine, $encoding) } catch {}
}
try {
    [IO.File]::WriteAllText($receipt + '.helper', [string]$PID, $encoding)
    Write-FlowriumUpdateTrace 'helper-start' @{ parentPid = $env:FLOWRIUM_UPDATE_PID; target = $env:FLOWRIUM_UPDATE_TARGET; expectedVersion = $env:FLOWRIUM_UPDATE_VERSION }
    # 부모가 Get-Process와 WaitForExit 사이에서 종료되어도 실패로 판정하지 않는다.
    $parentLimit = [DateTime]::UtcNow.AddSeconds(120)
    while ($null -ne (Get-Process -Id ([int]$env:FLOWRIUM_UPDATE_PID) -ErrorAction SilentlyContinue)) {
        if ([DateTime]::UtcNow -ge $parentLimit) { throw 'Parent still running' }
        Start-Sleep -Milliseconds 150
    }
    $parentClosed = $true
    Write-FlowriumUpdateTrace 'parent-closed'
    # NSIS는 공백이 포함된 /D 경로를 인용하지 않은 마지막 인자로 받는다.
    $arguments = '/S --updated /D=' + $folder
    Write-FlowriumUpdateTrace 'installer-start-request' @{ file = $env:FLOWRIUM_UPDATE_FILE; folder = $folder }
    # Start-Process -Wait는 설치기가 시작한 자손도 기다린다. 설치 프로세스의 종료와 실제 파일 버전을 따로 확인한다.
    $installer = Start-Process -FilePath $env:FLOWRIUM_UPDATE_FILE -ArgumentList $arguments -WorkingDirectory $env:FLOWRIUM_UPDATE_STAGE -PassThru
    Write-FlowriumUpdateTrace 'installer-started' @{ installerPid = $installer.Id }
    if (!$installer.WaitForExit(300000)) { throw 'Installer did not exit within five minutes' }
    $installer.Refresh()
    Write-FlowriumUpdateTrace 'installer-exit' @{ code = $installer.ExitCode }
    if ($installer.ExitCode -ne 0) { throw ('Installer exit code ' + $installer.ExitCode) }
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($env:FLOWRIUM_UPDATE_TARGET)
    $version = [Version]::Parse(($info.ProductVersion -split '[+ ]')[0])
    Write-FlowriumUpdateTrace 'installed-version' @{ actual = $version.ToString(3); path = $env:FLOWRIUM_UPDATE_TARGET }
    if ($version.ToString(3) -ne $env:FLOWRIUM_UPDATE_VERSION) { throw 'Installed version mismatch' }
    $installed = $true
    $profileFolder = [IO.Path]::GetDirectoryName($env:FLOWRIUM_UPDATE_RESULT)
    $launchArgs = '--flowrium-update-token=' + $env:FLOWRIUM_UPDATE_TOKEN + ' "--user-data-dir=' + $profileFolder + '"'
    $newApp = Start-Process -FilePath $env:FLOWRIUM_UPDATE_TARGET -ArgumentList $launchArgs -WorkingDirectory $folder -PassThru
    Write-FlowriumUpdateTrace 'app-launched' @{ appPid = $newApp.Id }
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline -and !$newApp.HasExited) {
        if ([IO.File]::Exists($receipt + '.ready') -and [IO.File]::Exists($receipt + '.starting')) {
            $ready = [IO.File]::ReadAllText($receipt + '.ready').Trim() -eq [string]$newApp.Id -and
                [IO.File]::ReadAllText($receipt + '.starting').Trim() -eq [string]$newApp.Id
            if ($ready) { break }
        }
        Start-Sleep -Milliseconds 300
    }
    if (!$ready) { throw 'Updated app failed to start' }
    Write-FlowriumUpdateTrace 'app-ready' @{ appPid = $newApp.Id; appWindow = $newApp.MainWindowHandle.ToInt64(); actual = $version.ToString(3) }
} catch {
    Write-FlowriumUpdateTrace 'failed' @{ message = $_.Exception.Message; installed = $installed; parentClosed = $parentClosed; startedSignal = [IO.File]::Exists($receipt + '.starting'); readySignal = [IO.File]::Exists($receipt + '.ready') }
    [IO.File]::WriteAllText($env:FLOWRIUM_UPDATE_RESULT, "failed")
    if ($newApp -and !$newApp.HasExited) {
        $null = $newApp.CloseMainWindow()
        if (!$newApp.WaitForExit(5000)) { $newApp.Kill() }
    }
    $returned = $false
    if ($parentClosed -and !$installed -and (Test-Path -LiteralPath $env:FLOWRIUM_UPDATE_TARGET)) {
        try {
            Start-Process -FilePath $env:FLOWRIUM_UPDATE_TARGET -WorkingDirectory $folder
            $returned = $true
        } catch { }
    }
    if ($parentClosed -and !$returned) {
        # 설치는 끝났으나 새 창을 열지 못했다. 앱 외부에서 정식 복구 경로를 제공한다.
        Add-Type -AssemblyName System.Windows.Forms
        $answer = [Windows.Forms.MessageBox]::Show('Flowrium을 다시 열지 못했습니다. 다운로드 페이지에서 설치 파일을 받아 다시 설치할 수 있습니다. 페이지를 열까요?', 'Flowrium 업데이트', 'YesNo', 'Warning')
        if ($answer -eq [Windows.Forms.DialogResult]::Yes) { Start-Process 'https://hyeondk.github.io/flowrium/' }
    }
} finally {
    foreach ($suffix in '.json', '.starting', '.ready', '.helper') { Remove-Item -LiteralPath ($receipt + $suffix) -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $env:FLOWRIUM_UPDATE_STAGE -Recurse -Force -ErrorAction SilentlyContinue
}
