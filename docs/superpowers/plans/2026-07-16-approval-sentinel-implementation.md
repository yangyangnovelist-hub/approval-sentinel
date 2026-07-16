# ApprovalSentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude agent that scans a wallet's ERC-20 approvals, explains risk in plain English, and executes `approve(spender, 0)` revocations on Ethereum through KeeperHub — plus the $1k onboarding-bounty package.

**Architecture:** Three independent units: (1) `scanner/` — read-only TypeScript library + CLI (viem) that turns an address into risk-scored approval findings; (2) `agent/` — thin Claude Agent SDK harness wired to the KeeperHub MCP server (`https://app.keeperhub.com/mcp`, API-key auth) that presents findings and executes revocations; (3) `workflows/` — KeeperHub workflow definitions (scheduled rescan, approval-event alert) plus the marketplace paid-scan wrapper. Bounty package lives in `bounty/` and is produced from onboarding notes taken during integration.

**Tech Stack:** TypeScript + viem + vitest (scanner), Claude Agent SDK + KeeperHub MCP (agent), `kh` CLI (`brew install keeperhub/tap/kh`), `@keeperhub/wallet` (x402/MPP payments), Sepolia for rehearsal → Ethereum mainnet (sponsored gas) for demo.

**Ground truth (from 2026-07-15 research; re-verify at kickoff):**
- MCP: `https://app.keeperhub.com/mcp`, OAuth 2.1 or `kh_` API key; key tools: `execute_contract_call`, `get_execution`, `create_workflow`, `search_workflows`, `call_workflow`, `get_wallet_integration`.
- Execution chains include Ethereum/Sepolia; payment chains are ONLY Base/Tempo — do not conflate.
- Wallet: KeeperHub-managed (Turnkey); gas sponsorship via Turnkey Gas Station, testnets free.
- Auth friction (401 → API key step-up → 2FA) is officially acknowledged in KeeperHub issue #1700 — document every hiccup for the bounty report.
- Build window 07-27 → 08-13; submission needs repo + demo video + a KeeperHub-executed tx link.

**USER ACTIONS (blocking Phase 2+):** create KeeperHub account at app.keeperhub.com, generate `kh_` API key (2FA), and confirm hackathon gas-sponsorship details in the KeeperHub Discord (builder channel) once the event opens.

---

## Phase 1 — Scanner (no KeeperHub dependency; can start any time)

### Task 1.1: Bootstrap package

- [ ] `npm create vite@latest` style minimal TS lib: `package.json` (type module), `tsconfig.json`, vitest; commit `chore: scaffold scanner package`

### Task 1.2: Approval indexer (TDD per unit)

- [ ] `src/fetchApprovals.ts`: `getLogs` for `Approval(address,address,uint256)` topic filtered by owner over chunked block ranges (public RPC limits), dedupe to latest per (token, spender), then `allowance(owner, spender)` via multicall to keep only live ones. Unit tests with a mocked viem transport fixture (recorded log entries checked into `test/fixtures/`).
- [ ] `src/riskScore.ts`: score = f(unlimited?, spender in `data/known-protocols.json` allowlist?, age in days, token has allowance but owner balance > 0?). Output `Finding {token, symbol, spender, spenderLabel?, allowance, unlimited, ageDays, score, reasons[]}` sorted desc. Table-driven tests.
- [ ] `src/cli.ts`: `sentinel scan <address> [--chain sepolia|mainnet] [--json]` — human table + `--json` for the agent. Test via vitest running the CLI against fixtures.
- [ ] Commit per red-green pair.

### Task 1.3: Sepolia rehearsal fixtures

- [ ] `contracts/TestToken.sol` (plain OpenZeppelin ERC-20) + a forge script that mints and issues two unlimited approvals to dummy spenders from the dev key — gives the demo a deterministic "dirty wallet". Deploy to Sepolia; record addresses in `docs/deployments.md`; commit.

## Phase 2 — KeeperHub integration (needs user's API key)

### Task 2.1: Onboarding run-through (bounty raw material)

- [ ] Follow docs zero-to-first-transaction on Sepolia via MCP (`claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp`) and CLI (`kh auth login`, `kh doctor`); log every friction point verbatim into `bounty/onboarding-notes.md` (timestamped, reproducible)
- [ ] First KeeperHub-executed Sepolia tx (simple transfer) — save execution id + explorer link

### Task 2.2: Revocation executor

- [ ] `agent/src/revoke.ts`: build `approve(spender, 0)` calldata (viem `encodeFunctionData`), submit via MCP `execute_contract_call`, poll `get_execution` until terminal, return {txHash, runUrl}. Integration-test on Sepolia against TestToken (assert allowance actually 0 after)
- [ ] Error paths: failed execution surfaces KeeperHub error + run link, never claims success without receipt. Commit.

### Task 2.3: Agent harness

- [ ] `agent/src/index.ts`: Claude Agent SDK session with system prompt (security-analyst persona, MUST get explicit user confirmation listing token+spender before each revoke, one revoke per confirmation), tools = scanner-as-tool + revoke-as-tool. Conversation smoke test on Sepolia dirty wallet end-to-end. Commit.

### Task 2.4: Workflows + marketplace loop

- [ ] `sentinel-rescan` (Schedule weekly → webhook to scan service → Telegram summary node) and `sentinel-alert` (Event trigger on Approval where owner=watched → notify) — author via MCP `create_workflow`, export JSON into `workflows/`, document run links
- [ ] Deploy scanner as a tiny HTTP service (Render/Fly free tier or `workflows` webhook target), publish `approval-risk-scan` marketplace workflow at $0.01; agent pays for its own scan via `@keeperhub/wallet` (MPP default; $5 client cap untouched). Record one paid call on x402scan/tempo explorer. Commit.

## Phase 3 — Mainnet demo + submission (08-05 → 08-13)

- [ ] Mainnet run from dedicated demo wallet: scan a real (own) address, revoke 2-3 stale approvals through KeeperHub with sponsored gas; capture Etherscan links + Keeper Run pages
- [ ] Demo video (≤3 min, English script provided to user): problem → scan → agent explains → confirm → live mainnet revoke → audit trail + retry/gas handling shown → marketplace self-pay loop
- [ ] README (English): architecture, judging-criteria map (execution/surfaces/reliability/usefulness), run-it-yourself
- [ ] Bounty package: polish `bounty/onboarding-notes.md` into a structured pain-point report; `create-keeperhub-agent` starter template repo (MCP config + wallet skill + hello-world Sepolia workflow + `kh doctor` CI); docs PR to KeeperHub/keeperhub (`.env.example`, self-hosting troubleshooting, CONTRIBUTING stub) referencing issue #1700
- [ ] USER: submit BUIDL on DoraHacks (repo, video, tx link) before 08-13 12:00 UTC+2

---

## Self-review notes

- Spec coverage: scanner (1.2), agent+confirmation (2.3), workflows (2.4), marketplace creator+consumer (2.4), audit-trail narrative (Phase 3 video), bounty trio (2.1 + Phase 3), Sepolia-first safety (1.3, 2.2). Division of labor: user actions boxed at top + submission step.
- Deliberately deferred to run-time discovery: exact MCP tool schemas (introspect at 2.1), marketplace publish flow details, hackathon gas-credit mechanics (Discord question).
- Scope guard: no persistence, no multi-chain scan UI, no token-value oracle — risk score stays heuristic; YAGNI.
