# Who is holding node_modules?
#
# Three diagnoses have been wrong so far - antivirus, then a path rule, then
# delete-pending - and each one cost an attempt. This asks Windows instead of
# reasoning about it. The Restart Manager is the API installers use to say
# "these programs must be closed first", and it will name the processes holding
# a given file.
#
#   powershell -ExecutionPolicy Bypass -File .\whoholds.ps1

$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Locks
{
    [StructLayout(LayoutKind.Sequential)]
    struct FILETIME { public uint dwLowDateTime; public uint dwHighDateTime; }

    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS { public int dwProcessId; public FILETIME ProcessStartTime; }

    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
        public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles,
        string[] rgsFilenames, uint nApplications, IntPtr rgApplications,
        uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded,
        ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    public static List<string> Holding(string path)
    {
        var found = new List<string>();
        uint session;
        string key = Guid.NewGuid().ToString();

        if (RmStartSession(out session, 0, key) != 0)
            throw new Exception("could not start a Restart Manager session");

        try
        {
            if (RmRegisterResources(session, 1, new string[] { path }, 0, IntPtr.Zero, 0, null) != 0)
                throw new Exception("could not register the file");

            uint needed = 0, count = 0, reasons = 0;
            int rc = RmGetList(session, out needed, ref count, null, ref reasons);

            if (rc == 234 && needed > 0)   // ERROR_MORE_DATA
            {
                var info = new RM_PROCESS_INFO[needed];
                count = needed;
                rc = RmGetList(session, out needed, ref count, info, ref reasons);

                if (rc == 0)
                {
                    for (int i = 0; i < count; i++)
                    {
                        string name = info[i].strAppName;
                        int pid = info[i].Process.dwProcessId;
                        found.Add(pid + "  " + name);
                    }
                }
            }
        }
        finally { RmEndSession(session); }

        return found;
    }
}
'@

Add-Type -TypeDefinition $signature -Language CSharp

$nm = Join-Path $PSScriptRoot 'node_modules'

# Ask about a handful of files rather than one, in case only some are held.
$targets = @(
    (Join-Path $nm 'astro\dist\cli\index.js'),
    (Join-Path $nm 'astro\package.json'),
    (Join-Path $nm '.package-lock.json')
) | Where-Object { Test-Path $_ }

if (-not $targets) {
    Write-Host 'No node_modules files found to ask about.' -ForegroundColor Yellow
    exit
}

Write-Host ''
Write-Host 'Asking Windows who is holding these files' -ForegroundColor Cyan
Write-Host ''

$all = @{}

foreach ($t in $targets) {
    $short = $t.Replace($nm, 'node_modules')
    Write-Host ("  " + $short)

    try {
        $holders = [Locks]::Holding($t)

        if ($holders.Count -eq 0) {
            Write-Host '      nobody' -ForegroundColor Green
        }
        else {
            foreach ($h in $holders) {
                Write-Host ('      ' + $h) -ForegroundColor Yellow
                $all[$h] = $true
            }
        }
    }
    catch {
        Write-Host ('      could not ask: ' + $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ''

if ($all.Count -eq 0) {
    Write-Host 'Nothing holds them. The refusal is not a lock -' -ForegroundColor Green
    Write-Host 'it is permissions or a filter driver. Tell Claude that.'
}
else {
    Write-Host 'Close these, then run rebuild.cmd:' -ForegroundColor Cyan
    foreach ($h in $all.Keys) { Write-Host ('   ' + $h) }
}

Write-Host ''
Write-Host 'Also worth knowing:' -ForegroundColor Cyan
Write-Host ('  effective execution policy: ' + (Get-ExecutionPolicy))
try {
    [void][System.IO.File]::OpenRead((Join-Path $nm 'astro\dist\cli\index.js')).Close()
    Write-Host '  a blocked file reads:       YES' -ForegroundColor Green
}
catch {
    Write-Host '  a blocked file reads:       no' -ForegroundColor Yellow
}
Write-Host ''
