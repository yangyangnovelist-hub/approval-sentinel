# ApprovalSentinel onboarding bounty — factual errata

> **Post-submission factual corrections, 2026-08-19.** This file does not add new bounty work or rewrite the July 16 onboarding capture. It records corrections learned from KeeperHub maintainer review so judges and future readers do not treat time-sensitive observations as current product behavior.

The original `REPORT.md` is a timestamped field report from a real onboarding run captured on **2026-07-16**. Several observations were accurate to that run but KeeperHub changed quickly during the hackathon; maintainer review of `KeeperHub/keeperhub#1856` also identified places where our explanation was too broad or technically wrong. The raw report remains preserved for auditability. Use the corrections below when evaluating current accuracy.

## Corrections

| Report item | Correction / current interpretation |
|---|---|
| **ONB-01 — macOS Gatekeeper** | The observed unsigned/quarantined cask failure was real in our run. The `xattr` workaround removes a macOS security control for that file and should only be used after confirming the binary came from KeeperHub's official tap. Signing/notarization is the durable fix. |
| **ONB-02 — MCP `Invalid JSON body`** | Our report incorrectly generalized the JSON-parse error to missing/unknown sessions. Current KeeperHub code distinguishes malformed JSON from session failures and returns structured session reasons. The four-step Streamable HTTP handshake remains useful, but the claimed error aliasing is not current behavior. |
| **ONB-05 — direct-execution transaction hash** | The statement that both `execute_transfer` and `execute_contract_call` omit the transaction hash is too broad. `execute_transfer` includes `transactionHash` / `transactionLink` when a transaction was broadcast; the polling concern applied to the contract-call path we exercised. ApprovalSentinel still polls and independently verifies state before claiming success. |
| **ONB-06 — idempotency after a failed workflow create** | A Pro-gated `402` can leave the reservation in `processing`; it is not permanently “burned.” The processing reservation expires after roughly 10 minutes. The 24-hour replay window applies to completed/finalized idempotency records, not this failure state. |
| **ONB-07 — marketplace price type** | Our description of a numeric `priceUsdcPerCall` as a direct validator rejection was not accurate for the reviewed route. Non-string input can be coerced/treated as undefined; the actionable UX issue is that the accepted listing price shape and unlist-before-price-change ordering should be explicit. |
| **ONB-09 — `kh doctor` warnings** | This was a time-sensitive July 16 observation. KeeperHub fixed the anonymous doctor probes in `kh` before the end of the hackathon; current versions attach authorization. Our original explanation that the probes required browser OAuth was incorrect. |
| **ONB-10 — `topLevelTo`** | `topLevelTo` is nested in the execution result when trace decoding is available; it is not a general top-level sender field. The useful product request remains: expose the effective KeeperHub wallet / sender unambiguously in execution evidence. |

## Items not withdrawn by maintainer review

The maintainer review did **not** invalidate the core ApprovalSentinel project or its onchain evidence. The agent's main safety path remains independent of this documentation bounty: explicit per-approval authorization, KeeperHub execution, terminal polling, and an independent onchain `allowance(owner, spender) == 0` re-read before success is reported.

The report's most durable onboarding observations are the broader product/DX patterns rather than frozen implementation claims: capability/plan discoverability before execution, an explicit raw-MCP quickstart, actionable feature-disabled errors, clear marketplace lifecycle ordering, and upfront explanation of security ceremonies.

## Why publish an errata instead of silently rewriting the report?

The bounty was based on a real timestamped onboarding session. Silently changing that record after the fact would make the evidence less useful. Preserving the original capture and publishing corrections makes both things inspectable: **what a new user actually experienced on July 16** and **what later code review proved about the underlying implementation**.

Reference review: `KeeperHub/keeperhub#1856`. The first review confirmed several technical observations and requested doc hygiene changes; a later, deeper review identified the corrections summarized above. The PR was ultimately closed without merge, so it should be treated as reviewed feedback—not as an accepted KeeperHub documentation contribution.
