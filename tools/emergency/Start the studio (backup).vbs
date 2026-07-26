' Illustrated IF Studio - backup launcher
'
' The normal way to open the studio is "Illustrated IF Studio" in the main
' folder. Use this one only if that stops working (for example if antivirus
' quarantined it). It does the same job the plain Windows way: starts the
' studio quietly, with no black window.

Dim fso, shell, emergencyDir, toolsDir, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

emergencyDir = fso.GetParentFolderName(WScript.ScriptFullName)
toolsDir = fso.GetParentFolderName(emergencyDir)
ps1 = toolsDir & "\launch-studio.ps1"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"

' 0 = hidden window (no console flash), False = don't wait for it to finish
shell.Run cmd, 0, False
