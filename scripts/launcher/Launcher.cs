// Illustrated IF Studio — friendly Windows launcher.
//
// This is the ONE thing the person making games double-clicks. It never shows a
// console. If the studio is ready it just opens it; if something is missing it
// walks them through a plain-language wizard instead of a terminal.
//
// Built by `npm run build:launcher` (see scripts/build-launcher.mjs) with the
// .NET Framework compiler that ships with Windows, so the output .exe needs no
// runtime install. Target language level is C# 5 — no interpolated strings,
// null-conditionals, or nameof in this file.

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace IllustratedIf
{
    internal static class Palette
    {
        public static readonly Color Void = Color.FromArgb(10, 5, 18);
        public static readonly Color Panel = Color.FromArgb(24, 12, 38);
        public static readonly Color Ink = Color.FromArgb(243, 232, 255);
        public static readonly Color Dim = Color.FromArgb(170, 152, 196);
        public static readonly Color Accent = Color.FromArgb(168, 85, 247);
        public static readonly Color AccentHover = Color.FromArgb(192, 132, 252);
        public static readonly Color Danger = Color.FromArgb(248, 113, 113);

        public static Font H1 = new Font("Segoe UI Semibold", 17f, FontStyle.Regular, GraphicsUnit.Point);
        public static Font H2 = new Font("Segoe UI Semibold", 12f, FontStyle.Regular, GraphicsUnit.Point);
        public static Font Body = new Font("Segoe UI", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
        public static Font Small = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        public static Font Button = new Font("Segoe UI Semibold", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
    }

    /// <summary>Everything we know about this copy of the studio on disk.</summary>
    internal static class Studio
    {
        public const string ElectronSpec = "electron@^37.10.3";

        public static string Root = "";
        public static string LogPath = "";
        public static int Port = 8787;
        public static bool SimulateNoNode = false;
        public static bool SimulateNoElectron = false;

        public static bool Locate()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            for (int i = 0; i < 5 && !string.IsNullOrEmpty(dir); i++)
            {
                if (File.Exists(Path.Combine(dir, "server\\index.mjs")) &&
                    File.Exists(Path.Combine(dir, "package.json")))
                {
                    Root = dir.TrimEnd('\\');
                    return true;
                }
                DirectoryInfo parent = Directory.GetParent(dir.TrimEnd('\\'));
                if (parent == null) break;
                dir = parent.FullName;
            }
            return false;
        }

        public static void OpenLogFolder()
        {
            try
            {
                if (File.Exists(LogPath))
                    Process.Start(new ProcessStartInfo("notepad.exe", "\"" + LogPath + "\"") { UseShellExecute = true });
            }
            catch { }
        }

        public static void InitLog()
        {
            string preferred = Path.Combine(Root, "tools\\logs");
            try
            {
                Directory.CreateDirectory(preferred);
                LogPath = Path.Combine(preferred, "last-startup.txt");
                File.WriteAllText(LogPath, "Illustrated IF Studio — startup log\r\n" + DateTime.Now + "\r\n\r\n");
            }
            catch
            {
                LogPath = Path.Combine(Path.GetTempPath(), "illustrated-if-startup.txt");
                try { File.WriteAllText(LogPath, "Illustrated IF Studio — startup log\r\n"); } catch { }
            }
        }

        static readonly object LogLock = new object();

        public static void Log(string message)
        {
            lock (LogLock)
            {
                try { File.AppendAllText(LogPath, message + "\r\n"); } catch { }
            }
        }

        public static string ElectronExe
        {
            get { return Path.Combine(Root, "node_modules\\electron\\dist\\electron.exe"); }
        }

        public static bool ElectronReady()
        {
            if (SimulateNoElectron) return false;
            return File.Exists(ElectronExe);
        }

        /// <summary>Full path to node.exe, or "" when Node is not installed.</summary>
        public static string FindNode()
        {
            if (SimulateNoNode) return "";
            foreach (string candidate in NodeCandidates())
            {
                try { if (File.Exists(candidate)) return candidate; }
                catch { }
            }
            return "";
        }

        static string[] NodeCandidates()
        {
            var list = new System.Collections.Generic.List<string>();
            string[] scopes = new string[] { null, "Machine", "User" };
            foreach (string scope in scopes)
            {
                string path = null;
                try
                {
                    path = scope == null
                        ? Environment.GetEnvironmentVariable("PATH")
                        : Environment.GetEnvironmentVariable("PATH",
                            scope == "Machine" ? EnvironmentVariableTarget.Machine : EnvironmentVariableTarget.User);
                }
                catch { }
                if (string.IsNullOrEmpty(path)) continue;
                foreach (string entry in path.Split(';'))
                {
                    string trimmed = entry.Trim().Trim('"');
                    if (trimmed.Length == 0) continue;
                    try { list.Add(Path.Combine(trimmed, "node.exe")); }
                    catch { }
                }
            }
            list.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs\\node.exe"));
            list.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs\\node.exe"));
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (!string.IsNullOrEmpty(local))
            {
                list.Add(Path.Combine(local, "Programs\\nodejs\\node.exe"));
                list.Add(Path.Combine(local, "nodejs\\node.exe"));
            }
            return list.ToArray();
        }

        /// <summary>True when THIS copy's studio backend answers (preferred port, or a nearby fallback).</summary>
        public static bool StudioAnswering()
        {
            // Electron may hop to preferredPort+N when something else holds 8787.
            for (int delta = 0; delta < 10; delta++)
            {
                if (ProbePort(Port + delta)) return true;
            }
            return false;
        }

        static bool ProbePort(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                req.Timeout = 900;
                req.ReadWriteTimeout = 900;
                req.Method = "GET";
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    if (res.StatusCode != HttpStatusCode.OK) return false;
                    string body;
                    using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                        body = reader.ReadToEnd();
                    return HealthBelongsToUs(body);
                }
            }
            catch { return false; }
        }

        /// <summary>
        /// Accept health JSON only when it clearly refers to this studio folder.
        /// Prevents a different unzipped copy (or a checkout) on the same port
        /// from counting as "we're up" for the splash screen.
        /// </summary>
        static bool HealthBelongsToUs(string body)
        {
            if (string.IsNullOrEmpty(body) || string.IsNullOrEmpty(Root)) return false;
            string rootNorm = Root.TrimEnd('\\', '/').Replace('/', '\\');

            string studio = JsonStringValue(body, "studioRoot");
            if (studio != null)
            {
                studio = studio.TrimEnd('\\', '/').Replace('/', '\\');
                return string.Equals(studio, rootNorm, StringComparison.OrdinalIgnoreCase);
            }

            string project = JsonStringValue(body, "projectDir");
            if (project != null)
            {
                project = project.Replace('/', '\\');
                return project.StartsWith(rootNorm + "\\", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(project, rootNorm, StringComparison.OrdinalIgnoreCase);
            }

            // Older servers: require our root path to appear in the payload.
            string escaped = rootNorm.Replace("\\", "\\\\");
            return IndexOfIgnoreCase(body, escaped) >= 0 || IndexOfIgnoreCase(body, rootNorm) >= 0;
        }

        static int IndexOfIgnoreCase(string haystack, string needle)
        {
            return haystack.IndexOf(needle, StringComparison.OrdinalIgnoreCase);
        }

        static string JsonStringValue(string json, string key)
        {
            string pattern = "\"" + key + "\"";
            int keyIndex = IndexOfIgnoreCase(json, pattern);
            if (keyIndex < 0) return null;
            int colon = json.IndexOf(':', keyIndex + pattern.Length);
            if (colon < 0) return null;
            int first = json.IndexOf('"', colon + 1);
            if (first < 0) return null;
            var sb = new StringBuilder();
            for (int i = first + 1; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length)
                {
                    char n = json[++i];
                    if (n == '"' || n == '\\' || n == '/') sb.Append(n);
                    else if (n == 'n') sb.Append('\n');
                    else if (n == 'r') sb.Append('\r');
                    else if (n == 't') sb.Append('\t');
                    else sb.Append(n);
                    continue;
                }
                if (c == '"') break;
                sb.Append(c);
            }
            return sb.ToString();
        }

        /// <summary>Starts the Electron studio with no console window. Returns the process.</summary>
        public static Process Launch()
        {
            var psi = new ProcessStartInfo(ElectronExe, "\"" + Root + "\"");
            psi.WorkingDirectory = Root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.EnvironmentVariables["PORT"] = Port.ToString();
            Log("launching " + ElectronExe);
            return Process.Start(psi);
        }

        /// <summary>True when a real (non-Store-stub) Python 3 is on PATH.</summary>
        public static bool HasPython()
        {
            string[] cmds = new string[] { "py", "python", "python3" };
            foreach (string cmd in cmds)
            {
                try
                {
                    var psi = new ProcessStartInfo(cmd, cmd == "py" ? "-3 -c \"import sys; print(sys.version.split()[0])\"" : "-c \"import sys; print(sys.version.split()[0])\"");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    using (Process p = Process.Start(psi))
                    {
                        if (p == null) continue;
                        string o = p.StandardOutput.ReadToEnd();
                        p.WaitForExit(5000);
                        if (p.ExitCode == 0 && o.Trim().Length > 0) return true;
                    }
                }
                catch { }
            }
            return false;
        }

        /// <summary>True when CMake and MSVC C++ tools look installed.</summary>
        public static bool HasCppTools()
        {
            try
            {
                var psi = new ProcessStartInfo("cmake", "--version");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    if (p == null) return false;
                    p.WaitForExit(5000);
                    if (p.ExitCode != 0) return false;
                }
            }
            catch { return false; }

            string vswhere = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft Visual Studio\\Installer\\vswhere.exe");
            if (!File.Exists(vswhere)) return false;
            try
            {
                var psi = new ProcessStartInfo(vswhere,
                    "-latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    if (p == null) return false;
                    string o = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(8000);
                    return p.ExitCode == 0 && o.Trim().Length > 0;
                }
            }
            catch { return false; }
        }
    }

    /// <summary>Win32 bits that make the windows look like they belong to the studio.</summary>
    internal static class Native
    {
        [DllImport("dwmapi.dll", PreserveSig = true)]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public static void UseDarkTitleBar(Form form)
        {
            try
            {
                int on = 1;
                // 20 on current Windows 10/11, 19 on older builds — try both, ignore failures.
                DwmSetWindowAttribute(form.Handle, 20, ref on, sizeof(int));
                DwmSetWindowAttribute(form.Handle, 19, ref on, sizeof(int));
            }
            catch { }
        }
    }

    internal static class Ui
    {
        public static Image LoadMark()
        {
            try
            {
                string png = Path.Combine(Studio.Root, "electron\\icon.png");
                if (File.Exists(png))
                {
                    using (var stream = new FileStream(png, FileMode.Open, FileAccess.Read))
                        return Image.FromStream(stream);
                }
            }
            catch { }
            return null;
        }

        public static PictureBox Mark(int size)
        {
            var box = new PictureBox();
            box.Size = new Size(size, size);
            box.SizeMode = PictureBoxSizeMode.Zoom;
            box.BackColor = Color.Transparent;
            Image img = LoadMark();
            if (img != null) box.Image = img;
            return box;
        }

        public static Label Text(string value, Font font, Color color, int x, int y, int width)
        {
            var label = new Label();
            label.Text = value;
            label.Font = font;
            label.ForeColor = color;
            label.BackColor = Color.Transparent;
            label.Location = new Point(x, y);
            label.Size = new Size(width, 20);
            label.AutoSize = false;
            return label;
        }

        public static Button Action(string text, bool primary)
        {
            var button = new Button();
            button.Text = text;
            button.Font = Palette.Button;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = primary ? 0 : 1;
            button.FlatAppearance.BorderColor = Color.FromArgb(78, 52, 110);
            button.BackColor = primary ? Palette.Accent : Palette.Panel;
            button.ForeColor = primary ? Color.White : Palette.Ink;
            button.FlatAppearance.MouseOverBackColor = primary ? Palette.AccentHover : Color.FromArgb(38, 20, 58);
            button.Cursor = Cursors.Hand;
            button.Height = 40;
            button.AutoSize = false;
            button.UseVisualStyleBackColor = false;
            return button;
        }

        /// <summary>Sizes a label to fit its wrapped text and returns the bottom edge.</summary>
        public static int Flow(Label label, int maxWidth)
        {
            using (Graphics g = label.CreateGraphics())
            {
                SizeF measured = g.MeasureString(label.Text, label.Font, maxWidth);
                label.Size = new Size(maxWidth, (int)Math.Ceiling(measured.Height) + 4);
            }
            return label.Bottom;
        }
    }

    /// <summary>Small "opening…" window shown while Electron boots. Closes itself.</summary>
    internal class SplashForm : Form
    {
        readonly Label status;
        readonly ProgressBar bar;
        Process child;

        public SplashForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 190);
            BackColor = Palette.Void;
            Text = "Illustrated IF Studio";
            ShowInTaskbar = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            PictureBox mark = Ui.Mark(72);
            mark.Location = new Point(28, 34);
            Controls.Add(mark);

            Label title = Ui.Text("Illustrated IF Studio", Palette.H1, Palette.Ink, 122, 44, 290);
            title.Height = 30;
            Controls.Add(title);

            status = Ui.Text("Opening your studio…", Palette.Body, Palette.Dim, 122, 76, 290);
            status.Height = 24;
            Controls.Add(status);

            bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 24;
            bar.Location = new Point(122, 106);
            bar.Size = new Size(288, 6);
            Controls.Add(bar);

            Paint += DrawBorder;
        }

        void DrawBorder(object sender, PaintEventArgs e)
        {
            using (var pen = new Pen(Color.FromArgb(70, 40, 110), 1))
                e.Graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            var worker = new Thread(Boot);
            worker.IsBackground = true;
            worker.Start();
        }

        void Boot()
        {
            string failure = null;
            try
            {
                bool alreadyUp = Studio.StudioAnswering();
                child = Studio.Launch();

                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                bool healthy = false;
                while (DateTime.UtcNow < deadline)
                {
                    if (Studio.StudioAnswering()) { healthy = true; break; }
                    if (child != null && child.HasExited)
                    {
                        // A second copy of the studio bows out quietly; that is fine.
                        if (child.ExitCode == 0 && (alreadyUp || Studio.StudioAnswering())) { healthy = true; break; }
                        if (child.ExitCode != 0)
                        {
                            failure = "The studio window closed while it was starting (code " + child.ExitCode + ").";
                            break;
                        }
                        healthy = true;
                        break;
                    }
                    Thread.Sleep(250);
                }
                if (!healthy && failure == null)
                    failure = "The studio took too long to open.";
                // Give the window a beat to paint before the splash disappears.
                if (healthy) Thread.Sleep(1400);
            }
            catch (Exception ex)
            {
                failure = ex.Message;
                Studio.Log("splash error: " + ex);
            }

            string outcome = failure;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (outcome == null) { Close(); return; }
                    Studio.Log("startup failed: " + outcome);
                    Hide();
                    using (var wizard = new WizardForm(outcome))
                        wizard.ShowDialog();
                    Close();
                });
            }
            catch { }
        }
    }

    /// <summary>Plain-language first-run / repair wizard.</summary>
    internal class WizardForm : Form
    {
        const int Pad = 32;
        const int W = 620;

        readonly Label heading;
        readonly Label body;
        readonly Label status;
        readonly ProgressBar bar;
        readonly Button primary;
        readonly Button secondary;
        readonly Button details;
        readonly string startupProblem;

        string lastError = "";

        public WizardForm() : this(null) { }

        public WizardForm(string problem)
        {
            startupProblem = problem;

            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(W, 442);
            BackColor = Palette.Void;
            Text = "Illustrated IF Studio";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            PictureBox mark = Ui.Mark(64);
            mark.Location = new Point(Pad, Pad);
            Controls.Add(mark);

            Label brand = Ui.Text("Illustrated IF Studio", Palette.H2, Palette.Ink, Pad + 84, Pad + 8, 400);
            brand.Height = 24;
            Controls.Add(brand);

            Label byline = Ui.Text("make illustrated text games", Palette.Small, Palette.Dim, Pad + 84, Pad + 34, 400);
            byline.Height = 20;
            Controls.Add(byline);

            heading = Ui.Text("", Palette.H1, Palette.Ink, Pad, 122, W - Pad * 2);
            Controls.Add(heading);

            body = Ui.Text("", Palette.Body, Palette.Dim, Pad, 164, W - Pad * 2);
            Controls.Add(body);

            bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 24;
            bar.Location = new Point(Pad, 312);
            bar.Size = new Size(W - Pad * 2, 6);
            bar.Visible = false;
            Controls.Add(bar);

            status = Ui.Text("", Palette.Small, Palette.Dim, Pad, 328, W - Pad * 2);
            status.Height = 36;
            Controls.Add(status);

            primary = Ui.Action("", true);
            primary.Size = new Size(210, 44);
            primary.Location = new Point(W - Pad - 210, 376);
            primary.Click += OnPrimary;
            Controls.Add(primary);

            secondary = Ui.Action("Not right now", false);
            secondary.Size = new Size(140, 44);
            secondary.Location = new Point(W - Pad - 210 - 152, 376);
            secondary.Click += delegate { Close(); };
            Controls.Add(secondary);

            details = Ui.Action("Show the details", false);
            details.Size = new Size(150, 30);
            details.Location = new Point(Pad, 383);
            details.Font = Palette.Small;
            details.Visible = false;
            details.Click += delegate { Studio.OpenLogFolder(); };
            Controls.Add(details);

            Load += delegate { Native.UseDarkTitleBar(this); ShowIntro(); };
        }

        // ---- states -----------------------------------------------------------

        void SetCopy(string headingText, string bodyText)
        {
            heading.Text = headingText;
            int headingBottom = Ui.Flow(heading, W - Pad * 2);
            body.Text = bodyText;
            body.Location = new Point(Pad, headingBottom + 12);
            Ui.Flow(body, W - Pad * 2);
        }

        void ShowIntro()
        {
            bool hasNode = Studio.FindNode().Length > 0;
            bool hasElectron = Studio.ElectronReady();

            bar.Visible = false;
            status.Text = "";
            details.Visible = false;
            secondary.Visible = true;
            primary.Enabled = true;

            if (hasElectron && startupProblem != null)
            {
                SetCopy("The studio didn't open",
                    startupProblem + "\r\n\r\nMost of the time trying again fixes it. If it keeps happening, " +
                    "open the \u201ctools\u201d folder, then \u201cemergency\u201d, and follow the short note inside " +
                    "\u2014 or ask Maddie and show her the details file.");
                primary.Text = "Try again";
                details.Visible = true;
                return;
            }

            if (!hasNode && !hasElectron)
            {
                SetCopy("One quick setup and you're making games",
                    "This copy of the studio still needs its player window, and Windows needs to install one " +
                    "small helper first.\r\n\r\nPress the button and it happens on its own: Windows will ask for " +
                    "permission once — click Yes — then the download runs. It takes a few minutes on a normal " +
                    "connection and only ever happens once. You'll need to be online for it.");
                primary.Text = "Set it up for me";
                return;
            }

            if (!hasElectron)
            {
                SetCopy("Almost ready — one download to go",
                    "The studio needs to fetch its window (a big file, around 100 MB) before the first time you " +
                    "open it. Press the button and go make a cup of tea; it only happens once, and there's no " +
                    "permission prompt this time. You'll need to be online for it.");
                primary.Text = "Get it ready";
                return;
            }

            SetCopy("Everything's ready",
                "Nothing to install — the studio can open right now.");
            primary.Text = "Open the Studio";
        }

        void ShowWorking(string what)
        {
            bar.Visible = true;
            details.Visible = false;
            secondary.Visible = false;
            primary.Enabled = false;
            primary.Text = "Working…";
            SetCopy("Getting things ready", what);
            status.Text = "You can leave this window alone — it will tell you when it's done.";
        }

        void ShowDone()
        {
            bar.Visible = false;
            status.Text = "";
            details.Visible = false;
            secondary.Visible = true;
            secondary.Text = "Close";
            primary.Enabled = true;
            primary.Text = "Open the Studio";
            SetCopy("All set", "That's the setup finished for good. From now on just double-click " +
                "\u201cIllustrated IF Studio\u201d and it opens straight away.");
        }

        void ShowError(string message)
        {
            lastError = message;
            bar.Visible = false;
            status.Text = "";
            details.Visible = true;
            secondary.Visible = true;
            secondary.Text = "Close";
            primary.Enabled = true;
            primary.Text = "Try again";
            SetCopy("That didn't work",
                message + "\r\n\r\nNothing is broken \u2014 you can try again. If it keeps failing, check you're " +
                "online, then ask Maddie and show her the details file.");
        }

        // ---- actions ----------------------------------------------------------

        void OnPrimary(object sender, EventArgs e)
        {
            if (primary.Text == "Open the Studio")
            {
                OpenStudio();
                return;
            }
            var worker = new Thread(RunSetup);
            worker.IsBackground = true;
            ShowWorking("Starting…");
            worker.Start();
        }

        void OpenStudio()
        {
            try
            {
                Studio.Launch();
                Close();
                Setup.OfferExportToolsOnce();
            }
            catch (Exception ex)
            {
                Studio.Log("launch failed: " + ex);
                ShowError("The studio wouldn't start: " + ex.Message);
            }
        }

        void Say(string headingText, string bodyText)
        {
            try
            {
                BeginInvoke((MethodInvoker)delegate { SetCopy(headingText, bodyText); });
            }
            catch { }
        }

        void RunSetup()
        {
            string problem = null;
            try
            {
                if (Studio.FindNode().Length == 0)
                {
                    Say("Getting things ready",
                        "Installing the small helper Windows needs. If a permission window appears, click Yes.");
                    problem = Setup.InstallNode();
                }

                if (problem == null && !Studio.ElectronReady())
                {
                    Say("Getting things ready",
                        "Downloading the studio window. This is the big one (around 100 MB) — it can take a " +
                        "few minutes, and it only happens once.");
                    problem = Setup.InstallElectron();
                }
            }
            catch (Exception ex)
            {
                Studio.Log("setup crashed: " + ex);
                problem = ex.Message;
            }

            string outcome = problem;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (outcome == null && Studio.ElectronReady()) ShowDone();
                    else ShowError(outcome != null ? outcome : "The studio window still isn't there.");
                });
            }
            catch { }
        }
    }

    /// <summary>The install steps. Every failure comes back as a plain-English sentence.</summary>
    internal static class Setup
    {
        /// <summary>Returns null on success, otherwise a friendly problem description.</summary>
        public static string InstallNode()
        {
            string script = Path.Combine(Studio.Root, "tools\\emergency\\SETUP-ADMIN.ps1");
            if (!File.Exists(script))
                return "A setup file is missing from the studio folder (tools\\emergency\\SETUP-ADMIN.ps1).";

            var psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Quiet -LogPath \"" + Studio.LogPath + "\"");
            psi.UseShellExecute = true;
            psi.Verb = "runas";
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.WorkingDirectory = Studio.Root;

            Process proc;
            try
            {
                proc = Process.Start(psi);
            }
            catch (Win32Exception ex)
            {
                Studio.Log("elevation failed: " + ex);
                if (ex.NativeErrorCode == 1223)
                    return "Windows asked for permission and got \u201cNo\u201d. The helper can't install without it.";
                return "Windows wouldn't start the installer: " + ex.Message;
            }

            if (proc == null) return "Windows wouldn't start the installer.";
            if (!proc.WaitForExit(20 * 60 * 1000))
                return "The helper install is taking unusually long. Try again, or ask Maddie.";
            if (proc.ExitCode != 0)
                return "The helper didn't install (code " + proc.ExitCode + "). You may be offline, or Windows' " +
                       "app installer isn't available on this PC.";
            if (Studio.FindNode().Length == 0)
                return "The helper installed but Windows hasn't picked it up yet. Close this window, then " +
                       "double-click Illustrated IF Studio again.";
            return null;
        }

        /// <summary>Returns null on success, otherwise a friendly problem description.</summary>
        public static string InstallElectron()
        {
            string node = Studio.FindNode();
            if (node.Length == 0) return "The helper Windows needs isn't installed yet.";

            string nodeDir = Path.GetDirectoryName(node);
            string npmCli = Path.Combine(nodeDir, "node_modules\\npm\\bin\\npm-cli.js");

            ProcessStartInfo psi;
            if (File.Exists(npmCli))
            {
                psi = new ProcessStartInfo(node,
                    "\"" + npmCli + "\" install --no-audit --no-fund --loglevel=error " + Studio.ElectronSpec);
            }
            else
            {
                string npmCmd = Path.Combine(nodeDir, "npm.cmd");
                if (!File.Exists(npmCmd)) return "Windows' package helper (npm) is missing next to Node.";
                psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe",
                    "/d /s /c \"\"" + npmCmd + "\" install --no-audit --no-fund --loglevel=error \"" +
                    Studio.ElectronSpec + "\"\"");
            }

            psi.WorkingDirectory = Studio.Root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["PATH"] = nodeDir + ";" + Environment.GetEnvironmentVariable("PATH");

            Studio.Log("npm install " + Studio.ElectronSpec);
            try
            {
                using (Process proc = Process.Start(psi))
                {
                    proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                    {
                        if (e.Data != null) Studio.Log("  npm | " + e.Data);
                    };
                    proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                    {
                        if (e.Data != null) Studio.Log("  npm ! " + e.Data);
                    };
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();
                    if (!proc.WaitForExit(30 * 60 * 1000))
                    {
                        try { proc.Kill(); } catch { }
                        return "The download stalled. Check your internet connection and try again.";
                    }
                    if (proc.ExitCode != 0)
                        return "The download didn't finish (code " + proc.ExitCode + "). This is usually the " +
                               "internet connection dropping.";
                }
            }
            catch (Exception ex)
            {
                Studio.Log("npm failed: " + ex);
                return "The download couldn't start: " + ex.Message;
            }

            if (!Studio.ElectronReady())
                return "The download finished but the studio window still isn't there.";
            return null;
        }

        /// <summary>
        /// One optional Yes/No: install Python and/or C++ tools for sharing games.
        /// Marker under tools\ so we never nag again. Safe to call on every launch.
        /// </summary>
        public static void OfferExportToolsOnce()
        {
            string marker = Path.Combine(Studio.Root, "tools\\.export-tools-offered");
            try
            {
                if (File.Exists(marker)) return;

                bool needPy = !Studio.HasPython();
                bool needCpp = !Studio.HasCppTools();
                if (!needPy && !needCpp)
                {
                    File.WriteAllText(marker, "already-present\r\n" + DateTime.Now.ToString("o") + "\r\n");
                    return;
                }

                string list = needPy && needCpp ? "Python games / C++ games"
                    : (needPy ? "Python games" : "C++ games");

                DialogResult go = MessageBox.Show(
                    "Also install tools for sharing games?\r\n\r\n" +
                    "The studio works either way. HTML game exports already playtest fine.\r\n\r\n" +
                    "If you say Yes, this PC can also run " + list + " without each zip having to install " +
                    "things later. Needs the internet and one Windows permission prompt (click Yes).\r\n\r\n" +
                    "C++ build tools are a LARGE download and can take a long while (sometimes 20–40 minutes). " +
                    "Python is usually a few minutes.\r\n\r\n" +
                    "Yes = install what's missing now\r\n" +
                    "No = skip (each game zip can still set itself up when opened)",
                    "Illustrated IF Studio",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);

                try
                {
                    File.WriteAllText(marker,
                        "asked=" + DateTime.Now.ToString("o") + ";accepted=" + (go == DialogResult.Yes) + "\r\n");
                }
                catch { }

                if (go != DialogResult.Yes) return;

                bool installPy = needPy;
                bool installCpp = false;
                if (needCpp)
                {
                    DialogResult cpp = MessageBox.Show(
                        "Include C++ build tools?\r\n\r\n" +
                        "This installs Visual Studio Build Tools. It can take a long time and uses several GB of disk.\r\n\r\n" +
                        "Yes = install C++ tools too\r\n" +
                        "No = only install Python (if needed)",
                        "Illustrated IF Studio",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question);
                    installCpp = cpp == DialogResult.Yes;
                    if (!installCpp && !installPy) return;
                }

                MessageBox.Show(
                    "Windows will ask for permission next — click Yes, then please wait. " +
                    "This window continues when setup finishes.",
                    "Illustrated IF Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);

                string problem = InstallExportTools(installPy, installCpp);
                if (problem != null)
                {
                    MessageBox.Show(
                        problem + "\r\n\r\nThe studio still works. You can retry from tools\\emergency\\SETUP-EXPORT-TOOLS.bat, " +
                        "or let each game zip install what it needs.",
                        "Illustrated IF Studio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                Studio.Log("offer export tools failed: " + ex);
            }
        }

        /// <summary>Returns null on success, otherwise a friendly problem description.</summary>
        public static string InstallExportTools(bool python, bool cpp)
        {
            string script = Path.Combine(Studio.Root, "tools\\emergency\\SETUP-EXPORT-TOOLS.ps1");
            if (!File.Exists(script))
                return "Sharing-tools setup file is missing (tools\\emergency\\SETUP-EXPORT-TOOLS.ps1).";

            System.Text.StringBuilder args = new System.Text.StringBuilder();
            args.Append("-NoProfile -ExecutionPolicy Bypass -File \"");
            args.Append(script);
            args.Append("\" -Quiet -LogPath \"");
            args.Append(Studio.LogPath);
            args.Append("\"");
            if (python) args.Append(" -Python");
            if (cpp) args.Append(" -Cpp");

            var psi = new ProcessStartInfo("powershell.exe", args.ToString());
            psi.UseShellExecute = true;
            psi.Verb = "runas";
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.WorkingDirectory = Studio.Root;

            Process proc;
            try
            {
                proc = Process.Start(psi);
            }
            catch (Win32Exception ex)
            {
                Studio.Log("export-tools elevation failed: " + ex);
                if (ex.NativeErrorCode == 1223)
                    return "Windows asked for permission and got \"No\". Sharing tools weren't installed.";
                return "Windows wouldn't start the sharing-tools installer: " + ex.Message;
            }

            if (proc == null) return "Windows wouldn't start the sharing-tools installer.";
            // C++ Build Tools can be very long; allow up to 90 minutes.
            if (!proc.WaitForExit(90 * 60 * 1000))
                return "Sharing-tools install is taking unusually long. You can leave it, or retry later from tools\\emergency.";
            if (proc.ExitCode != 0)
                return "Sharing-tools setup didn't finish (code " + proc.ExitCode + "). You may be offline.";
            return null;
        }
    }

    internal static class Program
    {
        [STAThread]
        static void Main(string[] argv)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool forceWizard = false;
            foreach (string arg in argv)
            {
                string a = arg.ToLowerInvariant();
                if (a == "--wizard") forceWizard = true;
                else if (a == "--simulate-no-node") { Studio.SimulateNoNode = true; Studio.SimulateNoElectron = true; forceWizard = true; }
                else if (a == "--simulate-no-electron") { Studio.SimulateNoElectron = true; forceWizard = true; }
                else if (a.StartsWith("--port=")) { int p; if (int.TryParse(a.Substring(7), out p)) Studio.Port = p; }
            }

            if (!Studio.Locate())
            {
                MessageBox.Show(
                    "Illustrated IF Studio can't find its own files.\r\n\r\nThis usually means the launcher was " +
                    "copied out of the studio folder on its own, or the folder was only partly unzipped. Unzip " +
                    "the whole folder again and double-click the launcher inside it.",
                    "Illustrated IF Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Studio.InitLog();
            Studio.Log("root: " + Studio.Root);

            if (!forceWizard && Studio.ElectronReady())
            {
                Application.Run(new SplashForm());
                // Ask about optional sharing tools only once the studio is actually up. A
                // first-ever double-click should open the studio, not a question about C++
                // build tools.
                if (Studio.StudioAnswering()) Setup.OfferExportToolsOnce();
                return;
            }

            Application.Run(new WizardForm());
        }
    }
}
