# First KeeperHub executions (Sepolia)

All executions run through the KeeperHub MCP `execute_contract_call` tool
(`https://app.keeperhub.com/mcp`, Bearer `KH_API_KEY`, server `keeperhub v1.2.0`),
signed by the org's Turnkey-managed wallet with **sponsored gas** (testnet free tier).
Captured 2026-07-16.

## Executor wallet

- Integration id: `hbbr74nwf7gmjbb8j861m` (type `web3`, from `get_wallet_integration`)
- **Allowance-owner address: `0xC7d92E2089BfD22539553FA8ea061cB094274dc5`**
  — this is the `owner` in every `approve()` below and the address the revoke executor
  must target. (The status payload's `topLevelTo` `0x5af5…f07d` is the relayer/entrypoint
  hop, not the token-allowance owner; verified on-chain via `allowance(owner, spender)`.)

## Flow proven

`execute_contract_call` → returns `{executionId, status}` →
`get_direct_execution_status {execution_id}` → terminal `status: "completed"` with
`transactionHash` + `transactionLink` + `result.success: true` + `result.sponsored: true`.

## Execution 1 — first KeeperHub tx (WETH approve)

Doubles as dirty-wallet approval #1. `approve(0xdEaD, MaxUint256)` on Sepolia WETH.

- Contract: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` (WETH, verified — ABI auto-fetched)
- Spender: `0x000000000000000000000000000000000000dEaD`
- Amount: `MaxUint256`
- chain_id: `11155111`
- idempotency_key: `as-first-weth-approve-dead-01`
- **executionId: `ib4rj0wp2g2asgz00nivd`**
- gasUsed: `108039`, sponsored: `true`
- **tx: https://sepolia.etherscan.io/tx/0x10334ebfdef7b3f11e6c9787fb2ed7a4834345340e9586f28c51f6b2048d93d4**

## Execution 2 — dirty-wallet approval #2 (LINK approve)

`approve(0xdEaD, MaxUint256)` on Sepolia LINK.

- Contract: `0x779877A7B0D9E8603169DdbD7836e478b4624789` (LINK, verified)
- Spender: `0x000000000000000000000000000000000000dEaD`
- Amount: `MaxUint256`
- chain_id: `11155111`
- idempotency_key: `as-first-link-approve-dead-01`
- **executionId: `5zf57qaev0ifemqwhxrak`**
- sponsored: `true`
- **tx: https://sepolia.etherscan.io/tx/0x41d514652c69edfa03dd0dbbab4b9194558d18d15742274af9caa312bfcf94b8**

## Execution 3 — revocation (Task 2.2, via `agent/src/revoke.ts`)

The revoke executor cleared the WETH approval back to zero — driven by the integration
test (`agent/test/revoke.integration.test.ts`), which then asserted the on-chain allowance
is 0 with a direct viem read.

- `approve(0xdEaD, 0)` on WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- calldata: `0x095ea7b3…` (approve selector), amount `0`
- idempotency_key: `as-revoke-weth-dead-integration-01`
- **executionId: `oex9nydnt9p32m55wh5wv`**
- **tx: https://sepolia.etherscan.io/tx/0x1e4c1b81592ffbe70ba9be8c0d427e4f6ab3b511b03e2a6dad4381dd5698912f**
- Post-revoke `allowance(owner, dEaD)` on WETH = `0x0` ✓

LINK's approval is intentionally left dirty (MaxUint256) so the agent-harness demo
(Task 2.3) still has a live approval to revoke.

## Execution 4 — harness smoke seed (Task 2.3)

Fresh throwaway approval so the harness smoke test never touches the LINK demo
approval: `approve(0x…beef, MaxUint256)` on Sepolia WETH.

- Spender: `0x000000000000000000000000000000000000beef`
- idempotency_key: `as-harness-smoke-weth-beef-01`
- **executionId: `yy770wsaw9b3y9tfsdrlu`**, sponsored: `true`
- **tx: https://sepolia.etherscan.io/tx/0x6cf33f5037abc4d06d1ae5bd24cba7b7d074e260bdecd0c0e85ccd6abb403991**

## Execution 5 — agent-harness end-to-end revoke (Task 2.3 smoke test)

`npx tsx agent/src/cli.ts scan-and-fix 0xC7d9…4dc5 --chain sepolia` in scripted
orchestration mode (no ANTHROPIC_API_KEY in the environment, so no LLM was
involved — the same gated tools, deterministic driver). The scan found both
live approvals (LINK→dEaD, WETH→beef); the confirmation gate was answered
"no" for LINK (kept as demo material) and "yes" for WETH→beef.

- Revoked: WETH `approve(0x…beef, 0)`
- **executionId: `i8q7efwybk9natj0eed8b`**, run: https://app.keeperhub.com/executions/i8q7efwybk9natj0eed8b
- **tx: https://sepolia.etherscan.io/tx/0x42ba20119f8a039691cfe2a3f0e56f31a119e3c97faefa788c8be1632bdf9a4c**
- Post-run on-chain check: `allowance(owner, 0x…beef)` on WETH = `0` ✓ and
  `allowance(owner, 0xdEaD)` on LINK still MaxUint256 ✓ (demo approval intact).

## On-chain verification (post-approval)

`allowance(0xC7d92E2089BfD22539553FA8ea061cB094274dc5, 0xdEaD)` read via public Sepolia RPC:

- WETH → `0xff… ffff` (MaxUint256) ✓
- LINK → `0xff… ffff` (MaxUint256) ✓

This is the deterministic "dirty wallet" the revoke executor (Task 2.2) drives back to
zero, asserted allowance == 0 in the integration test.

## Notes for the agent layer

- `function_args` and `abi` are JSON **strings** nested inside the tool `arguments` object,
  not arrays/objects. e.g. `function_args: "[\"0x…dEaD\",\"1157…935\"]"`.
- Verified contracts need no `abi` — KeeperHub auto-fetches it.
- Poll `get_direct_execution_status` (NOT `get_execution`, which is for workflow runs).
  In practice the execute call already returned `completed` synchronously here, but the
  executor still polls to a terminal state before trusting the receipt.
- Streamable-HTTP MCP requires the `Mcp-Session-Id` header from `initialize` on every
  subsequent request, and a `notifications/initialized` before the first `tools/call`.
