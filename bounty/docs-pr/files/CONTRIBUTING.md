# Contributing to KeeperHub

Thanks for your interest in contributing. This is a minimal guide; when in doubt, open an issue first and ask.

## Reporting issues

- Search existing issues before opening a new one.
- Include: platform + version (`kh version`, or server version from MCP `initialize`), exact command or API call, full verbatim error output, and what you expected.
- Onboarding/DX friction reports are welcome — small paper cuts compound; see #1700 for an example of a well-received report.

## Development setup

<!-- TODO(maintainers): fill in the real bootstrap for this repo -->

1. Fork and clone the repository.
2. Copy `.env.example` to `.env` and fill in the required variables.
3. Install dependencies and run the test suite before making changes, so you know the baseline is green on your machine.

## Pull requests

- Keep PRs focused: one logical change per PR. Docs-only PRs are welcome.
- Describe **what** changed and **why**; link related issues (`Refs: #...`).
- Add or update tests for behavior changes; docs changes should be verified against the current product (paste the command/output you checked).
- Be explicit about anything you could not verify — reviewers would rather see a marked assumption than a confident guess.

## Code of conduct

Be respectful and constructive. Maintainers may close issues or PRs that don't follow this guide.
