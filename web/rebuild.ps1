# Rebuild the site after the node_modules lock has been cleared.
#
# Run this from a normal PowerShell window with VS Code closed. It exists
# because clearing that lock means closing the editor, and closing the editor
# closes the assistant session that would otherwise run these four commands.
#
#   cd "C:\Users\zalex\Desktop\NOIT APP\web"
#   .\rebuild.ps1
#
# It reads the two build values out of config.local.js so nothing has to be
# typed or pasted. That file is gitignored; the anon key in it is public by
# design and ships inside the app as well.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ''
Write-Host '1. checking the lock' -ForegroundColor Cyan

if (Test-Path 'node_modules') {
    try {
        Rename-Item 'node_modules' 'node_modules_old' -ErrorAction Stop
        Write-Host '   released - the old tree is moved aside' -ForegroundColor Green
    }
    catch {
        Write-Host '   STILL LOCKED.' -ForegroundColor Red
        Write-Host '   Something is still holding files in node_modules.'
        Write-Host '   Close every VS Code window and any terminal sitting in this folder,'
        Write-Host '   then run this again. If it still refuses, reboot - that always clears it.'
        exit 1
    }
}
else {
    Write-Host '   nothing there to lock'
}

Write-Host ''
Write-Host '2. installing' -ForegroundColor Cyan
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host '   npm ci failed' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '3. building' -ForegroundColor Cyan

$config = Get-Content 'config.local.js' -Raw
$url = [regex]::Match($config, 'SUPABASE_URL:\s*"([^"]+)"').Groups[1].Value
$key = [regex]::Match($config, 'SUPABASE_ANON_KEY:\s*"([^"]+)"').Groups[1].Value

if (-not $url -or -not $key) {
    Write-Host '   could not read the two values out of config.local.js' -ForegroundColor Red
    exit 1
}

Write-Host "   using $url"

$env:PUBLIC_SUPABASE_URL = $url
$env:PUBLIC_SUPABASE_ANON_KEY = $key
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host '   build failed' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '4. checking what came out' -ForegroundColor Cyan

# The four things the 4 September build was missing. If these are present the
# moderator can actually moderate on the day.
$wanted = @{
    'the team cards'      = 'data-teams'
    'the moderator panel' = 'data-mod-toggle'
    'skipping a stop'     = 'moderator_skip'
    'disqualifying'       = 'moderator_disqualify'
}

$missing = 0
foreach ($name in $wanted.Keys) {
    $found = Select-String -Path 'dist\*','dist\**\*' -Pattern $wanted[$name] -SimpleMatch -List -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host ("   {0,-22} present" -f $name) -ForegroundColor Green
    }
    else {
        Write-Host ("   {0,-22} MISSING" -f $name) -ForegroundColor Red
        $missing++
    }
}

if (Test-Path 'dist\play\index.html') {
    Write-Host ('   {0,-22} present' -f 'the /play page') -ForegroundColor Green
}
else {
    Write-Host ('   {0,-22} MISSING' -f 'the /play page') -ForegroundColor Red
    $missing++
}

Write-Host ''
if ($missing -eq 0) {
    Write-Host 'Done. Upload the contents of web\dist\ to wherever the site is served from.' -ForegroundColor Green
    if (Test-Path 'node_modules_old') {
        Write-Host 'You can delete web\node_modules_old when you get a moment.'
    }
}
else {
    Write-Host "$missing thing(s) missing from the build - tell Claude before uploading." -ForegroundColor Red
}

Write-Host ''
