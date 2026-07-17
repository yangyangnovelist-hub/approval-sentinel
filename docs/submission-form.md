# DoraHacks BUIDL submission — pre-filled form

Hackathon: **KeeperHub Agents Onchain** (DoraHacks). Build window 2026-07-27 → 2026-08-13 (UTC+2). Submission needs: GitHub repo + demo video + a link to one transaction executed through KeeperHub.

Copy-paste each field below into the DoraHacks BUIDL form. Fields marked `TODO` need the final URL before submitting. Exact field names on DoraHacks may differ slightly (they occasionally rename labels) — match by meaning.

---

## Field-by-field

**BUIDL name**

```
ApprovalSentinel
```

**Tagline / one-liner** (if the form has a short-description field)

```
An agent that finds dangerous ERC-20 approvals and revokes them onchain through KeeperHub — behind a code-enforced, one-yes-per-revoke confirmation gate.
```

**Description / About** (main text box; markdown usually supported)

```
Unlimited ERC-20 approvals are one of the largest sources of stolen funds onchain: users sign approve(spender, MAX_UINT256), forget it, and a later exploit of any approved contract drains the wallet. Existing revoke tools are manual dashboards; nobody watches approvals continuously.

ApprovalSentinel scans any wallet's live ERC-20 approvals (read-only, no keys), risk-scores and explains them, and — only after an explicit per-approval "yes" — executes approve(spender, 0) through KeeperHub's MCP server with the org's Turnkey wallet and sponsored gas. The confirmation gate lives in code, not in a prompt: one confirmation authorizes exactly one revocation, in both LLM mode (Claude Agent SDK) and the deterministic scripted mode.

KeeperHub surfaces used:
- MCP server: execute_contract_call for revocations, polled to a terminal state via get_direct_execution_status; 17 of the 31 MCP tools exercised in total.
- Workflow builder: two workflows authored entirely via MCP — sentinel-rescan (Schedule trigger, weekly allowance() re-read, executed for real) and sentinel-alert (Approval-event trigger).
- Marketplace: the rescan is listed as "approval-risk-rescan" at $0.01 USDC/call and returns a live x402 v2 payment challenge.
- CLI: kh doctor drives the onboarding checks in our starter template.

Verified onchain (Sepolia, all through KeeperHub, sponsored gas):
- Revocation tx: https://sepolia.etherscan.io/tx/0x1e4c1b81592ffbe70ba9be8c0d427e4f6ab3b511b03e2a6dad4381dd5698912f (allowance asserted 0 onchain afterwards)
- End-to-end agent run (scan → confirm → revoke → verify): https://sepolia.etherscan.io/tx/0x42ba20119f8a039691cfe2a3f0e56f31a119e3c97faefa788c8be1632bdf9a4c — KeeperHub run https://app.keeperhub.com/executions/i8q7efwybk9natj0eed8b
- Workflow execution: qs6to8r9ul1w9h1p52swb (sentinel-rescan, real onchain read)

Reliability: idempotency keys on every write, poll-to-terminal before trusting any receipt, failures always surface the KeeperHub run link, 51 automated tests (29 scanner + 22 agent incl. a live Sepolia integration test).

Bounty (Best Onboarding UX Improvement): bounty/REPORT.md documents 12 reproducible zero-to-first-transaction friction points with severity, reproduction, and suggested fixes; bounty/starter-template/ is a 5-minute create-keeperhub-agent quickstart; bounty/docs-pr/ is a prepared upstream docs PR referencing KeeperHub issue #1700.

Honest limitations: LLM mode needs an ANTHROPIC_API_KEY (scripted fallback has the same gate); workflow notify actions are Pro-gated so the free-plan workflows wire triggers to live allowance() reads, with the full notify definitions preserved in workflows/definitions/*-with-notify.json; the x402 self-pay hop needs real USDC on Base (creator side is complete and live).
```

**GitHub repository**

```
TODO — https://github.com/yangyangnovelist-hub/approval-sentinel  (公开后填，见下方清单第 1 步)
```

**Demo video URL**

```
TODO — YouTube/Loom 链接（录完上传后填）
```

**Transaction executed via KeeperHub** (the required tx-link field)

```
https://sepolia.etherscan.io/tx/0x1e4c1b81592ffbe70ba9be8c0d427e4f6ab3b511b03e2a6dad4381dd5698912f
```

Backup, if the form allows more than one link:

```
https://sepolia.etherscan.io/tx/0x42ba20119f8a039691cfe2a3f0e56f31a119e3c97faefa788c8be1632bdf9a4c
https://app.keeperhub.com/executions/i8q7efwybk9natj0eed8b
```

**Website** (optional field — leave blank or reuse the repo URL)

```
(leave blank)
```

**Tech stack / tags** (pick the closest available)

```
TypeScript, viem, MCP, Claude Agent SDK, KeeperHub, Ethereum, Sepolia, x402
```

**Track / prize selection**

```
Main track: KeeperHub Agents Onchain
Also apply for: Best Onboarding UX Improvement bounty ($1,000)
```

**Bounty submission note** (if the bounty asks for a separate link/text)

```
Onboarding report: https://github.com/yangyangnovelist-hub/approval-sentinel/blob/main/bounty/REPORT.md — 12 reproducible friction points (severity-ranked, each with reproduction + suggested fix), a 5-minute starter template (bounty/starter-template/), and a prepared docs PR (bounty/docs-pr/) referencing KeeperHub issue #1700.
```

**Team**

```
Solo builder. AI-assisted: all code and docs written with Claude; human owner ran accounts, keys, funding decisions, recording, and submission.
```

---

## 提交清单（中文，按顺序做）

**第 0 步 — 提交前自检（1 分钟）**

```bash
cd ~/Desktop/hackathons/approval-sentinel
git status                 # 应显示 nothing to commit, working tree clean
git ls-files | grep -i env # 应该什么都不输出（.env 没被跟踪才安全）
```

如果第二条命令有任何输出，停下来找 Claude 处理，不要推送。

**第 1 步 — 把仓库推上公开 GitHub**

需要先装好 GitHub CLI 并登录过（`gh auth status` 能看到绿色勾）。然后在仓库根目录跑这一条：

```bash
cd ~/Desktop/hackathons/approval-sentinel
gh repo create approval-sentinel --public --source=. --remote=origin --push
```

成功后它会打印仓库地址（形如 `https://github.com/<你的用户名>/approval-sentinel`）。把这个地址填进上面的 **GitHub repository** 字段，并替换本文件和 bounty 材料里所有 `<repo-url>` / `<your-username>` 占位。

如果提示 origin 已存在（之前建过），改用：`git push origin main`。

**第 2 步 — 录 demo 视频**

按 `docs/demo-video-script.md` 的分镜录制（注意：镜头 3 的 LINK 撤销只能成功录一次，先排练）。剪好后上传 YouTube（设为 Unlisted 即可）或 Loom，把链接填进 **Demo video URL**。

**第 3 步 — 在 DoraHacks 提交 BUIDL**

1. 登录 DoraHacks，进入 KeeperHub Agents Onchain 活动页，点 Submit BUIDL / 提交 BUIDL。
2. 逐字段粘贴上面的内容（此时所有 TODO 都应已替换成真实链接）。
3. tx 链接字段填上面给的撤销交易链接。
4. 勾选主赛道 + Onboarding UX 赏金（如果是分开报名，两边都报）。
5. 提交前通读预览一遍：确认没有残留 `TODO`、`<repo-url>`、`<your-username>`。
6. 截止时间是 **2026-08-13 12:00 (UTC+2)**，不要卡点，提前至少一天提交。

**第 4 步 — 提交后**

- 在 DoraHacks 上确认 BUIDL 状态为已提交/可见。
- 7/27 之后再处理 `bounty/docs-pr/`（给 KeeperHub 官方仓库发 PR，材料已备好，到时找 Claude 执行 fork + push）。
