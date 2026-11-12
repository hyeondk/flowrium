$ErrorActionPreference = 'Stop'
$folder = [IO.Path]::GetDirectoryName($env:FLOWRIUM_UPDATE_TARGET)
$started = $false
$parentClosed = $false
try {
    $parent = Get-Process -Id ([int]$env:FLOWRIUM_UPDATE_PID) -ErrorAction SilentlyContinue
    if ($parent -and !$parent.WaitForExit(120000)) { throw 'Parent still running' }
    $parentClosed = $true
    # NSIS requires an unquoted /D as its last argument, including paths with spaces.
    $arguments = '/S --updated /D=' + $folder
    $installer = Start-Process -FilePath $env:FLOWRIUM_UPDATE_FILE -ArgumentList $arguments -PassThru -Wait
    if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($env:FLOWRIUM_UPDATE_TARGET)
    $version = [Version]::Parse(($info.ProductVersion -split '[+ ]')[0])
    if ($version.ToString(3) -ne $env:FLOWRIUM_UPDATE_VERSION) { throw 'Installed version mismatch' }
    Start-Process -FilePath $env:FLOWRIUM_UPDATE_TARGET -WorkingDirectory $folder
    $started = $true
} catch {
    [IO.File]::WriteAllText($env:FLOWRIUM_UPDATE_RESULT, "failed")
    if ($parentClosed -and !$started -and (Test-Path -LiteralPath $env:FLOWRIUM_UPDATE_TARGET)) {
        Start-Process -FilePath $env:FLOWRIUM_UPDATE_TARGET -WorkingDirectory $folder
    }
} finally {
    Remove-Item -LiteralPath $env:FLOWRIUM_UPDATE_STAGE -Recurse -Force -ErrorAction SilentlyContinue
}
