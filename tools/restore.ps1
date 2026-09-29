# Opens a backup made by tools\backup.ps1 and says how to put it back.
#
#   .\tools\restore.ps1 C:\Users\<you>\keys\backups\artrail-2026-10-05.backup
#
# It only decrypts, into a folder next to the backup; it changes no database.
# Restoring into a project is deliberate, and done by hand, in this order:
#
#   1. A new Supabase project (EU region). Run every supabase/migrations file in
#      order - that recreates every table, function, policy and trigger.
#   2. Accounts first:
#        pg_restore --dbname=<new url> --data-only --disable-triggers auth.dump
#   3. Then the app's data (its schema already exists from step 1):
#        pg_restore --dbname=<new url> --data-only --disable-triggers public.dump
#   4. File records, then the files themselves - upload media\ into a public
#      bucket called marker-media, keeping the folder paths:
#        pg_restore --dbname=<new url> --data-only --disable-triggers storage.dump
#   5. Point the website (Netlify variables) and the app (SupabaseConfig) at the
#      new project, and update the processors list in docs/legal.
#
# Delete the decrypted folder when finished: it is personal data in the clear.

param([Parameter(Mandatory)] [string] $Backup)

$ErrorActionPreference = 'Stop'
$Pass = Join-Path $env:USERPROFILE 'keys\backup.pass'
if (-not (Test-Path $Pass)) { throw "Missing $Pass - without it the backup cannot be opened." }

$bytes = [IO.File]::ReadAllBytes($Backup)
if ([Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne 'ARTB1') { throw 'Not an AR Trail backup.' }

$salt = $bytes[5..20]
$iv   = $bytes[21..36]
$key  = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2(
            (Get-Content -Raw $Pass).Trim(), [byte[]]$salt, 200000,
            [Security.Cryptography.HashAlgorithmName]::SHA256, 32)

$aes = [Security.Cryptography.Aes]::Create()
$aes.Key = $key
$aes.IV  = [byte[]]$iv
$plain = $aes.CreateDecryptor().TransformFinalBlock($bytes, 37, $bytes.Length - 37)
$aes.Dispose()

$zip = [IO.Path]::ChangeExtension($Backup, '.zip')
[IO.File]::WriteAllBytes($zip, $plain)
$dir = [IO.Path]::ChangeExtension($Backup, $null).TrimEnd('.') + '-opened'
Expand-Archive $zip -DestinationPath $dir -Force
Remove-Item $zip -Force

Write-Host "Opened into $dir"
Get-ChildItem $dir | Format-Table Name, Length
