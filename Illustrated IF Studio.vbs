' Illustrated IF Studio - friendly launcher
' Double-click this to open the studio. No black window will appear; it starts
' the studio quietly and shows the app window when it's ready.

Dim fso, shell, scriptDir, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\tools\launch-studio.ps1"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"

' 0 = hidden window (no console flash), False = don't wait for it to finish
shell.Run cmd, 0, False
