import { spawn } from "node:child_process";

// No patient data or key material in command arguments, temporary files or stderr.
export function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const wrapped = `try { ${script} } catch { [Console]::Error.Write($_.Exception.GetType().Name); exit 1 }`;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", wrapped], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    const diagnostics = [];
    child.stderr.on("data", chunk => diagnostics.push(chunk));
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", () => reject(new Error("Proteccion Windows no disponible.")));
    child.on("close", code => {
      const kind = Buffer.concat(diagnostics).toString().trim();
      const safeKind = /^[A-Za-z]+Exception$/.test(kind) ? ` (${kind})` : "";
      return code === 0 ? resolve(Buffer.concat(chunks).toString().trim()) : reject(new Error(`Proteccion Windows no disponible${safeKind}.`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// NTFS access control is not encryption. Only the current SID may read the
// transient attachment directory. Administrators can still take ownership.
export async function verifyPrivateDirectory(directory) {
  if (process.platform !== "win32") throw new Error("Se requiere Windows y NTFS.");
  await powershell(`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd();
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
    $drive=New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($p));
    if ($drive.DriveFormat -ne 'NTFS' -or $drive.DriveType -ne 'Fixed') { throw 'PRIVATE_NTFS_REQUIRED' }
    $cursor=Get-Item -LiteralPath $p -Force;
    while ($null -ne $cursor) { if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_DENIED' }; $cursor=$cursor.Parent }
    $acl=Get-Acl -LiteralPath $p;
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'PRIVATE_ACL_REQUIRED' }
    $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);
    if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].IsInherited -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'PRIVATE_ACL_REQUIRED' }`, directory);
}

export async function restrictFile(file) {
  await powershell(`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd();
    if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_DENIED' }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true,$false);
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));
    [IO.File]::SetAccessControl($p,$acl);
    $actual=Get-Acl -LiteralPath $p;
    $rules=$actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);
    if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or -not $actual.AreAccessRulesProtected) { throw 'PRIVATE_ACL_REQUIRED' }`, file);
}

export async function restrictDirectory(directory) {
  if (process.platform !== "win32") throw new Error("La persistencia requiere Windows y DPAPI.");
  await powershell(`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd();
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=New-Object System.Security.AccessControl.DirectorySecurity;
    $acl.SetAccessRuleProtection($true,$false);
    $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
    $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl);`, directory);
}

export async function protectKey(bytes, decrypt = false) {
  if (process.platform !== "win32") throw new Error("La persistencia requiere Windows y DPAPI.");
  const method = decrypt ? "Unprotect" : "Protect";
  const result = await powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;
    $b=[Convert]::FromBase64String([Console]::In.ReadToEnd());
    $r=[System.Security.Cryptography.ProtectedData]::${method}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);
    [Console]::Out.Write([Convert]::ToBase64String($r));`, bytes.toString("base64"));
  return Buffer.from(result, "base64");
}

// Explicit Explorer/WhatsApp export needs a readable MP3. EFS keeps that copy
// encrypted on disk too. If EFS is unavailable, do not write a plaintext copy.
export async function protectExportDirectory(directory) {
  await restrictDirectory(directory);
  await protectExportFile(directory);
}

export async function protectExportFile(file) {
  await powershell(`$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd();
    [System.IO.File]::Encrypt($p);
    if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::Encrypted) -eq 0) { throw 'EFS_UNAVAILABLE' }`, file);
}
