# Troubleshooting / FAQ

OBS-specific issues (blank source, hidden badge, choppy animation) are covered
in [obs/README.md](../obs/README.md).

## Windows says: "We can't open this 'ms-gamingoverlay' link"

**This popup is not caused by Rewind Overlay.** It is a Windows quirk: the
Xbox Game Bar app has been uninstalled (or is broken), but Windows' Game DVR
feature is still enabled and tries to summon it whenever a game launches —
including Dolphin. With no app registered for the `ms-gamingoverlay:` protocol,
Windows shows that popup instead. You will see it on fresh machines when you
start Retro Rewind, with or without our overlay running.

Two fixes, pick one:

- **Keep Game Bar removed** — disable Game DVR so nothing invokes it. In an
  administrator PowerShell:

  ```
  reg add HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR /f /t REG_DWORD /v "AppCaptureEnabled" /d 0
  reg add HKEY_CURRENT_USER\System\GameConfigStore /f /t REG_DWORD /v "GameDVR_Enabled" /d 0
  ```

- **Restore Game Bar** — install "Xbox Game Bar" from the Microsoft Store
  again (then disable it under *Settings → Gaming → Xbox Game Bar* if you
  don't want it active).

References: [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1497050/ms-gamingoverlay-link-popup),
[MakeUseOf guide](https://www.makeuseof.com/windows-new-app-ms-gamingoverlay-error/).

## The overlay shows "Preview mode" instead of my real VR

Preview mode displays labeled sample data while the app watches for a real
identity. It switches to live data automatically as soon as your WheelWizard /
Retro Rewind save is found (or when you enter a friend code in Studio). If it
never switches, open Studio's identity panel — the detection trail lists
exactly which files were checked and where the chain stopped.

## My rating looks different from the save file

While you are online, the server's value is authoritative and the overlay
follows it live. Local files (`rksys.dat`, `RRRating.pul`) only seed the
display before the first server response and lag until Dolphin flushes the
save to disk.
