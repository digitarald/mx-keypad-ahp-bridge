# Security policy

## Supported versions

This proof of concept does not have stable release branches. Security fixes are
made on the latest `main` branch.

## Reporting a vulnerability

Please use
[GitHub private vulnerability reporting](https://github.com/digitarald/mx-keypad-ahp-bridge/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected version or commit, impact, reproduction steps, and any
suggested mitigation. Remove AHP tokens, private session content, file contents,
and personal information from reports unless they are essential to explain the
issue.

You should receive an acknowledgement within seven days. Please allow time for
investigation and remediation before public disclosure.

## Security boundaries

The bridge controls a local USB HID device and can dispatch consequential AHP
actions. Its safety depends on loopback endpoint validation, token redaction,
dry-run defaults, and two-press confirmation. Reports that bypass these
boundaries are especially valuable.
