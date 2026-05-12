# Focus Desktop

Focus is a Windows-first desktop blocker inspired by mobile focus apps. It blocks websites across browsers through the Windows hosts file, tracks foreground app usage, supports profiles and schedules, and includes practical strict-mode locks.

## Development

Use `npm.cmd` on Windows because PowerShell may block `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run dev
```

## Important Windows Notes

- Website blocking edits `C:\Windows\System32\drivers\etc\hosts`, so run the app as administrator when applying real site blocks.
- Hosts-file blocking works across browsers, but it cannot inspect HTTPS page content or URL paths.
- App blocking uses foreground-window polling and displays a blocking overlay when a blocked executable is active.
