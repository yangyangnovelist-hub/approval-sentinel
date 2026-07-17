# create-keeperhub-agent — starter template

Zero to your first KeeperHub-executed Sepolia transaction in ~5 minutes, with the three traps that stop new users pre-defused. Dependency-free: one Node 20+ script, no SDK, no build step.

This directory is self-contained — copy it anywhere and it still works.

## 0. Prerequisites (2 min)

- Node 20+ (`node --version`)
- A KeeperHub account + org at [app.keeperhub.com](https://app.keeperhub.com) (the wizard auto-provisions a Turnkey wallet; testnet runs are gas-sponsored)
- An API key: avatar → **API Keys** → Create. **Heads-up:** the create dialog will ask for an email code *and* a TOTP code — have your authenticator ready.

```bash
cp .env.example .env    # then paste your kh_... key into .env
```

## 1. Optional but recommended: the `kh` CLI health check (1 min)

```bash
brew install keeperhub/tap/kh

# macOS ONLY — without this, `kh` is silently SIGKILLed by Gatekeeper
# (exit 137, zero output) because the brew binary ships quarantined:
xattr -d com.apple.quarantine "$(realpath "$(which kh)")"

export KH_API_KEY=kh_...   # or source it from .env
kh doctor
```

What `kh doctor` output means:

- `API: reachable` + `Auth: authenticated` → you're good; continue.
- `[warn] Wallet: requires authentication` / `[warn] Spend Cap: requires authentication` → **expected with an API key.** These two checks want a browser OAuth session (`kh auth login`), not your org key. They do not block MCP execution — ignore them for this quickstart.
- `kh` prints nothing and dies → you skipped the `xattr` line above.

## 2. First onchain execution (1 min)

```bash
node first-execution.mjs
```

Expected output:

```
executionId: <id> | submitted, polling for the tx hash...
status: completed
tx: 0x...
link: https://sepolia.etherscan.io/tx/0x...
```

That's a real Sepolia transaction, signed by your org's KeeperHub-managed wallet, gas sponsored. It calls `approve(0xdEaD, 0)` on Sepolia WETH — i.e. it sets an allowance to zero, which is harmless no matter what state your wallet is in, and safe to re-run.

## 3. What the script quietly gets right (read this before writing your own)

The ~50-line [`first-execution.mjs`](first-execution.mjs) encodes four rules that are easy to miss and expensive to debug:

1. **Streamable-HTTP handshake.** POST `initialize` → read the **`Mcp-Session-Id` response header** → POST `notifications/initialized` → send that header on every later request. Skip any step and the server answers `{"error":"Invalid JSON body"}` — the same message as an actual JSON typo.
2. **`function_args` (and `abi`) are JSON strings**, not arrays/objects: `'["0x...dEaD","0"]'`.
3. **The execute response has no tx hash** — even when it returns `status: "completed"` synchronously. Always poll `get_direct_execution_status` (not `get_execution`, which is for workflow runs) to a terminal state before reporting success.
4. **Idempotency keys make retries safe:** same key + same args within 24h replays the original execution instead of paying for a second one; same key + different args → 409, so rotate the key when you change the payload.

## 4. Where to go next

- `tools/list` via the same session shows all 31 MCP tools (execution, workflows, marketplace).
- Swap the `contract_address` / `function_name` / `function_args` in the script for your own contract call — verified contracts need no `abi`.
- A fuller reusable client (any tool, one command) lives in the parent project: `workflows/scripts/kh-mcp.mjs`.

Part of the [ApprovalSentinel](../../README.md) onboarding-bounty package; the full friction report behind this template is [`../REPORT.md`](../REPORT.md).
