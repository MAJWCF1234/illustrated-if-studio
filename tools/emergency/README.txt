EMERGENCY REPAIR - only open this if the studio won't start
===========================================================

Almost everyone can ignore this folder. To use Illustrated IF Studio you just
double-click "Illustrated IF Studio" back in the main folder. That's it.

Only come in here if you double-clicked the studio and NOTHING happened, or a
message told you to.


TRY THESE IN ORDER
------------------

0. If Windows showed a blue "Windows protected your PC" box when you double-
   clicked the studio, that is NOT a broken install. Go back, click
   "More info", then "Run anyway". You can ignore the steps below.

1. Double-click:  Start the studio (backup)
   Same job as the normal launcher, done a different way. If antivirus ate the
   normal one, this usually still works.

2. Double-click:  SETUP-ADMIN.bat
   Windows will ask "Do you want to allow this app to make changes?" - click YES.
   (This is Windows finishing a one-time install. It needs the internet.)
   Let it run until it says it's done, close that window, then go back to the
   main folder and double-click "Illustrated IF Studio" again.

That fixes it 99% of the time.


WHAT THESE FILES ARE (for the curious - you don't need to touch them)
--------------------------------------------------------------------

Start the studio (backup)
    A plain-Windows way to open the studio, for when the normal launcher is
    blocked or missing.

SETUP-ADMIN.bat / SETUP-ADMIN.ps1
    Installs the one background program the studio needs (Node.js).
    Run it once if the studio says something is missing.

RUN-EDITOR.bat / RUN-EDITOR.ps1
    Opens the studio the "manual" way, in a black text window, so you can see
    any error messages. Only useful if the normal launcher is misbehaving and
    you want to show someone what went wrong.


STILL STUCK?
------------
Ask Maddie. The useful thing to send her is the file:

    tools\logs\last-startup.txt

(it's just a plain text file of what the studio tried to do), plus a photo of
whatever error you see. The manual RUN-EDITOR.bat window above is the best
thing to screenshot.
