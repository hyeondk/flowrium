using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class WindowsUpdate {
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static string Env(string key) { return Environment.GetEnvironmentVariable("FLOWRIUM_UPDATE_" + key); }
    static void Trace(string step, object detail) {
        var record = new { at=DateTime.UtcNow.ToString("o"), step=step, helperPid=Process.GetCurrentProcess().Id, detail=detail };
        File.AppendAllText(Env("RESULT") + ".log", Json.Serialize(record) + Environment.NewLine, Utf8);
    }
    static Process Start(string exe, string args, string folder) {
        return Process.Start(new ProcessStartInfo(exe, args) { WorkingDirectory=folder, UseShellExecute=true });
    }
    static bool Matches(string file, int pid) {
        try { return File.ReadAllText(file).Trim() == pid.ToString(); } catch (IOException) { return false; }
    }
    static void WaitParent(int id) {
        Process parent;
        try { parent=Process.GetProcessById(id); } catch (ArgumentException) { return; }
        using (parent) if (!parent.WaitForExit(120000)) throw new IOException("Parent still running");
    }
    [STAThread]
    static int Main() {
        var target=Env("TARGET");
        var folder=Path.GetDirectoryName(target);
        var result=Env("RESULT");
        var receipt=Env("RECEIPT");
        var stage=Env("STAGE");
        var expected=Env("VERSION");
        var parentClosed=false;
        var installed=false;
        Process updated=null;
        try {
            Trace("helper-start",new { parentPid=Env("PID"), target=target, expectedVersion=expected });
            File.WriteAllText(receipt+".helper",Process.GetCurrentProcess().Id.ToString(),Utf8);
            WaitParent(Int32.Parse(Env("PID")));
            parentClosed=true;
            Trace("parent-closed",new {});
            var file=Env("FILE");
            Trace("installer-start-request",new {file=file,folder=folder});
            // NSIS expects its unquoted installation directory as the final argument.
            using (var installer=Start(file,"/S --updated /D="+folder,stage)) {
                if(installer==null) throw new IOException("Installer did not start");
                Trace("installer-started",new {installerPid=installer.Id});
                if(!installer.WaitForExit(300000)) throw new IOException("Installer timed out");
                Trace("installer-exit",new {code=installer.ExitCode});
                if(installer.ExitCode!=0) throw new IOException("Installer exit code " + installer.ExitCode);
            }
            var actual=Version.Parse(FileVersionInfo.GetVersionInfo(target).ProductVersion.Split('+',' ')[0]).ToString(3);
            Trace("installed-version",new {actual=actual,path=target});
            if(actual!=expected) throw new IOException("Installed version mismatch");
            installed=true;
            var args="--flowrium-update-token="+Env("TOKEN")+" \"--user-data-dir="+Path.GetDirectoryName(result)+"\"";
            updated=Start(target,args,folder);
            if(updated==null) throw new IOException("Updated application did not start");
            Trace("app-launched",new {appPid=updated.Id});
            var deadline=DateTime.UtcNow.AddMinutes(2);
            while(DateTime.UtcNow<deadline && !updated.HasExited) {
                if(Matches(receipt+".starting",updated.Id) && Matches(receipt+".ready",updated.Id)) {
                    updated.Refresh();
                    Trace("app-ready",new {appPid=updated.Id,appWindow=updated.MainWindowHandle.ToInt64(),actual=actual});
                    return 0;
                }
                Thread.Sleep(250);
            }
            throw new IOException("Updated application did not acknowledge readiness");
        } catch(Exception e) {
            try {
                Trace("failed",new {message=e.Message,installed=installed,parentClosed=parentClosed,
                    startedSignal=File.Exists(receipt+".starting"),readySignal=File.Exists(receipt+".ready")});
                File.WriteAllText(result,"failed",Utf8);
            } catch(IOException) {}
            if(updated!=null && !updated.HasExited) {
                updated.CloseMainWindow();
                if(!updated.WaitForExit(5000)) updated.Kill();
            }
            bool restored=false;
            if(parentClosed && !installed && File.Exists(target)) {
                try { restored=Start(target,"\"--user-data-dir="+Path.GetDirectoryName(result)+"\"",folder)!=null; }
                catch(System.ComponentModel.Win32Exception) {}
            }
            if(parentClosed && !restored &&
                MessageBox.Show("Flowrium을 다시 열지 못했습니다. 다운로드 페이지에서 설치 파일을 받을까요?",
                    "Flowrium 업데이트",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)==DialogResult.Yes)
                Process.Start("https://hyeondk.github.io/flowrium/");
            return 1;
        } finally {
            if(updated!=null) updated.Dispose();
            foreach(var ext in new[]{".json",".starting",".ready",".helper"})
                try {File.Delete(receipt+ext);} catch(IOException) {}
            for(var n=0;n<10;n++) {
                try {if(Directory.Exists(stage)) Directory.Delete(stage,true); break;}
                catch(IOException) {Thread.Sleep(200);}
                catch(UnauthorizedAccessException) {Thread.Sleep(200);}
            }
        }
    }
}
