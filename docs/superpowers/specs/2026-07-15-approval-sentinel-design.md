# ApprovalSentinel — an agent that finds and revokes dangerous token approvals via KeeperHub (Design)

Date: 2026-07-15
Competition: KeeperHub — Agents Onchain Hackathon (DoraHacks)
Build window: 2026-07-27 → 2026-08-13 (UTC+2); winners 08-20
Prize target: main pool $5,000 (1st $2,000 / 2nd $1,200 / 3rd $800) + $1,000
stackable "Best Onboarding UX Improvement" bounty

## Problem

Unlimited ERC-20 approvals are one of the largest sources of stolen funds:
users grant `approve(spender, MAX_UINT)` to dapps and forget them; a later
exploit of any approved contract drains the wallet. Existing revoke tools are
manual dashboards. Nobody watches your approvals continuously.

## Solution (one sentence)

A Claude agent that scans any wallet's ERC-20 approvals, explains the risk in
plain English, and — on the user's confirmation — executes `approve(spender, 0)`
revocations on Ethereum mainnet through KeeperHub, with continuous monitoring
via KeeperHub workflows.

## Why it fits the judging criteria

1. **Executes on-chain via KeeperHub** (heaviest weight): each revoke is a real
   mainnet transaction through `execute_contract_call`; revokes cost only gas
   (sponsored for the hackathon), so the demo produces many genuine txs safely.
2. **KeeperHub surface coverage** (all of them):
   - MCP server — the agent's execution path (`execute_contract_call`,
     `get_execution`, workflow CRUD tools).
   - Workflow builder — Schedule-trigger weekly rescan; Event-trigger alert on
     new `Approval` events → Telegram notification node.
   - CLI — CI health check (`kh doctor`, `kh run status`) and a batch-revoke
     script.
   - x402/MPP marketplace — the approval risk-scan published as a paid read
     workflow (~$0.01, USDC); our own agent consumes it through the agentic
     wallet: creator AND consumer in one project.
   - Audit trail — the agent renders Keeper Runs into a human-readable
     security report; "security actions must be auditable" is the narrative.
3. **Reliability/observability**: demo deliberately shows a retry, gas
   estimation multipliers, and per-node run logs.
4. **Useful**: judges can point it at their own wallet.

## Architecture

### 1. Scanner (TypeScript + viem, read-only, no keys)

- Input: wallet address, chain (Ethereum mainnet; Sepolia for dev).
- Pulls `Approval` event logs, dedupes to live allowances via
  `allowance(owner, spender)` multicall.
- Risk scoring: unlimited allowance, spender not in a known-protocol allowlist
  (bundled static list of top routers/protocol contracts), approval age, token
  value held. Output: JSON findings.

### 2. Agent layer (Claude + KeeperHub MCP)

- System prompt + thin TS harness (Claude Agent SDK).
- Presents findings conversationally; on explicit confirmation builds the
  `approve(spender, 0)` calldata and executes through KeeperHub MCP with the
  KeeperHub-managed (Turnkey) wallet; then polls run status and reports the
  Etherscan link.
- Safety: agent never holds keys; execution wallet is a dedicated demo wallet;
  revoke calldata is the only write it can construct.

### 3. KeeperHub workflows

- `sentinel-rescan`: Schedule trigger (weekly) → scan webhook → condition →
  Telegram summary.
- `sentinel-alert`: Event trigger on `Approval(owner=watched)` → notify with
  risk verdict.

### 4. Marketplace loop

- Publish `approval-risk-scan` as a paid marketplace workflow (webhook wraps
  the scanner service); price $0.01/run; agent pays via `@keeperhub/wallet`
  (x402 on Base / MPP on Tempo). Client safety hooks capped at $5 auto.

## Data flow

address → scanner → findings JSON → agent explains → user confirms → MCP
`execute_contract_call` (approve 0) → KeeperHub executes on mainnet (sponsored
gas, retries, nonce mgmt) → audit trail entry → agent reports tx link +
notification workflow fires.

## Error handling

- KeeperHub handles gas spikes/retries natively; agent surfaces run failures
  from `get_execution` rather than assuming success.
- Scanner rate-limits RPC calls; falls back to a second public RPC.
- MCP auth (401 → API key step-up) is documented as part of the bounty
  pain-point report.

## Testing

- Sepolia rehearsal: deploy `TestToken.sol` (plain ERC-20), create unlimited
  approvals to a dummy spender, run the full scan→confirm→revoke loop.
- Unit tests for the scanner's allowance dedupe and risk scoring.
- Mainnet demo run from the dedicated demo wallet (a few $1-gas revokes).

## Bounty sub-project ($1,000, stackable)

Produced from our own onboarding experience during integration:
1. English pain-point report ("zero to first transaction" teardown), anchored
   on the officially-acknowledged auth friction (KeeperHub issue #1700).
2. A `create-keeperhub-agent` starter template (MCP connection, wallet skill,
   hello-world Sepolia transfer workflow, CI running `kh doctor`).
3. Docs PR to KeeperHub/keeperhub: `.env.example`, self-hosting
   troubleshooting, CONTRIBUTING stub.

## Submission checklist (from hackathon rules)

GitHub repo link, demo video showing an on-chain execution through KeeperHub,
link to a transaction executed via KeeperHub. 18+, sanctions-restricted
regions ineligible (user confirms own eligibility at registration).

## Division of labor

Claude writes all code, docs, PR content, and the English demo script. User
handles: DoraHacks + KeeperHub account creation, API key creation (2FA),
wallet funding decisions, demo recording, and final submission clicks.
