# MX Keypad AHP bridge

[![CI](https://github.com/digitarald/mx-keypad-ahp-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/digitarald/mx-keypad-ahp-bridge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/digitarald/mx-keypad-ahp-bridge/actions/workflows/codeql.yml/badge.svg)](https://github.com/digitarald/mx-keypad-ahp-bridge/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An experimental direct-HID bridge that turns a Logitech MX Creative Keypad
into a monitor and guarded controller for local
[Agent Host Protocol](https://microsoft.github.io/agent-host-protocol/) sessions.

> [!WARNING]
> This is an unofficial proof of concept based on observed device behavior.
> It is not affiliated with, endorsed by, or supported by Logitech or Microsoft.
> Direct HID access can conflict with Logitech Options+ and Plugin Service. Use
> it at your own risk.

## Features

- Discovers live local AHP endpoints without persisting connection tokens.
- Handles paginated catalogues with more than 100 sessions.
- Shows nine active sessions per page, ordered by recent activity.
- Displays status, activity, latest tool call, and compact change statistics.
- Uses Codicons, wrapped labels, and atomic full-grid transitions.
- Reconnects after AHP restarts and USB hot-plug events.
- Supports guarded session and turn controls with visible confirmation.

## Requirements

- macOS (the launchd service is macOS-specific).
- Node.js 22 or newer.
- Logitech MX Creative Keypad connected over USB-C (`046d:c354`).
- A local AHP 0.9-compatible server published through VS Code's endpoint
  registry, or an explicit loopback WebSocket URL.

The direct-HID protocol has only been tested with the hardware and firmware used
during development. Other devices or firmware versions may behave differently.

## Safety model

- Only opens Logitech USB HID device `046d:c354`.
- Starts in `--dry-run` mode unless `--write-device` is passed.
- Restores the keypad's original diverted-key reporting configuration on exit.
- Does not implement firmware updates, pairing, or arbitrary feature writes.
- Uses only local WebSocket endpoints unless `--allow-remote` is passed.
- Accepts AHP query-token URLs without persisting them and redacts query
  parameters from connection logs.
- Requires two presses for every state-changing action.
- Never guesses free-form input, authentication, or ambiguous approval scopes.

## Key map

The nine LCD keys represent AHP sessions ordered by most recent modification.
Press once to select a session and press the selected tile again to open its
live dashboard. The dashboard shows status, activity, workspace, and pending
input, and exposes the controls currently supported by that session. Codicons
distinguish actions from status at a glance, longer titles and activity wrap
onto two lines, and the stats tile shows the latest tool call, turn count, and
available file/addition/deletion totals:

- mark read/unread;
- archive/restore;
- cancel an active turn or resume a resumable failed turn;
- approve/reject tool and result confirmations;
- accept already-answerable input or decline input.

Every state-changing control uses a five-second two-press confirmation. Requests
that require text entry or authentication direct the user back to VS Code
instead of guessing an unsafe response. Key 1 or the previous-page button
returns to the session grid.

The page buttons move through additional sessions in groups of nine.

Full grid-to-dashboard transitions are composed as one image so they arrive
atomically. Small live changes remain incremental and update only the affected
tile.

## Install and run

```bash
npm ci
npm run check
npm start -- --dry-run
```

The bridge discovers live local AHP TCP endpoints from VS Code's owner-only
endpoint registry. The connection token stays in memory and is never copied
into bridge configuration or logs. `--ahp` remains available as an explicit
override.

After validating discovery and AHP connectivity:

```bash
npm start -- --write-device
```

Use `--no-display` to receive key events without updating LCD tiles.
Do not run Logi Plugin Service/Options+ with `--write-device`; two processes
must not attempt to own the keypad concurrently.

Useful options:

```text
--dry-run             Do not open or write to the HID device
--write-device        Enable direct HID control
--no-display          Receive key events without updating LCD tiles
--poll <milliseconds> Set the AHP/device refresh interval
--ahp <url>           Override local AHP endpoint discovery
--allow-remote        Permit a non-loopback explicit AHP URL
```

## User service

On macOS, install the tested direct bridge as a launchd user service:

```bash
npm run service:install
```

The service installs a self-contained runtime under
`~/Library/Application Support/MxKeypadAhpBridge`, starts at login, reconnects
when AHP restarts, waits for the keypad when it is unplugged, automatically
reattaches after USB reconnect, and writes logs to
`~/Library/Logs/mx-keypad-ahp-bridge.log`. Remove it with:

```bash
npm run service:uninstall
```

The Logi Actions SDK was validated on the physical keypad: key callbacks and
`ActionImageChanged()` both work. Its profile/action abstraction did not offer
the deterministic full-grid behavior needed here, so the direct bridge is the
primary path and the SDK remains a fallback.

## Development

```bash
npm ci
npm run check
npm run compile
```

Tests use fixture AHP servers and fake HID writers; CI does not require physical
hardware. See [API.md](API.md) for the reverse-engineered HID/VLP details and
the AHP integration notes.

## Contributing and support

Bug reports and focused improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Use GitHub
issues for public support and [SECURITY.md](SECURITY.md) for private
vulnerability reporting.

## License and trademarks

Released under the [MIT License](LICENSE). Third-party dependencies retain
their own licenses; see [NOTICE.md](NOTICE.md).

Logitech, MX Creative Console, Visual Studio Code, and Microsoft are trademarks
of their respective owners. Their use here is solely descriptive.
