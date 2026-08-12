using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AudioEvaluacionesConnector
{
    internal static class Program
    {
        internal const string AppName = "AudioEvaluaciones Connector";
        internal const string DefaultUrl = "https://audio-evaluaciones-medicas.vercel.app";
        internal const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        internal const string RunValue = "AudioEvaluacionesConnector";

        [STAThread]
        private static void Main(string[] args)
        {
            string user = WindowsIdentity.GetCurrent().User.Value.Replace('-', '_');
            bool created;
            using (var mutex = new Mutex(true, @"Local\AudioEvaluacionesConnector_" + user, out created))
            {
                if (!created)
                {
                    bool shutdown = Array.IndexOf(args, "--shutdown") >= 0;
                    NotifyExistingInstance(user, shutdown ? "shutdown" : "activate");
                    if (shutdown && !WaitForExistingExit(@"Local\AudioEvaluacionesConnector_" + user)) Environment.ExitCode = 2;
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApplicationContext(user, args));
            }
        }

        private static void NotifyExistingInstance(string user, string command)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", "AudioEvaluacionesConnector_" + user, PipeDirection.Out))
                {
                    pipe.Connect(800);
                    using (var writer = new StreamWriter(pipe)) { writer.WriteLine(command); writer.Flush(); }
                }
            }
            catch { }
        }

        private static bool WaitForExistingExit(string mutexName)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                bool created;
                using (var probe = new Mutex(true, mutexName, out created)) if (created) return true;
                Thread.Sleep(250);
            }
            return false;
        }
    }

    internal sealed class ConnectorConfig
    {
        public int configVersion = 1;
        public int port = 8765;
        public string audioEvaluacionesUrl = Program.DefaultUrl;
        public string downloadsDir = "";
        public bool startWithWindows = true;
        public string releaseManifestUrl = Program.DefaultUrl + "/connector-release.json";
        public string releaseRepository = "jannpierrproyectos/audio-evaluaciones-medicas";
        public string[] allowedDownloadHosts = new[] { "github.com", "objects.githubusercontent.com", "githubusercontent.com" };
        public string[] allowedOrigins = new[] { "http://localhost:5173", "http://127.0.0.1:5173", Program.DefaultUrl };
    }

    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        private readonly string dataDir;
        private readonly string configPath;
        private readonly string logsDir;
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem toggleItem;
        private readonly ToolStripMenuItem startupItem;
        private readonly ToolStripMenuItem releaseNotesItem;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Control dispatcher = new Control();
        private Process child;
        private ConnectorConfig config;
        private string state = "starting";
        private bool activeJob;
        private bool exiting;
        private bool restarting;
        private bool installing;
        private string installerPath;
        private string latestVersion;
        private string updateStatus = "Sin comprobar";
        private string lastUpdateCheck = "Nunca";
        private string releaseNotesUrl;
        private readonly bool silentStartup;
        private NamedPipeServerStream instancePipe;

        internal TrayApplicationContext(string user, string[] args)
        {
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AudioEvaluacionesConnector");
            configPath = Path.Combine(dataDir, "config.json");
            logsDir = Path.Combine(dataDir, "logs");
            silentStartup = Array.IndexOf(args, "--startup") >= 0;
            Directory.CreateDirectory(dataDir);
            Directory.CreateDirectory(logsDir);
            dispatcher.CreateControl();
            config = LoadConfig();
            if (Array.IndexOf(args, "--startup-disabled") >= 0) { config.startWithWindows = false; SaveConfig(config); }

            statusItem = new ToolStripMenuItem("Estado: Iniciando") { Enabled = false };
            toggleItem = new ToolStripMenuItem("Detener Connector", null, delegate { ToggleService(); });
            startupItem = new ToolStripMenuItem("Iniciar con Windows", null, delegate { ToggleStartup(); }) { Checked = IsStartupEnabled(), CheckOnClick = false };
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem(Program.AppName) { Enabled = false });
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Abrir AudioEvaluaciones", null, delegate { OpenTarget(config.audioEvaluacionesUrl); }));
            menu.Items.Add(new ToolStripMenuItem("Abrir MediWeb", null, async delegate { await OpenMediWeb(); }));
            menu.Items.Add(new ToolStripMenuItem("Abrir carpeta de reportes", null, delegate { OpenReports(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(startupItem);
            menu.Items.Add(new ToolStripMenuItem("Configuración", null, delegate { ShowSettings(); }));
            menu.Items.Add(new ToolStripMenuItem("Buscar actualizaciones", null, async delegate { await CheckUpdates(); }));
            releaseNotesItem = new ToolStripMenuItem("Ver novedades", null, delegate { if (!String.IsNullOrWhiteSpace(releaseNotesUrl)) OpenTarget(releaseNotesUrl); }) { Enabled = false };
            menu.Items.Add(releaseNotesItem);
            var diagnostics = new ToolStripMenuItem("Diagnóstico");
            diagnostics.DropDownItems.Add(new ToolStripMenuItem("Abrir carpeta de diagnóstico", null, delegate { OpenTarget(logsDir); }));
            diagnostics.DropDownItems.Add(new ToolStripMenuItem("Estado de actualización", null, delegate { ShowUpdateDiagnostics(); }));
            menu.Items.Add(diagnostics);
            menu.Items.Add(new ToolStripMenuItem("Acerca de", null, delegate { ShowAbout(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(toggleItem);
            menu.Items.Add(new ToolStripMenuItem("Reiniciar Connector", null, delegate { RestartService(); }));
            menu.Items.Add(new ToolStripMenuItem("Salir", null, delegate { ExitSafely(); }));

            tray = new NotifyIcon();
            tray.Icon = LoadIcon();
            tray.Text = Program.AppName + " — Iniciando";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenTarget(config.audioEvaluacionesUrl); };

            StartInstancePipe(user);
            if (config.startWithWindows && !IsStartupEnabled()) SetStartup(true);
            StartService();
        }

        private Icon LoadIcon()
        {
            string iconPath = Path.Combine(baseDir, "assets", "AudioEvaluacionesConnector.ico");
            try { if (File.Exists(iconPath)) return new Icon(iconPath); } catch { }
            return SystemIcons.Application;
        }

        private ConnectorConfig LoadConfig()
        {
            try
            {
                if (File.Exists(configPath)) return json.Deserialize<ConnectorConfig>(File.ReadAllText(configPath, Encoding.UTF8));
            }
            catch { Log("WARN", "No se pudo leer config.json; se aplicaron valores seguros."); }
            var initial = new ConnectorConfig();
            SaveConfig(initial);
            return initial;
        }

        private void SaveConfig(ConnectorConfig value)
        {
            string temporary = configPath + ".tmp";
            File.WriteAllText(temporary, json.Serialize(value), new UTF8Encoding(false));
            if (File.Exists(configPath)) File.Replace(temporary, configPath, null); else File.Move(temporary, configPath);
        }

        private void StartService()
        {
            if (child != null && !child.HasExited) return;
            SetState("starting");
            string node = Path.Combine(baseDir, "runtime", "node.exe");
            string entry = Path.Combine(baseDir, "app", "src", "trayService.js");
            var start = new ProcessStartInfo(node, "\"" + entry + "\"");
            start.WorkingDirectory = Path.Combine(baseDir, "app");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            child = new Process();
            child.StartInfo = start;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += ChildOutput;
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (!String.IsNullOrWhiteSpace(e.Data)) Log("ERROR", "El proceso local informó un error."); };
            child.Exited += ChildExited;
            try
            {
                child.Start();
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                Log("ERROR", "No se pudo iniciar el proceso local: " + ex.GetType().Name);
                SetState("error");
                ShowBalloon("No se pudo iniciar AudioEvaluaciones Connector.", ToolTipIcon.Error);
            }
        }

        private void ChildOutput(object sender, DataReceivedEventArgs e)
        {
            if (String.IsNullOrEmpty(e.Data) || !e.Data.StartsWith("AE_EVENT ")) return;
            try
            {
                var message = json.Deserialize<Dictionary<string, object>>(e.Data.Substring(9));
                string type = Convert.ToString(message["type"]);
                BeginOnUi(delegate { HandleEvent(type, message); });
            }
            catch { Log("WARN", "Se recibió un evento operativo no válido."); }
        }

        private void HandleEvent(string type, Dictionary<string, object> details)
        {
            if (type == "connector:ready")
            {
                SetState("ready");
                if (!silentStartup) ShowBalloon("AudioEvaluaciones Connector está activo.", ToolTipIcon.Info);
            }
            else if (type == "browser:opened") SetState("browser_open");
            else if (type == "browser:error")
            {
                SetState("error");
                ShowBalloon("No se encontró Microsoft Edge ni Google Chrome. Instala uno para utilizar MediWeb.", ToolTipIcon.Error);
                ResetReadyLater();
            }
            else if (type == "job:started") { activeJob = true; SetState("processing"); }
            else if (type == "job:completed") { activeJob = false; SetState("ready"); ShowBalloon("Proceso completado.", ToolTipIcon.Info); }
            else if (type == "job:failed") { activeJob = false; SetState("error"); ShowBalloon("El procesamiento se detuvo por un error.", ToolTipIcon.Error); ResetReadyLater(); }
            else if (type == "job:cancelled") { activeJob = false; SetState("ready"); }
            else if (type == "update:available")
            {
                ApplyUpdateDetails(details);
                ShowBalloon("Nueva versión disponible: " + latestVersion, ToolTipIcon.Info);
            }
            else if (type == "update:download-progress")
            {
                if (Detail(details, "state") == "downloading") updateStatus = "Descargando";
            }
            else if (type == "update:downloaded")
            {
                latestVersion = Detail(details, "version");
                updateStatus = "Lista para instalar";
                ShowBalloon("La actualización " + latestVersion + " está lista para instalarse.", ToolTipIcon.Info);
            }
            else if (type == "update:install-requested") PrepareInstall(details);
            else if (type == "connector:already-running") { ShowBalloon("AudioEvaluaciones Connector ya está activo.", ToolTipIcon.Info); ExitThread(); }
            else if (type == "connector:error")
            {
                SetState("error");
                string code = details.ContainsKey("code") ? Convert.ToString(details["code"]) : "";
                string message = code == "EADDRINUSE"
                    ? "No se pudo iniciar AudioEvaluaciones Connector porque el puerto local está ocupado."
                    : "No se pudo iniciar AudioEvaluaciones Connector.";
                ShowBalloon(message, ToolTipIcon.Error);
            }
            else if (type == "connector:stopped") { SetState("stopped"); }
        }

        private void ChildExited(object sender, EventArgs e)
        {
            BeginOnUi(delegate
            {
                if (installing)
                {
                    LaunchVerifiedInstaller();
                }
                else if (restarting)
                {
                    restarting = false;
                    StartService();
                }
                else if (exiting) FinishExit();
                else
                {
                    SetState("stopped");
                    Log("WARN", "El proceso local se detuvo.");
                }
            });
        }

        private void SetState(string next)
        {
            state = next;
            string label = "Activo";
            if (next == "starting") label = "Iniciando";
            else if (next == "browser_open") label = "MediWeb abierto";
            else if (next == "processing") label = "Procesando evaluaciones…";
            else if (next == "error") label = "Se produjo un error";
            else if (next == "stopped") label = "Detenido";
            statusItem.Text = "Estado: " + label;
            toggleItem.Text = next == "stopped" || next == "error" ? "Iniciar Connector" : "Detener Connector";
            string tooltip = Program.AppName + " — " + label;
            tray.Text = tooltip.Length > 63 ? tooltip.Substring(0, 63) : tooltip;
        }

        private void ToggleService()
        {
            if (state == "stopped" || state == "error") StartService(); else StopService(false);
        }

        private void StopService(bool forExit)
        {
            if (activeJob && !ConfirmActiveJob(forExit ? "cerrar" : "detener")) return;
            exiting = forExit;
            if (child == null || child.HasExited) { if (forExit) FinishExit(); else SetState("stopped"); return; }
            try { child.StandardInput.WriteLine("shutdown"); child.StandardInput.Flush(); }
            catch { if (forExit) FinishExit(); }
        }

        private void RestartService()
        {
            if (activeJob && !ConfirmActiveJob("reiniciar")) return;
            if (child == null || child.HasExited) { StartService(); return; }
            restarting = true;
            try { child.StandardInput.WriteLine("shutdown"); child.StandardInput.Flush(); }
            catch { restarting = false; StartService(); }
        }

        private bool ConfirmActiveJob(string action)
        {
            return MessageBox.Show("Hay un procesamiento en curso.\n\n¿Deseas cancelar el procesamiento y " + action + " AudioEvaluaciones Connector?",
                Program.AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;
        }

        private void ExitSafely() { StopService(true); }

        private void FinishExit()
        {
            tray.Visible = false;
            tray.Dispose();
            dispatcher.Dispose();
            if (instancePipe != null) instancePipe.Dispose();
            ExitThread();
        }

        private async Task OpenMediWeb()
        {
            if (state == "stopped" || state == "error") { ShowBalloon("Inicia el Connector antes de abrir MediWeb.", ToolTipIcon.Warning); return; }
            try
            {
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    await client.UploadDataTaskAsync(new Uri("http://127.0.0.1:" + config.port + "/mediweb/open"), "POST", Encoding.UTF8.GetBytes("{}"));
                }
            }
            catch (WebException ex)
            {
                string body = "";
                try { using (var reader = new StreamReader(ex.Response.GetResponseStream())) body = reader.ReadToEnd(); } catch { }
                if (body.Contains("BROWSER_UNAVAILABLE")) ShowBalloon("No se encontró Microsoft Edge ni Google Chrome. Instala uno para utilizar MediWeb.", ToolTipIcon.Error);
                else ShowBalloon("No se pudo abrir MediWeb. Revisa el diagnóstico local.", ToolTipIcon.Error);
            }
        }

        private async Task CheckUpdates()
        {
            if (state == "stopped" || state == "error") { ShowBalloon("Inicia el Connector antes de buscar actualizaciones.", ToolTipIcon.Warning); return; }
            try
            {
                Dictionary<string, object> result = await PostConnector("/update/check");
                ApplyUpdateDetails(result);
                string compatibility = Detail(result, "compatibility");
                if (compatibility == "up_to_date")
                {
                    MessageBox.Show("AudioEvaluaciones Connector está actualizado.\nVersión " + CurrentVersion(), Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (compatibility != "update_available" && compatibility != "update_required")
                {
                    MessageBox.Show("No se pudo consultar la actualización. Puedes continuar usando la versión actual.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                string message = compatibility == "update_required"
                    ? "Esta versión necesita actualizarse para continuar usando la integración con MediWeb."
                    : "Nueva versión disponible: " + latestVersion;
                if (MessageBox.Show(message + "\n\n¿Descargar actualización?", Program.AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    await DownloadAndPrepareUpdate();
            }
            catch { ShowBalloon("No se pudo comprobar si existen actualizaciones.", ToolTipIcon.Warning); }
        }

        private async Task DownloadAndPrepareUpdate()
        {
            try
            {
                updateStatus = "Descargando";
                await PostConnector("/update/download");
                await PostConnector("/update/install");
            }
            catch (WebException ex)
            {
                string body = ReadWebError(ex);
                updateStatus = "Error de descarga";
                if (body.Contains("UPDATE_SHA256_MISMATCH")) MessageBox.Show("No se pudo verificar la actualización. El instalador descargado fue descartado.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                else ShowBalloon("No se pudo descargar o preparar la actualización.", ToolTipIcon.Error);
            }
        }

        private async Task<Dictionary<string, object>> PostConnector(string endpoint)
        {
            using (var client = new WebClient())
            {
                client.Headers[HttpRequestHeader.ContentType] = "application/json";
                byte[] response = await client.UploadDataTaskAsync(new Uri("http://127.0.0.1:" + config.port + endpoint), "POST", Encoding.UTF8.GetBytes("{}"));
                return json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(response));
            }
        }

        private void ApplyUpdateDetails(Dictionary<string, object> details)
        {
            latestVersion = Detail(details, "latestVersion");
            updateStatus = Detail(details, "compatibility");
            lastUpdateCheck = Detail(details, "lastCheckedAt");
            releaseNotesUrl = Detail(details, "releaseNotesUrl");
            releaseNotesItem.Enabled = !String.IsNullOrWhiteSpace(releaseNotesUrl);
        }

        private static string Detail(Dictionary<string, object> details, string key)
        {
            return details.ContainsKey(key) && details[key] != null ? Convert.ToString(details[key]) : "";
        }

        private void PrepareInstall(Dictionary<string, object> details)
        {
            if (activeJob)
            {
                MessageBox.Show("Hay un procesamiento de evaluaciones en curso.\n\nFinalízalo o cancélalo antes de actualizar AudioEvaluaciones Connector.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            string candidate = Detail(details, "filePath");
            string updatesRoot = Path.GetFullPath(Path.Combine(dataDir, "updates")) + Path.DirectorySeparatorChar;
            string fullPath;
            try { fullPath = Path.GetFullPath(candidate); } catch { Log("ERROR", "Ruta de instalador verificado inválida."); return; }
            if (!fullPath.StartsWith(updatesRoot, StringComparison.OrdinalIgnoreCase) || !fullPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
            {
                Log("ERROR", "Se rechazó una ruta de instalador fuera del directorio de updates.");
                return;
            }
            string expectedSha256 = Detail(details, "sha256");
            if (String.IsNullOrWhiteSpace(expectedSha256) || !String.Equals(HashFileSha256(fullPath), expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(fullPath); } catch { }
                Log("ERROR", "El instalador cambió después de la verificación y fue descartado.");
                MessageBox.Show("No se pudo verificar la actualización. El instalador descargado fue descartado.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (MessageBox.Show("La actualización está lista para instalarse.\n\nAudioEvaluaciones Connector se cerrará durante la actualización.", Program.AppName, MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
            installerPath = fullPath;
            installing = true;
            exiting = true;
            try { child.StandardInput.WriteLine("shutdown"); child.StandardInput.Flush(); }
            catch { LaunchVerifiedInstaller(); }
        }

        private void LaunchVerifiedInstaller()
        {
            try
            {
                Process.Start(new ProcessStartInfo(installerPath) { UseShellExecute = true });
                Log("INFO", "Verified update installer launched.");
                FinishExit();
            }
            catch (Exception ex)
            {
                Log("ERROR", "No se pudo iniciar el instalador verificado: " + ex.GetType().Name);
                installing = false;
                exiting = false;
                installerPath = null;
                ShowBalloon("No se pudo iniciar el instalador. Puedes volver a intentarlo.", ToolTipIcon.Error);
                StartService();
            }
        }

        private static string ReadWebError(WebException ex)
        {
            try { using (var reader = new StreamReader(ex.Response.GetResponseStream())) return reader.ReadToEnd(); } catch { return ""; }
        }

        private static string HashFileSha256(string filePath)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(filePath))
            {
                byte[] hash = sha.ComputeHash(stream);
                var text = new StringBuilder(hash.Length * 2);
                foreach (byte value in hash) text.Append(value.ToString("x2"));
                return text.ToString();
            }
        }

        private string CurrentVersion() { return FileVersionInfo.GetVersionInfo(Application.ExecutablePath).ProductVersion; }

        private void ShowUpdateDiagnostics()
        {
            MessageBox.Show("Connector: " + CurrentVersion() + "\nÚltima comprobación: " + lastUpdateCheck + "\nEstado de actualización: " + updateStatus, "Diagnóstico", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void OpenReports()
        {
            string folder = String.IsNullOrWhiteSpace(config.downloadsDir)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "AudioEvaluaciones", "Descargas")
                : Environment.ExpandEnvironmentVariables(config.downloadsDir);
            Directory.CreateDirectory(folder);
            OpenTarget(folder);
        }

        private void OpenTarget(string target)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
            catch { ShowBalloon("Windows no pudo abrir el elemento solicitado.", ToolTipIcon.Error); }
        }

        private void ToggleStartup()
        {
            bool enabled = !IsStartupEnabled();
            SetStartup(enabled);
            config.startWithWindows = enabled;
            SaveConfig(config);
            startupItem.Checked = enabled;
        }

        private bool IsStartupEnabled()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(Program.RunKey)) return key != null && key.GetValue(Program.RunValue) != null;
        }

        private void SetStartup(bool enabled)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(Program.RunKey))
            {
                if (enabled) key.SetValue(Program.RunValue, "\"" + Path.Combine(baseDir, "AudioEvaluacionesConnector.exe") + "\" --startup");
                else key.DeleteValue(Program.RunValue, false);
            }
            startupItem.Checked = enabled;
        }

        private void ShowSettings()
        {
            using (var dialog = new SettingsForm(config))
            {
                if (dialog.ShowDialog() != DialogResult.OK) return;
                ConnectorConfig changed = dialog.Value;
                changed.configVersion = config.configVersion;
                changed.releaseManifestUrl = config.releaseManifestUrl;
                changed.releaseRepository = config.releaseRepository;
                changed.allowedDownloadHosts = config.allowedDownloadHosts;
                var origins = new List<string> { "http://localhost:5173", "http://127.0.0.1:5173", Program.DefaultUrl };
                if (!origins.Contains(changed.audioEvaluacionesUrl)) origins.Add(changed.audioEvaluacionesUrl);
                changed.allowedOrigins = origins.ToArray();
                bool restartRequired = changed.port != config.port || changed.audioEvaluacionesUrl != config.audioEvaluacionesUrl || changed.downloadsDir != config.downloadsDir;
                config = changed;
                SaveConfig(config);
                SetStartup(config.startWithWindows);
                if (restartRequired && MessageBox.Show("Es necesario reiniciar AudioEvaluaciones Connector para aplicar este cambio.\n\n¿Reiniciar ahora?",
                    Program.AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes) RestartService();
            }
        }

        private void ShowAbout()
        {
            string version = CurrentVersion();
            MessageBox.Show(Program.AppName + "\nVersión " + version + "\n\nServicio local para integración segura entre AudioEvaluaciones y MediWeb.\n\nLas actualizaciones solo se descargan e instalan con tu autorización.",
                "Acerca de", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void ShowBalloon(string message, ToolTipIcon icon)
        {
            tray.BalloonTipTitle = Program.AppName;
            tray.BalloonTipText = message;
            tray.BalloonTipIcon = icon;
            tray.ShowBalloonTip(4000);
        }

        private void ResetReadyLater()
        {
            var timer = new System.Windows.Forms.Timer();
            timer.Interval = 5000;
            timer.Tick += delegate { timer.Stop(); timer.Dispose(); if (!activeJob && state == "error") SetState("ready"); };
            timer.Start();
        }

        private void StartInstancePipe(string user)
        {
            Task.Run(async delegate
            {
                while (!exiting)
                {
                    try
                    {
                        instancePipe = new NamedPipeServerStream("AudioEvaluacionesConnector_" + user, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                        await instancePipe.WaitForConnectionAsync();
                        using (var reader = new StreamReader(instancePipe))
                        {
                            string command = await reader.ReadLineAsync();
                            if (command == "activate") BeginOnUi(delegate { ShowBalloon("AudioEvaluaciones Connector ya está activo.", ToolTipIcon.Info); });
                            else if (command == "shutdown") BeginOnUi(delegate { ExitSafely(); });
                        }
                        instancePipe.Dispose();
                    }
                    catch { if (!exiting) Thread.Sleep(250); }
                }
            });
        }

        private void Log(string level, string message)
        {
            try
            {
                Directory.CreateDirectory(logsDir);
                File.AppendAllText(Path.Combine(logsDir, "tray.log"), DateTime.UtcNow.ToString("o") + " " + level + " " + message.Replace('\r', ' ').Replace('\n', ' ') + Environment.NewLine);
                RotateTrayLogs();
            }
            catch { }
        }

        private void RotateTrayLogs()
        {
            string current = Path.Combine(logsDir, "tray.log");
            if (!File.Exists(current) || new FileInfo(current).Length < 2 * 1024 * 1024) return;
            string oldest = Path.Combine(logsDir, "tray.4.log");
            if (File.Exists(oldest)) File.Delete(oldest);
            for (int index = 3; index >= 1; index--)
            {
                string source = Path.Combine(logsDir, "tray." + index + ".log");
                if (File.Exists(source)) File.Move(source, Path.Combine(logsDir, "tray." + (index + 1) + ".log"));
            }
            File.Move(current, Path.Combine(logsDir, "tray.1.log"));
        }

        private void BeginOnUi(MethodInvoker action)
        {
            if (dispatcher.InvokeRequired) dispatcher.BeginInvoke(action); else action();
        }
    }

    internal sealed class SettingsForm : Form
    {
        private readonly NumericUpDown port;
        private readonly TextBox url;
        private readonly TextBox folder;
        private readonly CheckBox startup;
        internal ConnectorConfig Value { get; private set; }

        internal SettingsForm(ConnectorConfig current)
        {
            Text = "Configuración — AudioEvaluaciones Connector";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(540, 250);
            port = new NumericUpDown { Minimum = 1, Maximum = 65535, Value = current.port, Left = 180, Top = 22, Width = 120 };
            url = new TextBox { Text = current.audioEvaluacionesUrl, Left = 180, Top = 62, Width = 330 };
            folder = new TextBox { Text = current.downloadsDir, Left = 180, Top = 102, Width = 250 };
            startup = new CheckBox { Text = "Iniciar con Windows", Checked = current.startWithWindows, Left = 180, Top = 145, Width = 220 };
            Controls.Add(new Label { Text = "Puerto", Left = 20, Top = 25, Width = 150 });
            Controls.Add(new Label { Text = "URL de AudioEvaluaciones", Left = 20, Top = 65, Width = 155 });
            Controls.Add(new Label { Text = "Carpeta de descargas", Left = 20, Top = 105, Width = 155 });
            Controls.Add(port); Controls.Add(url); Controls.Add(folder); Controls.Add(startup);
            var browse = new Button { Text = "Examinar…", Left = 435, Top = 100, Width = 75 };
            browse.Click += delegate { using (var picker = new FolderBrowserDialog()) if (picker.ShowDialog() == DialogResult.OK) folder.Text = picker.SelectedPath; };
            Controls.Add(browse);
            var save = new Button { Text = "Guardar", Left = 335, Top = 195, Width = 85, DialogResult = DialogResult.None };
            save.Click += delegate { SaveAndClose(); };
            var cancel = new Button { Text = "Cancelar", Left = 425, Top = 195, Width = 85, DialogResult = DialogResult.Cancel };
            Controls.Add(save); Controls.Add(cancel);
            AcceptButton = save; CancelButton = cancel;
        }

        private void SaveAndClose()
        {
            Uri parsed;
            if (!Uri.TryCreate(url.Text.Trim(), UriKind.Absolute, out parsed) || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.PathAndQuery != "/")
            {
                MessageBox.Show("Escribe una URL HTTP o HTTPS válida sin rutas adicionales.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            Value = new ConnectorConfig { port = Decimal.ToInt32(port.Value), audioEvaluacionesUrl = parsed.GetLeftPart(UriPartial.Authority), downloadsDir = folder.Text.Trim(), startWithWindows = startup.Checked };
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
