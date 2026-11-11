param(
  [ValidateSet('Menu','Preview','Recheck','RepairCopies','ApplyVerified','CleanTestEntries','RemoveMissingEntries')]
  [string]$Mode = 'Menu',
  [string]$Audit = '',
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($Mode -eq 'Menu') {
  Write-Host 'MediaLibrary Plus - Bulk Recovery' -ForegroundColor Cyan
  Write-Host '1. Preview report (no catalog changes)'
  Write-Host '2. Recheck flagged videos with a full decode (can take hours)'
  Write-Host '3. Create and fully verify repair copies; preserve originals'
  Write-Host '4. Relink library to verified repair copies (backup first; close app)'
  Write-Host '5. Remove test-placeholder library entries only (backup first; close app)'
  Write-Host '6. Remove missing-source library entries only (backup first; close app)'
  Write-Host 'Q. Exit'
  $choice = Read-Host 'Choose 1-6 or Q'
  $modes = @{ '1'='Preview'; '2'='Recheck'; '3'='RepairCopies'; '4'='ApplyVerified'; '5'='CleanTestEntries'; '6'='RemoveMissingEntries' }
  if (-not $modes.ContainsKey($choice)) { return }
  $Mode = $modes[$choice]
}
$node = (Get-Command node -ErrorAction Stop).Source
$arguments = @((Join-Path $PSScriptRoot 'bulk-library-recovery.cjs'))
if ($Audit) { $arguments += @('--audit', $Audit) }
if ($Output) { $arguments += @('--output', $Output) }
switch ($Mode) {
  'Recheck' { $arguments += '--recheck' }
  'RepairCopies' { $arguments += '--repair' }
  'ApplyVerified' { $arguments += @('--apply-verified','--apply') }
  'CleanTestEntries' { $arguments += @('--remove-test-entries','--apply') }
  'RemoveMissingEntries' { $arguments += @('--remove-missing-entries','--apply') }
}
Push-Location -LiteralPath $projectRoot
try { & $node @arguments; $result = $LASTEXITCODE } finally { Pop-Location }
if ($result -ne 0) { Write-Host 'Stopped. Review the message above before retrying.' -ForegroundColor Yellow }
exit $result
