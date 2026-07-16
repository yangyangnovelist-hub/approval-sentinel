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
5. **The Streamable-HTTP MCP transport is undocumented in the "Connect your AI agent" step
   for raw/SDK-less clients.** A hand-rolled client must: (a) POST `initialize`, (b) read the
   `Mcp-Session-Id` **response header**, (c) POST a `notifications/initialized` with that
   header, and (d) send the header on every later request. Miss any of these and the server
   answers with a generic **`{"error":"Invalid JSON body"}`** — the same message it returns
   for an actually-malformed body — so the failure mode is indistinguishable from a JSON typo.
   Suggestion: document the bare-HTTP handshake, and make the session/transport error distinct
   from a JSON-parse error. (First-execution reproduction in `docs/first-execution.md`.)
6. **`execute_contract_call` / `execute_transfer` return `{executionId, status}` with NO
   transaction hash — even when `status` is already `"completed"` synchronously.** You must make
   a second `get_direct_execution_status` call to obtain `transactionHash` / `transactionLink`.
   Reasonable, but the execute response should say so (or include the hash when terminal), or an
   agent will report "done" with no receipt. Our executor always polls to a terminal state before
   trusting success. Minor DX.
7. **Reconciling "which wallet sent the tx" is confusing.** `get_wallet_integration.walletAddress`
   (the ERC-20 `allowance` owner, `0xC7d9…4dc5` in our org) differs from the execution status
   payload's `result.executedCall.topLevelTo` (`0x5af5…f07d`, the relayer/entrypoint hop). We only
   confirmed the true allowance-owner by reading `allowance(owner, spender)` on-chain for both
   candidates. Suggestion: surface the effective `from` (owner) address in the execution status.

## Friction points (workflow authoring — Task 2.4, 2026-07-16)

8. **`ai_generate_workflow` is disabled server-side but still advertised as the primary path.**
   `tools_documentation` says the workflow-creation flow is "call `ai_generate_workflow` with a
   natural language prompt", and `list_action_schemas` step 2 points there too — but calling it
   returns `503 {"error":"AI Prompt is disabled"}`. A new agent follows the documented happy path
   straight into a dead end. Suggestion: gate the docs on the feature flag, or return a
   `not_implemented`/`feature_disabled` code with a pointer to manual `create_workflow`.
9. **Free plan blocks every notification/compute action, so the canonical "monitor → notify"
   workflow can't be built at all.** `create_workflow` with `webhook/send-webhook`, `HTTP Request`,
   or `code/run-code` returns `402 upgrade_required` (`requiredPlan: pro`). Web3 read/write actions
   are free, but Discord/Telegram/webhook/email/HTTP/code — i.e. the entire "alert me" leg that
   almost every monitoring template implies — are Pro-only. The gating is only discoverable by
   attempting a create; `list_action_schemas` doesn't mark which actions need which plan.
   Suggestion: add a `requiredPlan` field per action in `list_action_schemas`, and/or surface it in
   `validate_workflow` so the wall is hit before build, not after.
10. **A failed `create_workflow` still reserves its Idempotency-Key.** Our first create attempts
    failed with `402` (Pro-gated actions). Retrying the *corrected* payload under the same
    `idempotency_key` then returned `409 idempotency_conflict` ("reused with a different request
    payload"). So a request that never succeeded nonetheless claimed the key, forcing a key
    rotation after every failed attempt. Expected behavior: only a *successful* (2xx) create should
    bind the idempotency key.
11. **Marketplace pricing has undocumented ordering + type friction.** (a) `update_workflow_listing`
    with `priceUsdcPerCall` as a **number** is rejected by the MCP input validator
    (`expected string, received number`) — it must be `"0.01"`. (b) Setting the price *while listed*
    returns `409 PRICE_CHANGE_WHILE_LISTED`; you must `unlist_workflow` → set price →
    `list_workflow` again. Neither the tool description nor `tools_documentation` mentions the
    string type or the unlist-first ordering.
12. **`call_workflow` 503s on a listed-but-disabled workflow with a misleading message.** Listing a
    workflow whose `enabled:false` succeeds, but calling it returns
    `503 "The workflow owner has disabled this workflow."` — which reads like an owner action, not
    a config state. `update_workflow enabled:true` fixes it. Suggestion: block listing a disabled
    workflow, or return a clearer `workflow_disabled`/`enable_required` hint. (Positive note: once
    enabled, `call_workflow` correctly returns a well-formed **x402 v2** payment challenge — exact
    scheme, USDC on Base, 0.01, `bazaar.discoverable:true` — and the tool honestly states it does
    not auto-pay, pointing to `@keeperhub/wallet` / agentcash / the UI. Good DX.)

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
