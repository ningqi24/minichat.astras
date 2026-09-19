# FloxChat new version -> MiniChat patched sb3, one command.
#
# Usage (run inside the MiniChat folder):
#   .\build-floxchat.ps1 -Src "FloxChat Alpha 0.6.9_P2.5.1" -Tag "P2.5.1"
#   .\build-floxchat.ps1 -Src "FloxChat Alpha 0.6.9_P2.6"   -Tag "P2.6"
#
# Steps: copy source dir -> apply 10 patches -> validate graph/assets -> pack sb3
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI (GBK on CN
# systems) unless it has a BOM, so non-ASCII text here gets mangled and can break
# parsing. Chinese docs live in Floxchat-Bridge/README.md instead.
param(
    [Parameter(Mandatory=$true)][string]$Src,
    [Parameter(Mandatory=$true)][string]$Tag
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$dst = "FloxChat_${Tag}_MiniChat"
$out = "FloxChat-${Tag}-MiniChat.sb3"

if (-not (Test-Path "$Src\project.json")) { throw "project.json not found under '$Src'" }
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
if (Test-Path $out) { Remove-Item $out -Force }

Write-Host "[1/4] copy '$Src' -> '$dst'"
Copy-Item $Src $dst -Recurse -Force

Write-Host "[2/4] patch"
node floxchat-patch.js "$dst\project.json" "$dst\project.json"

Write-Host "[3/4] validate"
node floxchat-validate.js $dst
if ($LASTEXITCODE -ne 0) { throw "validation failed - not packing" }
Remove-Item "$dst\project.json.*.txt" -Force -ErrorAction SilentlyContinue

Write-Host "[4/4] pack"
Compress-Archive -Path "$dst\*" -DestinationPath "_tmp.zip" -Force
Move-Item "_tmp.zip" $out -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $out).Path)
$n = $z.Entries.Count
$hasProj = [bool]($z.Entries | Where-Object { $_.FullName -eq "project.json" })
$z.Dispose()

Write-Host ""
Write-Host "DONE: $out"
Write-Host "  $((Get-Item $out).Length) bytes / $n entries / project.json at root: $hasProj"
Write-Host ""
Write-Host "Reminder: if minichat-bridge.js changed in this round, bump EXT_VER in"
Write-Host "floxchat-patch.js and rebuild - otherwise browsers reuse the cached old JS."
