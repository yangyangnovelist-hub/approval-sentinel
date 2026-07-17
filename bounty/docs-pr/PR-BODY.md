# docs: onboarding troubleshooting guide, .env.example, CONTRIBUTING stub

## What

Documentation-only PR, three additions:

1. **`docs/self-hosting-troubleshooting.md`** — a troubleshooting guide covering the failure modes a new user actually hits between "signed up" and "first execution": the macOS Gatekeeper SIGKILL of the `kh` binary, the Streamable-HTTP MCP session handshake (and the misleading `Invalid JSON body` it produces when skipped), `kh doctor`'s mixed API-key/OAuth signals, missing tx hashes on synchronous `execute_*` responses, idempotency-key semantics, and free-plan action gating.
2. **`.env.example`** — a commented environment template so self-hosters and CLI/MCP users see every required variable in one place instead of discovering them from error messages.
3. **`CONTRIBUTING.md`** — a minimal stub (setup, test, PR conventions) so external contributors have an entry point.

No code changes. No behavior changes.

## Why

We onboarded from zero (fresh account → org → 2FA → API key → CLI → raw-HTTP MCP → first Sepolia execution → workflows → marketplace listing) during the Agents Onchain hackathon and logged every point of friction. The full write-up — 12 reproducible issues with severity, reproduction steps, and suggested fixes — is here: `https://github.com/yangyangnovelist-hub/approval-sentinel/blob/main/bounty/REPORT.md`.

Most of what we hit was not broken functionality but **missing documentation of working functionality**:

- The platform executed flawlessly once we knew the rules (session header on every MCP call, `function_args` as a JSON string, poll `get_direct_execution_status` for the hash).
- But each of those rules was learned from a generic error message rather than a doc. The worst case — the quarantined `kh` binary dying with exit 137 and zero output — looks identical to a broken release and costs a new macOS user their first session.

This PR is the documentation half of the onboarding friction already acknowledged in #1700: it doesn't fix the error messages (that's server/CLI work), but it makes every trap searchable and gives each one a copy-paste exit.

## Verification

Every command and error string in the added docs was reproduced on macOS 25.3 (arm64) against `app.keeperhub.com` (server `keeperhub v1.2.0`, `kh` via Homebrew) on 2026-07-16. The bare-HTTP handshake sequence is additionally exercised end-to-end by a ~50-line dependency-free script we published in `https://github.com/yangyangnovelist-hub/approval-sentinel/tree/main/bounty/starter-template`, which goes from an API key to a confirmed Sepolia tx hash.

Notes for maintainers:

- Variable names in `.env.example` should be double-checked against the current config loader — we drafted it from the hosted product's observable surface, marked the uncertain lines, and would rather delete a line than document a wrong one.
- Happy to split this into three PRs if smaller reviews are preferred, or to fold the troubleshooting content into an existing docs page instead of a new file.

Refs: #1700
