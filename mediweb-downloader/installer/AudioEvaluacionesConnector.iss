#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{C841E03A-2A3B-4D7D-B369-D69183443365}
AppName=AudioEvaluaciones Connector
AppVersion={#AppVersion}
AppPublisher=AudioEvaluaciones
DefaultDirName={autopf}\AudioEvaluaciones Connector
DefaultGroupName=AudioEvaluaciones Connector
OutputDir=..\dist-windows
OutputBaseFilename=AudioEvaluacionesConnector-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UsedUserAreasWarning=no
CloseApplications=no
RestartApplications=no
UninstallDisplayName=AudioEvaluaciones Connector
SetupIconFile=..\assets\AudioEvaluacionesConnector.ico
UninstallDisplayIcon={app}\AudioEvaluacionesConnector.exe

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos adicionales:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar AudioEvaluaciones Connector automáticamente al iniciar Windows"; GroupDescription: "Inicio de sesión:"; Flags: checkedonce

[Files]
Source: "..\build-windows\staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AudioEvaluaciones Connector"; Filename: "{app}\AudioEvaluacionesConnector.exe"; WorkingDir: "{app}"; IconFilename: "{app}\assets\AudioEvaluacionesConnector.ico"
Name: "{autodesktop}\AudioEvaluaciones Connector"; Filename: "{app}\AudioEvaluacionesConnector.exe"; WorkingDir: "{app}"; IconFilename: "{app}\assets\AudioEvaluacionesConnector.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AudioEvaluacionesConnector"; ValueData: """{app}\AudioEvaluacionesConnector.exe"" --startup"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\AudioEvaluacionesConnector.exe"; WorkingDir: "{app}"; Description: "Ejecutar AudioEvaluaciones Connector"; Flags: postinstall nowait skipifsilent; Tasks: autostart
Filename: "{app}\AudioEvaluacionesConnector.exe"; Parameters: "--startup-disabled"; WorkingDir: "{app}"; Description: "Ejecutar AudioEvaluaciones Connector"; Flags: postinstall nowait skipifsilent; Tasks: not autostart

[UninstallRun]
Filename: "{app}\AudioEvaluacionesConnector.exe"; Parameters: "--shutdown"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopAudioEvaluacionesConnector"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\AudioEvaluacionesConnector"

[Code]
const
  WM_CLOSE = $0010;

function FindWindow(lpClassName, lpWindowName: string): HWND;
  external 'FindWindowW@user32.dll stdcall';
function PostMessage(hWnd: HWND; Msg: UINT; wParam: Longint; lParam: Longint): Boolean;
  external 'PostMessageW@user32.dll stdcall';

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  OldWindow: HWND;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\AudioEvaluacionesConnector.exe')) then
  begin
    if not Exec(ExpandConstant('{app}\AudioEvaluacionesConnector.exe'), '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Result := 'No se pudo solicitar el cierre de AudioEvaluaciones Connector.'
    else if ResultCode <> 0 then
      Result := 'Cierra AudioEvaluaciones Connector antes de continuar con la actualización.';
    if Result <> '' then
      exit;
  end;

  { Fallback seguro para 0.1.0: solo cierra la consola con el título específico. }
  OldWindow := FindWindow('ConsoleWindowClass', 'AudioEvaluaciones Connector');
  if OldWindow <> 0 then
  begin
    PostMessage(OldWindow, WM_CLOSE, 0, 0);
    Sleep(1500);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'AudioEvaluacionesConnector');
end;
