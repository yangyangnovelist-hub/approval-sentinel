# ApprovalSentinel KeeperHub workflows (Task 2.4)

Two workflows plus the marketplace paid-scan loop, authored entirely through the
KeeperHub MCP server (`https://app.keeperhub.com/mcp`, Bearer `KH_API_KEY`).
Reproduce with the dependency-free scripts in `workflows/scripts/` (they run on
plain `node`, no build step):

```bash
node workflows/scripts/create-workflows.mjs         # create + validate both workflows
node workflows/scripts/kh-mcp.mjs <tool> '<json>'   # call any MCP tool ad-hoc
```

All captured on 2026-07-16, server `keeperhub v1.2.0`, org wallet
`0xC7d92E2089BfD22539553FA8ea061cB094274dc5` (the demo owner that still holds an
unlimited LINK→`0xdEaD` approval on Sepolia).

---

## What was created (evidence)

| Workflow | ID | Trigger → Action | Status |
| --- | --- | --- | --- |
| `sentinel-rescan` | `hj4oygp1tpk4567tkv3yy` | Schedule (weekly) → `web3/read-contract` `allowance()` | Created ✅ · validated ✅ · **executed ✅** |
| `sentinel-alert` | `21tr6ym2rg3kj16lbsguh` | Blockchain Event (LINK `Approval`) → `web3/read-contract` `allowance()` | Created ✅ · validated ✅ |

Persisted definitions + `create_workflow` responses: `workflows/definitions/sentinel-rescan.json`,
`workflows/definitions/sentinel-alert.json`.

### sentinel-rescan — real execution

`execute_workflow` → `get_execution` produced a genuine on-chain read:

- executionId: **`qs6to8r9ul1w9h1p52swb`**
- runId: **`wrun_01KXNFK1X9G51JJY0VY9SJRQ3Q`**
- status: `success` (both nodes `success`), duration 431 ms
- output.result: `115792089237316195423570985008687907853269984665640564039457584007913129639935`
  — i.e. `2^256-1`, the **unlimited** LINK allowance to `0xdEaD` that the demo
  wallet deliberately keeps. The scheduled workflow re-reads that live exposure.
- contract link: `https://sepolia.etherscan.io/address/0x779877A7B0D9E8603169DdbD7836e478b4624789`

Run page (KeeperHub console): `https://app.keeperhub.com/executions/qs6to8r9ul1w9h1p52swb`

`validate_workflow` returns `valid: true` for both (one `low-confidence-abi-match`
warning — expected, the token is a proxy / the minimal `allowance` ABI is narrower
than the resolved one; warning only).

---

## Design vs. what the free plan allows

The design's canonical shape is **trigger → (scan) → notify** (`sentinel-rescan`:
Schedule → scan service → Telegram/Discord summary; `sentinel-alert`: Approval
event → notify). On the current **free** KeeperHub plan every notification /
compute action is gated:

```
402 upgrade_required
  action.http-request  (HTTP Request)      requiredPlan: pro
  action.webhook       (webhook/send-webhook) requiredPlan: pro
  action.code          (code/run-code)      requiredPlan: pro
```

`web3/read-contract` (and web3 writes) are **not** gated, so the created
workflows wire the real Schedule and Event triggers to a live on-chain
`allowance()` read of the demo approval. This keeps them genuinely creatable,
validatable, and — for the scheduled one — executable, while faithfully
demonstrating the two trigger types.

The **full pro design** (Schedule → HTTP scan call → webhook notify; Approval
event → webhook notify, with owner-filtering via a Condition node) is preserved
verbatim in:

- `workflows/definitions/sentinel-rescan-with-notify.json`
- `workflows/definitions/sentinel-alert-with-notify.json`

**Owner user action to finish the notify leg:** upgrade the KeeperHub org to
Pro, then create the `-with-notify` variants (swap the webhook URL for a real
Discord/Telegram/webhook endpoint). No code change needed — the MCP
`create_workflow` call is identical.

---

## Marketplace paid-scan loop

### Creator side — DONE via MCP

`sentinel-rescan` is published to the KeeperHub marketplace and priced at
**$0.01 USDC per call**:

- slug: **`approval-risk-rescan`**
- `list_workflow` → listed (required `inputSchema: {"type":"object"}` +
  `outputMapping`)
- `update_workflow_listing` → `priceUsdcPerCall: "0.01"` (string, not number)
- `get_workflow_listing` confirms: `{ priceUsdcPerCall: "0.01", category: "security", chain: "11155111", workflowType: "read" }`

Public listing endpoint: `https://app.keeperhub.com/api/mcp/workflows/approval-risk-rescan/call`

> Price changes require **unlist → set price → re-list** (a change while listed
> returns `409 PRICE_CHANGE_WHILE_LISTED`). The MCP call must also be enabled
> (`update_workflow enabled:true`) or the consumer path 503s
> ("owner has disabled this workflow").

### Consumer / self-pay side — wired, needs funds (x402/MPP)

`call_workflow` against the listed slug returns a correct **x402 v2 payment
challenge** — the paid loop is fully live, it just isn't auto-paid by the MCP tool:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": ".../workflows/approval-risk-rescan/call", "description": "Pay to run workflow: sentinel-rescan" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",                                   // Base
    "asset":   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",     // USDC
    "amount":  "10000",                                          // 0.01 USDC (6 decimals)
    "payTo":   "0xc7d92e2089bfd22539553fa8ea061cb094274dc5",
    "maxTimeoutSeconds": 300
  }],
  "extensions": { "bazaar": { "discoverable": true, "category": "security" } }
}
```

The `call_workflow` MCP tool **does not auto-pay**. Closing the self-pay loop
needs, per KeeperHub's own hint, one of:

- `@keeperhub/wallet` — `paymentSigner.fetch(url, { method: 'POST', body, paymentHint: 'x402' })`
- the `agentcash` MCP — `fetch` against the same endpoint
- the Marketplace UI — run the listing interactively

**Feasibility conclusion:** ⚠️ **Needs UI / funds — left to the user.** Executing
the paid call requires **real USDC (0.01) on Base** plus a wallet signer
(`@keeperhub/wallet` or agentcash). Payment chains are Base/Tempo only — the
KeeperHub-managed Turnkey wallet used for Sepolia execution is not a funded Base
payer here. No testnet/sponsored path exists for the x402 charge, so this final
hop is not automatable in this environment. The creator side (list + price +
discoverable x402 challenge) is complete and verifiable now; the consumer hop is
a funding + wallet-config step for the owner.

> Note: `search_workflows` for `approval` / `category: security` returned 0
> results at capture time (own-org listings appear excluded from search, or
> indexing lag). The x402 challenge above is the authoritative proof that the
> listing is live and discoverable in the bazaar.

---

## MCP tools exercised

`tools_documentation`, `list_action_schemas`, `list_integrations`,
`search_templates`, `get_template`, `create_workflow`, `validate_workflow`,
`execute_workflow`, `get_execution`, `update_workflow`, `list_workflow`,
`unlist_workflow`, `update_workflow_listing`, `get_workflow_listing`,
`call_workflow`, `search_workflows`, `ai_generate_workflow` (disabled — see
`bounty/onboarding-notes.md` #8).
