' Illustrated IF - friendly play launcher (no black console)
' Double-click this. It quietly starts play-quiet.ps1, which handles
' missing tools with plain-language pop-ups and then runs the game.

Option Explicit
Dim shell, fso, here, ps1, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = here & "\play-quiet.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Play helper is missing:" & vbCrLf & ps1 & vbCrLf & vbCrLf & _
    "Re-unzip the game folder, then try again. If it still fails, open _emergency and read README.txt.", _
    vbExclamation, "Illustrated IF"
  WScript.Quit 1
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
' 0 = hidden window, False = don't wait (play-quiet owns the lifetime)
shell.Run cmd, 0, False
