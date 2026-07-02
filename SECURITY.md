# Security Policy

## Supported versions

Lyra is pre-1.0 and under active development. Security fixes are applied to the
latest release and `main` only.

| Version | Supported |
|---|---|
| latest release / `main` | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately by either:

- Using GitHub's [private vulnerability reporting](https://github.com/EiseWilliam/project-lyra/security/advisories/new), or
- Emailing **williamseisenherz@gmail.com** with the subject line `Lyra security`.

Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version / commit and operating system.

You can expect an acknowledgement within a reasonable time. Please allow time
for a fix before any public disclosure.

## Scope notes

Lyra runs locally, has no account system, and sends no telemetry. Its only
outbound network requests are lyric lookups to [LRCLIB](https://lrclib.net).
Playback state is read locally from the Spotify desktop app via the OS. Reports
about local privilege issues, the AppleScript/SMTC bridges, the update/release
path, or unexpected network egress are all in scope.
