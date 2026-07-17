# KeeperHub onboarding UX report: zero → first onchain execution

Submission for the **Best Onboarding UX Improvement** bounty (KeeperHub Agents Onchain, DoraHacks).

- **Method:** one real, complete onboarding run — sign-up → org → 2FA → API key → CLI → MCP → first Sepolia execution → workflows → marketplace listing — performed by a non-developer user assisted by an AI agent, with every friction point logged the moment it happened.
- **Environment:** macOS 25.3 (arm64), Homebrew, `kh` via `brew install keeperhub/tap/kh`, MCP endpoint `https://app.keeperhub.com/mcp`, server `keeperhub v1.2.0`. Captured 2026-07-16 (UTC+8).
- **Raw log:** [`onboarding-notes.md`](onboarding-notes.md) (this report is the structured version; the notes keep original timestamps and verbatim errors).
- **Everything below is reproducible** — each issue lists concrete reproduction steps, and where we hit a wall we shipped a workaround you can run (final section).

## Executive summary

The KeeperHub happy path is genuinely good: the sign-up → org → 2FA wizard is clear, a Turnkey wallet is auto-provisioned with sponsored first runs, and the "Connect your AI agent" step showing per-client MCP setup is a nice touch. We got from nothing to a real, gas-sponsored Sepolia contract call in one session — and then to two MCP-authored workflows and a priced x402 marketplace listing.

But the path is booby-trapped in four places where a new user has **no error message, a wrong error message, or a documented dead end**:

1. On macOS the `kh` CLI is **silently SIGKILLed by Gatekeeper** right after install — the single worst first impression possible (ONB-01).
2. A hand-rolled MCP client that misses the undocumented Streamable-HTTP session handshake gets `"Invalid JSON body"` — **indistinguishable from a JSON typo** (ONB-02).
3. The documented workflow-creation happy path, `ai_generate_workflow`, is **disabled server-side** and 503s (ONB-03).
4. The canonical "monitor → notify" workflow **cannot be built on the free plan**, and you only find out per-action, post-hoc, via 402s (ONB-04).

None of these are deep product flaws — all twelve issues below have small, targeted fixes (most are docs or error-message changes). Fixing just the top four would remove every hard stop we hit.

**Issue index:** 12 issues = 1 critical, 3 high, 6 medium, 2 low. IDs are ordered by severity; the "notes #" column maps to the raw log.

## Severity table

| ID | Sev | Area | Issue | Notes # |
| --- | --- | --- | --- | --- |
| ONB-01 | Critical | CLI install | `kh` silently SIGKILLed on macOS (quarantine, exit 137, no message) | 1 |
| ONB-02 | High | MCP transport | Streamable-HTTP handshake undocumented; failure mode is a generic `Invalid JSON body` | 5 |
| ONB-03 | High | Workflows | `ai_generate_workflow` advertised as the primary path but disabled (503) | 8 |
| ONB-04 | High | Plans/pricing | Free plan blocks every notify/compute action; gating undiscoverable until a 402 | 9 |
| ONB-05 | Medium | Direct execution | `execute_*` returns no tx hash, even when synchronously `completed` | 6 |
| ONB-06 | Medium | Workflows API | A *failed* `create_workflow` still burns its Idempotency-Key (later retry → 409) | 10 |
| ONB-07 | Medium | Marketplace | Price must be a string; changing price while listed → 409; neither documented | 11 |
| ONB-08 | Medium | Marketplace | `call_workflow` on a listed-but-disabled workflow 503s with a misleading message | 12 |
| ONB-09 | Medium | CLI | `kh doctor` shows `[warn]` wallet/spend-cap lines even when API-key auth is healthy | 3 |
| ONB-10 | Medium | Execution status | Allowance-owner wallet vs. relayer `topLevelTo` — effective `from` is not surfaced | 7 |
| ONB-11 | Low | API keys | Email-code + TOTP step-up revealed only mid-flow, with no upfront warning | 2 |
| ONB-12 | Low | Web wizard | Wizard step transitions render stale content for ~2s | 4 |

---

## ONB-01 · Critical — `kh` CLI is silently killed on macOS after a normal Homebrew install

**Reproduction**

```bash
brew install keeperhub/tap/kh
kh version
# → killed instantly: SIGKILL, exit code 137, zero output
```

**Impact.** The very first command a new macOS user runs after the very first install step dies with *no output at all*. Cause: the binary ships with the `com.apple.quarantine` attribute (cask install) and Gatekeeper kills the unsigned binary before it prints a byte. A new user cannot distinguish this from a broken install, a bad download, or an incompatible CPU — and nothing in the install docs mentions it. This is a full stop at minute one, on the platform most agent developers use.

**Workaround (ours)**

```bash
xattr -d com.apple.quarantine "$(realpath "$(which kh)")"
kh version   # now works
```

**Suggested fix.** Sign and notarize the release binaries (proper fix). Until then: print the `xattr` one-liner in the Homebrew caveats section and in the install docs, and have `brew install` output point at it. A prepared docs patch is in [`docs-pr/`](docs-pr/).

---

## ONB-02 · High — Streamable-HTTP MCP handshake is undocumented, and getting it wrong returns the same error as malformed JSON

**Reproduction.** Build any SDK-less MCP client against `https://app.keeperhub.com/mcp` and skip one of the four required steps:

1. POST `initialize`;
2. read the **`Mcp-Session-Id` response header** (not the body);
3. POST `notifications/initialized` with that header;
4. send the header on **every** subsequent request.

Miss any of 2–4 and every call answers `{"error":"Invalid JSON body"}` — the exact message returned for an actually malformed body.

**Impact.** The "Connect your AI agent" onboarding step covers named clients (Claude, Cursor, …) but not raw HTTP, which is what any custom harness, curl smoke test, or non-Node agent does first. Because the transport error is aliased to the JSON-parse error, we spent the debugging cycle re-validating perfectly valid JSON. This is the highest-cost *diagnosable* failure we hit.

**Suggested fix.** (a) Document the bare-HTTP handshake (four steps above — a 10-line curl example suffices; one is in our notes and in [`starter-template/`](starter-template/)). (b) Return a distinct error for a missing/unknown session, e.g. `{"error":"missing_mcp_session","hint":"POST initialize first; echo the Mcp-Session-Id header"}`.

---

## ONB-03 · High — the documented workflow happy path (`ai_generate_workflow`) is a dead end

**Reproduction**

```bash
node workflows/scripts/kh-mcp.mjs ai_generate_workflow '{"prompt":"weekly allowance check"}'
# → 503 {"error":"AI Prompt is disabled"}
```

`tools_documentation` says workflow creation should start with "call `ai_generate_workflow` with a natural language prompt", and `list_action_schemas` step 2 points there too.

**Impact.** A new agent follows the official docs straight into a 503. There is no signal *before* the call that the feature is off, and the error gives no next step. We only progressed by reverse-engineering node/edge shapes for manual `create_workflow` from `list_action_schemas`.

**Suggested fix.** Gate the docs text on the feature flag (don't advertise a disabled tool), or return a structured `feature_disabled` code whose message points to manual `create_workflow` + `validate_workflow`.

---

## ONB-04 · High — free plan blocks the entire "notify" leg, and the gating is only discoverable by failing

**Reproduction.** On a free org, `create_workflow` with any of `webhook/send-webhook`, `HTTP Request`, or `code/run-code` →

```
402 upgrade_required   requiredPlan: pro
```

`list_action_schemas` lists all these actions with no plan annotation.

**Impact.** The canonical monitoring template — *trigger → check → alert me* — cannot be built at all on the plan every new user starts on, and you learn this action-by-action, after authoring the whole workflow JSON. Web3 read/write actions are free, so the wall is exactly at the moment of first delight ("it read the chain! now tell me about it → 402").

**Suggested fix.** Add `requiredPlan` per action in `list_action_schemas`, and surface plan violations in `validate_workflow` so the wall is hit before build, not after. (Our free-plan workaround: wire the real Schedule/Event triggers to a live on-chain `allowance()` read, and keep the full notify definitions ready for a Pro org — see `../workflows/definitions/`.)

---

## ONB-05 · Medium — `execute_transfer` / `execute_contract_call` return no transaction hash

**Reproduction.** Any direct execution returns `{executionId, status}` only — even when `status` is already `"completed"` in the synchronous response. The hash exists, but only via a second `get_direct_execution_status` call.

**Impact.** An agent that trusts the synchronous `completed` reports success *with no receipt*. Every downstream consumer (user, audit log, judge) wants the tx link; omitting it from the terminal response guarantees a second round-trip and invites agents to skip it.

**Suggested fix.** Include `transactionHash`/`transactionLink` in the execute response whenever the status is terminal; otherwise state in the tool description that a status poll is required. (Our executor always polls to a terminal state before trusting anything — see final section.)

---

## ONB-06 · Medium — a failed `create_workflow` still reserves its Idempotency-Key

**Reproduction.** (1) `create_workflow` with a Pro-gated action and `idempotency_key: K` → 402. (2) Fix the payload, retry with the same `K` → `409 idempotency_conflict` ("reused with a different request payload").

**Impact.** The natural retry loop — fail, fix, retry — is punished: every failed attempt burns a key, so clients must rotate keys after *errors*, which defeats the point of idempotency for exactly the requests that need retrying.

**Suggested fix.** Only bind the idempotency key on a 2xx. If the current behavior is intentional (replay-of-error semantics), document it and return the original 402 instead of a 409.

---

## ONB-07 · Medium — marketplace pricing has undocumented type and ordering rules

**Reproduction.** (a) `update_workflow_listing` with `priceUsdcPerCall: 0.01` (number) → input-validator rejection `expected string, received number`; `"0.01"` works. (b) Setting a price while the workflow is listed → `409 PRICE_CHANGE_WHILE_LISTED`; required order is `unlist_workflow` → set price → `list_workflow`.

**Impact.** Two silent contract details, neither in the tool description nor in `tools_documentation`; each costs a failed-call → read-error → guess cycle. The string-typed decimal is especially surprising in a JSON schema.

**Suggested fix.** Document both in the tool descriptions; ideally accept numbers and normalize, and make the 409 message spell out the unlist-first sequence.

---

## ONB-08 · Medium — calling a listed-but-disabled workflow returns a misleading 503

**Reproduction.** `list_workflow` succeeds on a workflow with `enabled: false`. A consumer's `call_workflow` on that slug → `503 "The workflow owner has disabled this workflow."`

**Impact.** The message reads like a deliberate owner action, when the actual state is "owner forgot one flag". Consumers walk away; owners don't know anything is wrong — the listing looked successful.

**Suggested fix.** Either block listing a disabled workflow, or return `workflow_disabled` with an owner-facing hint (`update_workflow enabled:true`). Positive note worth keeping: once enabled, `call_workflow` returns a well-formed x402 v2 challenge and honestly says it doesn't auto-pay, pointing at `@keeperhub/wallet` / agentcash / the UI. That part is good DX.

---

## ONB-09 · Medium — `kh doctor` mixes credential domains without saying so

**Reproduction.** With a valid `KH_API_KEY` exported: `kh doctor` → `Auth: authenticated` but `[warn] Wallet: requires authentication` and `[warn] Spend Cap: requires authentication`.

**Impact.** The one diagnostic a stuck user runs answers "your key works" and "you're not authenticated" in the same screen. The wallet/spend-cap checks apparently need the OAuth session (`kh auth login`), not an org API key — but nothing on the output says which credential is missing or how to get it.

**Suggested fix.** Per-line hints: `[warn] Wallet: requires browser session — run 'kh auth login'`. One string change per line removes the ambiguity.

---

## ONB-10 · Medium — which wallet actually sent the tx is hard to reconcile

**Reproduction.** `get_wallet_integration.walletAddress` = `0xC7d9…4dc5` (the true ERC-20 `allowance` owner). But `get_direct_execution_status → result.executedCall.topLevelTo` = `0x5af5…f07d` (relayer/entrypoint hop). No field in the status payload names the effective owner/`from`.

**Impact.** For an approval-security tool the owner address is *the* load-bearing fact. We only confirmed it by reading `allowance(owner, spender)` on-chain for both candidates — an extra RPC investigation no integrator should need.

**Suggested fix.** Surface the effective owner (the wallet-integration address) explicitly in the execution status payload, and note in docs that `topLevelTo` is infrastructure, not the sender.

---

## ONB-11 · Low — API-key creation reveals its two-factor ceremony only mid-flow

**Reproduction.** Dashboard → API Keys → Create: only after clicking Continue does the dialog demand an email code *and* a TOTP code.

**Impact.** The step-up itself is good security. But an agent-assisted or headless user enters the flow without email/authenticator at hand and stalls mid-dialog. One sentence on the create form ("You'll confirm with email + authenticator codes") sets expectations.

**Suggested fix.** State the requirement up front on the create form.

---

## ONB-12 · Low — onboarding wizard renders stale step content for ~2s

**Reproduction.** Advance the onboarding wizard; the URL moves to step 3 while the step-2 panel stays rendered for roughly two seconds.

**Impact.** A fast user (or an automation driving the flow) can click a control belonging to the previous step. Cosmetic, but it's the first two minutes of product experience.

**Suggested fix.** Block interaction or show a skeleton during the transition.

---

## What we built because of these issues

Every hard stop above turned into a shipped, reusable workaround — which is also the evidence that each issue is real and each suggested fix is sufficient:

- **ONB-01 →** the quarantine one-liner (`xattr -d com.apple.quarantine "$(realpath "$(which kh)")"`) is baked into our verified quickstart, the [`starter-template/`](starter-template/) README, and the prepared install-docs patch in [`docs-pr/`](docs-pr/).
- **ONB-02 →** [`../workflows/scripts/kh-mcp.mjs`](../workflows/scripts/kh-mcp.mjs), a dependency-free ~120-line Node client that implements the full handshake (initialize → capture `Mcp-Session-Id` header → `notifications/initialized` → header on every call) and drove all 17 MCP tools we used. A minimal ~40-line variant that goes all the way to a first onchain execution is the core of the starter template.
- **ONB-05 →** our revoke executor ([`../agent/src/revoke.ts`](../agent/src/revoke.ts)) never trusts a synchronous `completed`: it always polls `get_direct_execution_status` to a terminal state and refuses to report success without a transaction hash; failures carry the KeeperHub run URL.
- **ONB-06 →** all our writes use date-scoped idempotency keys and rotate on failed attempts, so retries replay successes but never 409 on fixes.
- **ONB-03 / ONB-04 →** manual `create_workflow` authoring with free-plan-safe actions (real Schedule/Event triggers → live `allowance()` read), with the full Pro notify designs preserved verbatim in [`../workflows/definitions/`](../workflows/definitions/) so upgrading is one identical MCP call.

The starter template ([`starter-template/`](starter-template/)) packages the ONB-01/02/05 workarounds into a five-minute zero-to-first-execution path, and [`docs-pr/`](docs-pr/) contains a ready-to-open upstream PR (troubleshooting guide, `.env.example`, CONTRIBUTING stub) that references the officially acknowledged auth friction in KeeperHub issue #1700.
