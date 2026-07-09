Write-Host "Dalam Nama Tuhan Yesus Kristus."

$ErrorActionPreference = "Stop"

$requiredFiles = @(
  "AGENTS.md",
  "docs/agent-queue/NEXT_TASK.md",
  "docs/agent-queue/DONE_LOG.md"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Host "STOP: required file missing: $file"
    Write-Host "Soli Deo Gloria. Haleluya. Amin."
    exit 1
  }
}

Write-Host ""
Write-Host "Git status:"
git status --short

Write-Host ""
Write-Host "Staged files:"
$stagedFiles = @(git diff --cached --name-only)
if ($stagedFiles.Count -gt 0) {
  $stagedFiles | ForEach-Object { Write-Host $_ }
  Write-Host "STOP: staged files exist. Clear staging before Autopilot."
  Write-Host "Soli Deo Gloria. Haleluya. Amin."
  exit 1
}

Write-Host "(none)"

$nextTask = Get-Content -LiteralPath "docs/agent-queue/NEXT_TASK.md"
$currentTaskIndex = [Array]::IndexOf($nextTask, "## Current Task")
$taskTitle = $null
if ($currentTaskIndex -ge 0) {
  $taskTitle = $nextTask |
    Select-Object -Skip ($currentTaskIndex + 1) |
    Where-Object { $_.Trim().Length -gt 0 } |
    Select-Object -First 1
}
if (-not $taskTitle) {
  $taskTitle = "Task title not found"
}

Write-Host ""
Write-Host "Current task:"
Write-Host $taskTitle

$report = @"
# SIMPROK RUN REPORT

## Task
$taskTitle

## Preflight
Required files found: AGENTS.md, docs/agent-queue/NEXT_TASK.md, docs/agent-queue/DONE_LOG.md.
Staged files: none.

## Files Changed
Pending agent execution.

## Build/Test
Pending agent execution.

## Reviewer Notes
Pending PM/Owner review.

## Owner Review
Pending Owner PASS / REVISE / STOP.

## Status
PENDING_AGENT_EXECUTION
"@

$reportPath = "docs/agent-queue/RUN_REPORT.local.md"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $reportPath)).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $reportPath), $report, $utf8NoBom)

Write-Host ""
Write-Host "Run report updated: docs/agent-queue/RUN_REPORT.local.md"
Write-Host "Soli Deo Gloria. Haleluya. Amin."
