# KeeperHub onboarding friction log (zero → authenticated)

Raw notes for the "Best Onboarding UX Improvement" bounty. Timestamps are 2026-07-16 (UTC+8). Environment: macOS 25.3 (arm64), Homebrew, non-developer user assisted by an AI agent.

## What went smoothly

- Sign-up → org creation → 2FA (TOTP) wizard is clear; backup-codes step forces good hygiene.
- Onboarding wizard step 3 ("Connect your AI agent") shows the MCP endpoint and per-client
  setup commands — nice touch.
- Turnkey wallet auto-provisioned at org creation ("first runs are gas-sponsored" banner).
- API key mint requires BOTH email code + TOTP (step-up). Good security; see friction #2.

## Friction points

1. **`kh` CLI is killed instantly on macOS (SIGKILL, exit 137) after `brew install keeperhub/tap/kh`.**
   Cause: the binary ships with `com.apple.quarantine` (installed via cask), and Gatekeeper
   kills the unsigned binary with no error message at all — `kh version` just dies silently.
   A new user cannot tell this from a broken install. Fix on our side:
   `xattr -d com.apple.quarantine $(realpath $(which kh))`.
   Suggested upstream fix: sign/notarize the release binaries, or at minimum document the
   workaround in the install docs. (This is bounty-PR material.)
2. **API-key mint requires an email code + TOTP with no prior warning.** The "Create API Key"
   dialog only reveals the two-factor ceremony after you click Continue. An agent-assisted or
   headless user gets stuck mid-flow. Suggestion: state the requirement up front on the create
   form ("You'll confirm with email + authenticator codes").
3. **`kh doctor` shows `[warn] Wallet: requires authentication` and `[warn] Spend Cap: requires
   authentication` even when `Auth: authenticated` passes via `KH_API_KEY`.** Confusing signal:
   is the key broken or not? Apparently wallet/spend-cap checks need the OAuth session
   (`kh auth login`), not an org API key — the doctor output doesn't say which credential is
   missing or how to fix it. Suggestion: doctor hints per failed line.
4. Wizard step transitions render stale content for ~2s (step-2 panel visible while URL is
   already step 3) — an automation or fast user can click the wrong button. Minor.

## Verified-working quickstart (what the docs should say, condensed)

```bash
brew install keeperhub/tap/kh
xattr -d com.apple.quarantine "$(realpath "$(which kh)")"   # macOS only, until binaries are notarized
export KH_API_KEY=kh_...                                     # mint at app.keeperhub.com → avatar → API Keys
kh doctor                                                    # expect: API reachable, Auth authenticated
```

MCP smoke test without any SDK:

```bash
curl -s -X POST https://app.keeperhub.com/mcp \
  -H "Authorization: Bearer $KH_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'
# → serverInfo {"name":"keeperhub","version":"1.2.0"}
```
