# Makes the Downy helper start when you sign in to Windows, like IDM does.
# Run again with -Remove to undo.
param([switch]$Remove)

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Downy helper.lnk'

if ($Remove) {
    Remove-Item $link -ErrorAction SilentlyContinue
    Write-Output 'Downy helper removed from startup.'
    exit 0
}

$pythonw = (Get-Command pythonw -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'helper\downy_helper.py'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = "`"$script`""
$shortcut.WorkingDirectory = Join-Path $PSScriptRoot 'helper'
$shortcut.Description = 'Downy download helper'
$shortcut.Save()
Write-Output "Downy helper will start at sign in ($link)."
