# Reverse-engineered API map

Observed on macOS with an MX Creative Keypad connected over USB-C on
2026-09-09. Only public documentation and local, read-only enumeration were
used. No authentication or firmware-update mechanism was bypassed.

## 1. Logitech support content

`https://support.logi.com/hc/en-us?mID=H061` is a legacy product router, not a
device API. It redirects to Zendesk article `42194049170199`, "Getting Started -
MX Keypad".

Public read endpoints:

```text
GET /api/v2/help_center/en-us/articles/42194049170199.json
GET /api/v2/help_center/en-us/categories.json
GET /api/v2/help_center/en-us/articles.json?label_names=<labels>
GET /api/v2/help_center/en-us/articles/42194049170199/stats/view.json
```

The article labels expose the product-content join:

```text
webproduct=d659a4ca-876d-11f1-8973-2112dc491b28
webcontent=productgettingstarted
webcontentid=d998ca00-876d-11f1-ae6d-5f76087a7c99
```

Useful product queries observed on the page:

```text
GET /api/v2/help_center/en-us/articles.json
  ?label_names=webproduct=d659a4ca-876d-11f1-8973-2112dc491b28,webcontent=productvideo
  &page[size]=100&sort_by=updated_at&sort_order=desc

GET /api/v2/help_center/en-us/articles.json
  ?label_names=webproduct=d659a4ca-876d-11f1-8973-2112dc491b28,webcontent=productdocument
  &page[size]=100&sort_by=updated_at&sort_order=desc
```

Treat these as public content APIs only. Ticket creation, account state, votes,
and other writes are separate authenticated Zendesk workflows and are not part
of this integration.

## 2. Supported control API: Logi Actions SDK

The production integration boundary is the Logi Plugin Service included with
Logi Options+:

```text
MX Keypad <-> Logi Plugin Service <-> plugin <-> AHP WebSocket server
```

The official Node package is `@logitech/plugin-sdk` (`0.1.1` observed). It
receives these launch-time environment variables:

```text
LPS_SERVER_URL
LPS_SESSION_TOKEN
LPS_PLUGIN_NAME
LPS_PLUGIN_PACKAGE_DIRECTORY_PATH
```

It connects to `LPS_SERVER_URL` over WebSocket, authenticates with the session
token, registers command/adjustment actions, handles execution events, and
answers display-name/image requests. Its current public Node API does not expose
an explicit "display changed" push.

The mature C# SDK exposes:

```text
PluginDynamicCommand.RunCommand
PluginDynamicCommand.GetCommandDisplayName
PluginDynamicCommand.GetCommandImage
PluginDynamicCommand.ActionImageChanged
PluginDynamicAdjustment.ApplyAdjustment
PluginDynamicAdjustment.AdjustmentValueChanged
Plugin.OnPluginStatusChanged
```

That makes C# the current recommended route for continuously changing session
tiles. Plugins are packaged as `.lplug4`; profiles are `.lp5`.

Local installation observed:

```text
/Applications/Utilities/LogiPluginService.app
~/Library/Application Support/Logi/LogiPluginService/
```

## 3. Direct USB/HID protocol

Direct HID is suitable for diagnostics and prototypes when Logi Plugin Service
is stopped.

USB identity:

```text
Manufacturer: Logitech
Product: MX Creative Keypad
VID: 0x046d
PID: 0xc354
Transport: USB
Vendor usage page: 0xff43
Max input report: 32 bytes
Max output report: 4095 bytes
```

The HID descriptor exposes:

| Report | Direction | Payload | Purpose |
|---|---|---:|---|
| `0x11` | input/output | 19 bytes | HID++ 2.0 long reports |
| `0x13` | input/output | 31 bytes | VLP input/control |
| `0x14` | output | 4094 bytes | Contextual display image stream |
| `0x04` | input | 1 byte | System control |
| `0x05` | input | 1 byte | Consumer control |

### HID++ long report

Twenty bytes including the report ID:

```text
[0]  report ID = 0x11
[1]  device index = 0xff
[2]  feature index
[3]  function << 4 | software ID
[4..19] parameters
```

Root feature `0x0000`, function `0`, resolves a 16-bit feature ID to an 8-bit
feature index.

### Reprogrammable controls (`0x1b04`)

Functions:

```text
0 get control count
1 get control info by index
2 get reporting state by control ID
3 set reporting state
```

Setting reporting bits `0x03` diverts a control and enables diverted-button
events. Save the original state and restore it on exit.

Control IDs:

```text
0x0001..0x0009  LCD keys 1..9
0x01a1          previous page
0x01a2          next page
```

### Contextual display (`0x19a1`)

Observed feature index `0x02`; display index `1`; output report `0x14`;
set-image function `2`. Display index `0` accepts USB writes but does not replace
the keypad's Logi splash image.
Each LCD key is 118×118 pixels in a 3×3 layout:

```text
origin: 23,6
gap: 40
tile positions: x = 23 + column*158, y = 6 + row*158
```

The complete key region is a 434×434 rectangle at `(23, 6)`. A set-image
operation may target this rectangle with one JPEG containing all nine keys and
the 40-pixel gaps. The bridge uses that atomic path when three or more tiles
change, avoiding nine serial JPEG encodes and image streams during a page
transition. One- and two-tile live updates continue to target their individual
118×118 regions.

The first 4095-byte VLP frame is:

```text
[0]      0x14
[1]      0xff
[2]      0x02
[3]      0x2b                 function 2, software ID 0x0b
[4]      VLP flags/sequence
[5]      display index
[6]      defer update
[7]      image count = 1
[8]      image format         0 = JPEG
[9..10]  x, big endian
[11..12] y, big endian
[13..14] width, big endian
[15..16] height, big endian
[17..19] image byte length, 24-bit big endian
[20..]   image bytes
```

Continuation frames keep bytes `0..4` and continue image data at byte `5`.
VLP byte bits: first `0x80`, last `0x40`, data `0x20`, sequence in low nibble.

## 4. Agent Host Protocol mapping

The bridge uses official package `@microsoft/agent-host-protocol` `0.9.0`.

```text
initialize(channel ahp-root://)
listSessions(channel ahp-root://)
createSession(channel <provider>:/<uuid>)
subscribe(channel <provider>:/<uuid>)
subscribe(channel ahp-chat://default/<base64url-session-uri>)
dispatch(chat/turnStarted)
root/sessionAdded
root/sessionRemoved
root/sessionSummaryChanged
```

`listSessions` returns the session URI in each item's `resource` property.
VS Code creates ordinary sessions provisionally: `createSession` does not emit
`root/sessionAdded` or `session/ready` until the first chat turn materializes
the session. Clients must not wait for readiness before starting that turn.
Subscribe to the deterministic default chat, dispatch `chat/turnStarted`, and
then consume session and chat actions through `chat/turnComplete`. For maximum
compatibility, use the provider as the session URI scheme, such as
`copilotcli:/<uuid>`.

Local standalone endpoints can be discovered without persisting their
connection tokens. VS Code publishes owner-only schema-v2 entries under
`<userDataPath>/agent-host/local-endpoint/entries/`. The bridge accepts only
live `standalone` entries with loopback TCP addresses and reads the token
directly into memory.

Session status is a bitset:

```text
Idle        1
Error       2
InProgress  8
InputNeeded 24
IsRead      32
IsArchived  64
```

Recommended keypad UX:

- nine LCD keys show the latest nine session summaries;
- page buttons move through older sessions;
- green = idle, blue = running, amber = input needed, red = error;
- pressing a tile subscribes to that session and surfaces pending input details;
- never bind a single press to automatic tool approval;
- add explicit hold/confirm interaction before dispatching
  `chat/toolCallConfirmed` or other consequential actions.

## 5. References

- Logitech support article:
  https://support.logi.com/hc/en-us/articles/42194049170199-Getting-Started-MX-Keypad
- Logitech Actions SDK:
  https://logitech.github.io/actions-sdk-docs/
- Logitech developer resources:
  https://logitech.github.io/hackathons/
- MX Creative Console WebHID prior art:
  https://github.com/mario-gutierrez/mx-creative-console-webhid
- Agent Host Protocol:
  https://microsoft.github.io/agent-host-protocol/
- AHP TypeScript client:
  https://www.npmjs.com/package/@microsoft/agent-host-protocol
