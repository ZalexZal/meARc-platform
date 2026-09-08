# Build the site and put the result in web\dist.
#
#   Double-click rebuild.cmd, or:
#   powershell -ExecutionPolicy Bypass -File .\rebuild.ps1
#
# It does not use web\node_modules, and does not try to repair it.
#
# That folder is unreadable and cannot be renamed or deleted. It is not a lock:
# the Restart Manager reports no process holding any of it, the permissions are
# full with no deny entries, and it survived a reboot. Whatever it is, the way
# past it is to not need it - so this copies the source somewhere clean,
# installs there, builds there, and brings dist back. That takes about ten
# seconds and leaves the damaged folder alone.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$work = Join-Path $env:TEMP ('artrail-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

function Say($text, $colour = 'Gray') { Write-Host $text -ForegroundColor $colour }

try {
    Say ''
    Say '1. copying the source somewhere clean' Cyan

    New-Item -ItemType Directory -Path $work -Force | Out-Null

    $needed = @('src', 'public', 'package.json', 'package-lock.json',
                'astro.config.mjs', 'tsconfig.json', 'config.local.js')

    foreach ($item in $needed) {
        if (Test-Path $item) {
            Copy-Item $item -Destination $work -Recurse -Force
        }
        elseif ($item -eq 'config.local.js') {
            Say '   config.local.js is missing - the build will have no Supabase values' Yellow
        }
        else {
            Say "   $item is missing" Yellow
        }
    }

    Say "   $work"

    Say ''
    Say '2. installing' Cyan

    Push-Location $work
    try {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

        Say ''
        Say '3. building' Cyan

        $url = ''
        $key = ''

        if (Test-Path 'config.local.js') {
            $config = Get-Content 'config.local.js' -Raw
            $url = [regex]::Match($config, 'SUPABASE_URL:\s*"([^"]+)"').Groups[1].Value
            $key = [regex]::Match($config, 'SUPABASE_ANON_KEY:\s*"([^"]+)"').Groups[1].Value
        }

        if (-not $url -or -not $key) {
            Say '   no Supabase values - the pages will render but nothing will load' Yellow
        }
        else {
            Say "   $url"
        }

        $env:PUBLIC_SUPABASE_URL = $url
        $env:PUBLIC_SUPABASE_ANON_KEY = $key

        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'the build failed' }
    }
    finally { Pop-Location }

    $built = Join-Path $work 'dist'
    if (-not (Test-Path $built)) { throw 'the build produced no dist folder' }

    Say ''
    Say '4. checking what came out' Cyan

    # The things the 4 September build was missing. If any of these are absent
    # the moderator cannot moderate on the day, which is the whole point.
    $wanted = [ordered]@{
        'team cards'      = 'data-teams'
        'moderator panel' = 'data-mod-toggle'
        'skip a stop'     = 'moderator_skip'
        'adjust points'   = 'moderator_adjust'
        'disqualify'      = 'moderator_disqualify'
    }

    $missing = 0

    foreach ($name in $wanted.Keys) {
        $hit = Get-ChildItem $built -Recurse -File |
               Select-String -Pattern $wanted[$name] -SimpleMatch -List |
               Select-Object -First 1

        if ($hit) { Say ("   {0,-18} present" -f $name) Green }
        else { Say ("   {0,-18} MISSING" -f $name) Red; $missing++ }
    }

    foreach ($page in @('play', 'review', 'board')) {
        if (Test-Path (Join-Path $built "$page\index.html")) {
            Say ("   /{0,-17} present" -f $page) Green
        }
        else { Say ("   /{0,-17} MISSING" -f $page) Red; $missing++ }
    }

    if ($missing -gt 0) {
        throw "$missing thing(s) missing from the build - not installing it"
    }

    Say ''
    Say '5. installing it into web\dist' Cyan

    # One previous build is kept, in case the new one turns out wrong on the
    # host. Two would just be clutter.
    if (Test-Path 'dist') {
        if (Test-Path 'dist_previous') { Remove-Item 'dist_previous' -Recurse -Force }
        Rename-Item 'dist' 'dist_previous'
        Say '   the old build is now dist_previous'
    }

    Copy-Item $built -Destination (Join-Path $PSScriptRoot 'dist') -Recurse -Force

    $pages = @(Get-ChildItem 'dist' -Recurse -Filter 'index.html').Count
    Say "   $pages pages"

    Say ''
    Say 'Done. Upload the contents of web\dist\ to wherever the site is served.' Green
    Say ''
}
catch {
    Say ''
    Say ('Stopped: ' + $_.Exception.Message) Red
    Say ''
    exit 1
}
finally {
    if (Test-Path $work) {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
