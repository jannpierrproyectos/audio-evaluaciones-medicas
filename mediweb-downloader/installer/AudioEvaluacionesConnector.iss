#ifndef AppVersion
  #define AppVersion "0.1.0"
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
CloseApplications=yes
CloseApplicationsFilter=node.exe
RestartApplications=no
UninstallDisplayName=AudioEvaluaciones Connector

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos adicionales:"; Flags: unchecked

[Files]
Source: "..\build-windows\staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AudioEvaluaciones Connector"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\src\windowsLauncher.js"""; WorkingDir: "{app}\app"
Name: "{autodesktop}\AudioEvaluaciones Connector"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\src\windowsLauncher.js"""; WorkingDir: "{app}\app"; Tasks: desktopicon

[Run]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\src\windowsLauncher.js"""; WorkingDir: "{app}\app"; Description: "Ejecutar AudioEvaluaciones Connector"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\AudioEvaluacionesConnector"
