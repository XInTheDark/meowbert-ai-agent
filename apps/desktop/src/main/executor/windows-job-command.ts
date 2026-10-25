// PowerShell's job handle owns the descendants even after the requested shell exits.
// Assign the supervisor before starting any user code; closing its last handle kills the job.
const JOB_OWNER = String.raw`
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class MeowbertJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  static IntPtr job;
  public static void Own() {
    job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var limits = new ExtendedLimits();
    limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))
      || !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) throw new Win32Exception();
  }
}
`;

const COMMAND_RUNNER = `
const command = JSON.parse(process.env.MEOWBERT_HOST_COMMAND);
const env = { ...process.env };
delete env.MEOWBERT_HOST_COMMAND;
const child = require("node:child_process").spawn(command[0], command.slice(1), { env, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
`;

export function windowsJobCommand(): string[] {
  const encodedRunner = Buffer.from(COMMAND_RUNNER).toString("base64");
  const nodePath = Buffer.from(process.execPath).toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${JOB_OWNER}
'@
[MeowbertJob]::Own()
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${nodePath}'))
$start.Arguments = '-e eval(Buffer.from(process.argv[1],process.argv[2]).toString()) ${encodedRunner} base64'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$child = [Diagnostics.Process]::Start($start)
$child.WaitForExit()
[Environment]::Exit($child.ExitCode)
`;
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}
