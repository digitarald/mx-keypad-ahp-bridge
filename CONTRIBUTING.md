# Contributing

Thanks for helping improve the MX Keypad AHP bridge.

## Before opening an issue

- Search existing issues first.
- Do not include AHP tokens, endpoint registry contents, private session text,
  file contents, or other sensitive data.
- Include the macOS, Node.js, keypad firmware, and AHP server versions when
  reporting compatibility problems.
- Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.

## Development

1. Fork and clone the repository.
2. Install Node.js 22 or newer.
3. Run `npm ci`.
4. Make a focused change with tests.
5. Run `npm run check` and `npm run compile`.

Tests must not require a physical keypad or a live AHP server. Use fixture
servers and fake HID writers for deterministic coverage.

## Pull requests

- Explain the problem, the approach, and user-visible behavior.
- Keep unrelated refactoring out of the change.
- Update `README.md` or `API.md` when behavior or protocol knowledge changes.
- Preserve dry-run defaults and two-press confirmation for mutations.
- Never commit credentials, endpoint tokens, logs, or captured session content.

By contributing, you agree that your contribution is licensed under the MIT
License.
