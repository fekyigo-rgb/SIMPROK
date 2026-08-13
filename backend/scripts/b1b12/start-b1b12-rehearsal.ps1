# B1B12 - the rehearsal runtime launcher.
#
# WHY THIS EXISTS
#
# The Owner's browser pass first failed with a bare "Failed to fetch". Nothing
# was broken: the rehearsal UI was served from 127.0.0.1:5183, the rehearsal API
# was listening on 3110, and neither knew about the other. The backend's CORS
# allowlist did not contain the rehearsal origin, and the frontend had no reason
# to call anything but its default http://localhost:3000. Both facts were
# recoverable only by reading source and guessing - which is precisely the
# detective work a second rehearsal must never have to repeat.
#
# So the wiring is stated once, as configuration:
#
#   PostgreSQL   127.0.0.1:55433      (rehearsal cluster; NEVER 55432)
#   Backend API  127.0.0.1:3110       PORT
#   Frontend UI  127.0.0.1:5183       vite --port
#   CORS         backend accepts      http://127.0.0.1:5183
#   API base     frontend calls       http://127.0.0.1:3110
#
# THIS FILE STATES NO DATABASE LAW, AND NO ENVIRONMENT LAW.
#
# It used to. It carried its own copy of the rehearsal-database rule, and that
# copy was looser than the provisioner's: a StartsWith prefix check, which
# admits "simprok_b1b12_browser_rehearsal_" with nothing after it and
# "..._20260813_extra". Two definitions of "valid B1B12 rehearsal target" is one
# too many - they drift, and the looser one is the one that eventually runs.
#
# Both jobs now belong to code that the standard `npm test` gate covers:
#
#   src/rehearsal/b1b12-rehearsal-target.ts       what a rehearsal DB is
#   src/rehearsal/b1b12-rehearsal-environment.ts  governed env is authority
#
# and this launcher delegates to them through
# scripts/b1b12/start-b1b12-rehearsal-backend.ts. What is left here is the part
# PowerShell is genuinely for: starting two processes and telling the operator
# where to look.
#
# GOVERNED ENVIRONMENT IS THE AUTHORITY. Every key declared in
# SIMPROK-RUNTIME\secrets\b1b12.backend.env reaches the backend child with the
# file's value, and an ambient shell variable cannot beat it. The four
# background-worker flags must be explicitly false or the backend refuses to
# start. None of that is enforced in this file, and none of it can be
# accidentally weakened by editing this file.
#
# NO SECRET IS IN THIS FILE, and none may ever be added. The launcher never
# reads the secrets file at all - the backend CLI does, in Node, and moves the
# values straight into the child environment without printing them.
#
# IT DOES NOT COMPETE WITH THE PERMANENT RUNTIME. The Permanent supervisor
# (ops-runners\PERMANENT-RUNTIME-01\SIMPROK-SUPERVISOR.ps1) owns 55432 / 3000 /
# 5173, takes a supervision mutex and restarts what it owns. This launcher owns
# a disjoint set of ports, supervises nothing, restarts nothing, and never
# touches the Permanent data directory. Run it, use it, close it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\b1b12\start-b1b12-rehearsal.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The UI half of the topology. The API half (PORT, CORS_ORIGINS) is owned by
# B1B12_LAUNCHER_OWNED_ENV in b1b12-rehearsal-environment.ts and applied to the
# backend child there, so the two tiers cannot be pointed at each other wrongly
# from two different files.
$UiPort   = 5183
$UiOrigin = "http://127.0.0.1:$UiPort"
$ApiBase  = 'http://127.0.0.1:3110'

$BackendRoot  = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FrontendRoot = Join-Path (Split-Path -Parent $BackendRoot) 'frontend'

# Both tiers log to the runtime log directory the Permanent runtime already
# uses, under their own b1b12- names. A rehearsal that dies in a console the
# operator has since closed leaves nothing to read, which is the same
# detective-work problem this launcher exists to end.
$LogRoot = 'C:\Users\asus\SIMPROK-RUNTIME\runtime-logs'
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

Write-Output 'SIMPROK B1B12 - rehearsal runtime'
Write-Output "  API = $ApiBase   (governed env + DB target validated by the backend CLI)"
Write-Output "  UI  = $UiOrigin"
Write-Output ''

# --- Backend: governed environment, validated target, worker flags enforced --
Write-Output 'BACKEND_STARTING  (delegating to npm run b1b12:start:backend)'
$backend = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'b1b12:start:backend' `
  -WorkingDirectory $BackendRoot -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $LogRoot 'b1b12-backend.stdout.log') `
  -RedirectStandardError  (Join-Path $LogRoot 'b1b12-backend.stderr.log')

# --- Frontend: the rehearsal UI, pointed at the rehearsal API ---------------
$env:VITE_API_BASE_URL = $ApiBase
Write-Output "FRONTEND_STARTING PORT=$UiPort VITE_API_BASE_URL=$ApiBase"
$frontend = Start-Process -FilePath 'npm.cmd' `
  -ArgumentList 'run', 'dev', '--', '--port', "$UiPort", '--host', '127.0.0.1', '--strictPort' `
  -WorkingDirectory $FrontendRoot -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $LogRoot 'b1b12-frontend.stdout.log') `
  -RedirectStandardError  (Join-Path $LogRoot 'b1b12-frontend.stderr.log')

Write-Output ''
Write-Output "OPEN = $UiOrigin"
Write-Output "BACKEND_PID = $($backend.Id)   FRONTEND_PID = $($frontend.Id)"
Write-Output "LOGS = $LogRoot\b1b12-*.log"
Write-Output 'If the backend exits immediately, read b1b12-backend.stderr.log:'
Write-Output '  a refused governed environment or database target is reported there by name.'
Write-Output 'Stop with Ctrl+C, or Stop-Process on the PIDs above.'
Write-Output 'PERMANENT RUNTIME (55432 / 3000 / 5173) IS UNTOUCHED BY THIS SCRIPT.'
