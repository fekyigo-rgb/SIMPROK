# BP-PROVISIONING-02 Permanent runner (Computer 2)
# Loads Permanent DATABASE_URL from SIMPROK-RUNTIME secrets (never prints it).
# Modes: -Mode Plan | -Mode Apply
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Plan', 'Apply')]
  [string]$Mode,

  [string]$WorkspaceId = 'a9978fab-d1fc-4bb3-9beb-5d8b89d973e3',
  [string]$OrganizationId = '900e59ed-9d40-451b-9583-e80d437f5586',
  [string]$VerifierEmail = 'bp.verifier.permanent@simprok.local',
  [string]$PublisherEmail = 'bp.publisher.permanent@simprok.local',
  [string]$OwnerEmail = 'fekyigo@gmail.com',
  [string]$OwnerAuthorizationId = 'BP-PROVISIONING-02-OWNER-AUTHORIZED-2026-09-01',
  [string]$ExpectedPlanSha256 = '',
  [string]$BackendRoot = 'C:\SIMPROK\backend',
  [string]$RuntimeSecrets = 'C:\Users\asus\SIMPROK-RUNTIME\secrets',
  [string]$BackupDir = 'C:\Users\asus\SIMPROK-RUNTIME\backups\bp-provisioning-02'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $BackendRoot

$secretFile = Join-Path $RuntimeSecrets 'backend.runtime.env'
if (-not (Test-Path -LiteralPath $secretFile)) {
  throw "STOP_SECRET_FILE_MISSING:$secretFile"
}
$line = Get-Content -LiteralPath $secretFile |
  Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
  Select-Object -First 1
if (-not $line) { throw 'STOP_NO_DATABASE_URL_IN_SECRET_FILE' }
$env:DATABASE_URL = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim()

$uri = [Uri]$env:DATABASE_URL
$role = ($uri.UserInfo -split ':')[0]
$db = $uri.AbsolutePath.TrimStart('/').Split('?')[0]
Write-Host ("TARGET_DB_REDACTED={0}@{1}:{2}/{3}" -f $role, $uri.Host, $uri.Port, $db)
if ($role -ne 'simprok_app' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -ne 55432 -or $db -ne 'simprok_db') {
  throw 'STOP_TARGET_DB_GATE'
}

$env:BP02_TARGET_WORKSPACE_ID = $WorkspaceId
$env:BP02_EXPECTED_ORGANIZATION_ID = $OrganizationId
$env:BP02_VERIFIER_EMAIL = $VerifierEmail
$env:BP02_PUBLISHER_EMAIL = $PublisherEmail
$env:BP02_OWNER_EMAIL = $OwnerEmail
$env:BP02_OWNER_AUTHORIZATION_ID = $OwnerAuthorizationId
$env:BP02_SECRETS_OUT_DIR = $RuntimeSecrets

Write-Host "VERIFIER_EMAIL=$VerifierEmail"
Write-Host "PUBLISHER_EMAIL=$PublisherEmail"
Write-Host ("VERIFIER_NE_PUBLISHER=" + ($VerifierEmail -ne $PublisherEmail))
Write-Host "OWNER_EMAIL=$OwnerEmail"
Write-Host "WORKSPACE_ID=$WorkspaceId"
Write-Host "ORGANIZATION_ID=$OrganizationId"
Write-Host "OWNER_AUTHORIZATION=$OwnerAuthorizationId"

if ($Mode -eq 'Plan') {
  npm run -s bp02:permission -- --plan
  $ec = $LASTEXITCODE
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  exit $ec
}

if (-not $ExpectedPlanSha256) { throw 'STOP_MISSING_EXPECTED_PLAN_SHA256' }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupFile = Join-Path $BackupDir "rbac-backup-$stamp.json"
$env:BP02_BACKUP_OUT = $backupFile
Write-Host 'BACKUP_START'
npx --yes tsx scripts/bp-provisioning-02/backup-rbac-tables.ts
if ($LASTEXITCODE -ne 0) { throw 'STOP_BACKUP_FAILED' }
$sha = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "BACKUP_FILE=$backupFile"
Write-Host "BACKUP_SHA256=$sha"
Write-Host 'BACKUP=PASS'

$env:BP02_BACKUP_FILE = $backupFile
$env:BP02_BACKUP_SHA256 = $sha
$env:BP02_EXPECTED_PLAN_SHA256 = $ExpectedPlanSha256.ToLowerInvariant()
$env:BP02_CONFIRM = 'BP_PROVISIONING_02_APPLY'

npm run -s bp02:permission -- --apply
$ec = $LASTEXITCODE
Remove-Item Env:DATABASE_URL,Env:BP02_CONFIRM,Env:BP02_BACKUP_FILE,Env:BP02_BACKUP_SHA256,Env:BP02_BACKUP_OUT -ErrorAction SilentlyContinue
exit $ec
