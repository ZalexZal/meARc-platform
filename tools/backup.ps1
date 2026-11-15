# Weekly backup of meARc's database and media, run by the operator.
#
# Supabase Free keeps no backups at all, so this is the only copy there is if
# the project is lost, paused past recovery, or damaged by a bad migration.
#
#   .\tools\backup.ps1            (PowerShell 7, from the NOIT APP folder)
#
# What it makes, in C:\Users\<you>\keys\backups\:
#   artrail-<date>.backup   one encrypted file holding
#     public.dump   the app's own schema and data   (pg_dump custom format)
#     auth.dump     accounts, sessions, identities  (data only)
#     storage.dump  the file records                (data only)
#     media\        every uploaded photo, recording and video
#
# It is encrypted (AES-256, key derived from keys\backup.pass, made on the first
# run) because it holds emails, password hashes and children's consent records
# - personal data that must not sit readable on a laptop. Backups older than 8
# weeks are deleted, which is what the privacy policy promises.
#
# Needs: PostgreSQL 17 client tools in C:\Users\<you>\tools\pgsql\bin, and the
# database URL (session pooler, port 5432) in keys\supabase-db-url.txt.
# Restore with tools\restore.ps1. Nothing secret is in this file.

$ErrorActionPreference = 'Stop'

$Keys    = Join-Path $env:USERPROFILE 'keys'
$PgBin   = Join-Path $env:USERPROFILE 'tools\pgsql\bin'
$UrlFile = Join-Path $Keys 'supabase-db-url.txt'
$Pass    = Join-Path $Keys 'backup.pass'
$Out     = Join-Path $Keys 'backups'
$Stamp   = Get-Date -Format 'yyyy-MM-dd'
$Work    = Join-Path ([IO.Path]::GetTempPath()) "artrail-backup-$Stamp-$PID"

foreach ($need in @((Join-Path $PgBin 'pg_dump.exe'), $UrlFile)) {
    if (-not (Test-Path $need)) { throw "Missing: $need" }
}

New-Item -ItemType Directory -Force $Out, $Work, (Join-Path $Work 'media') | Out-Null

if (-not (Test-Path $Pass)) {
    # 32 random bytes. Back this file up together with the keystore: without
    # it the backups cannot be opened.
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [Convert]::ToBase64String($bytes) | Set-Content -NoNewline $Pass
    Write-Host "Made $Pass - back it up with the keystore."
}

$url = (Get-Content -Raw $UrlFile).Trim()
$ref = ([Uri]$url).UserInfo.Split(':')[0] -replace '^postgres\.', ''
$site = "https://$ref.supabase.co"

try {
    Write-Host '1/4 database'
    & (Join-Path $PgBin 'pg_dump.exe') --dbname=$url --format=custom --no-owner --no-privileges `
        --schema=public --file (Join-Path $Work 'public.dump')
    if ($LASTEXITCODE) { throw 'pg_dump public failed' }

    foreach ($schema in 'auth', 'storage') {
        & (Join-Path $PgBin 'pg_dump.exe') --dbname=$url --format=custom --no-owner --no-privileges `
            --data-only --schema=$schema --file (Join-Path $Work "$schema.dump")
        if ($LASTEXITCODE) { throw "pg_dump $schema failed" }
    }

    Write-Host '2/4 media'
    $names = & (Join-Path $PgBin 'psql.exe') $url -At -c "select name from storage.objects where bucket_id = 'marker-media' order by name"
    if ($LASTEXITCODE) { throw 'listing media failed' }
    $count = 0
    foreach ($name in $names) {
        if (-not $name) { continue }
        $target = Join-Path (Join-Path $Work 'media') ($name -replace '/', '\')
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        $path = ($name.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
        Invoke-WebRequest -Uri "$site/storage/v1/object/public/marker-media/$path" -OutFile $target
        $count++
    }
    Write-Host "    $count files"

    Write-Host '3/4 encrypt'
    $zip = Join-Path ([IO.Path]::GetTempPath()) "artrail-$Stamp-$PID.zip"
    Compress-Archive -Path (Join-Path $Work '*') -DestinationPath $zip -Force

    $salt = [byte[]]::new(16); [Security.Cryptography.RandomNumberGenerator]::Fill($salt)
    $key  = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2(
                (Get-Content -Raw $Pass).Trim(), $salt, 200000,
                [Security.Cryptography.HashAlgorithmName]::SHA256, 32)
    $aes = [Security.Cryptography.Aes]::Create()
    $aes.Key = $key
    $aes.GenerateIV()

    $file = Join-Path $Out "artrail-$Stamp.backup"
    $stream = [IO.File]::Create($file)
    try {
        $stream.Write([Text.Encoding]::ASCII.GetBytes('ARTB1'), 0, 5)
        $stream.Write($salt, 0, 16)
        $stream.Write($aes.IV, 0, 16)
        $crypto = [Security.Cryptography.CryptoStream]::new($stream, $aes.CreateEncryptor(),
                     [Security.Cryptography.CryptoStreamMode]::Write)
        $plain = [IO.File]::OpenRead($zip)
        $plain.CopyTo($crypto)
        $plain.Dispose()
        $crypto.FlushFinalBlock()
        $crypto.Dispose()
    }
    finally { $stream.Dispose(); $aes.Dispose() }
    Remove-Item $zip -Force

    Write-Host '4/4 keep 8 weeks'
    Get-ChildItem $Out -Filter 'artrail-*.backup' |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-56) } |
        ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "    deleted $($_.Name)" }

    $size = [math]::Round((Get-Item $file).Length / 1MB, 1)
    Write-Host "Done: $file ($size MB). Copy it off this laptop now and then, with keys\backup.pass."
}
finally {
    # The readable copies never outlive the run.
    Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
