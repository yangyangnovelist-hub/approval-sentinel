# Demo video script — ApprovalSentinel (3:00, no voiceover)

Format: silent screen recording with on-screen English captions (each ≤ 12 words). The right-hand column is the operator's step-by-step instructions in Chinese — follow it exactly while recording; the captions are added in editing (or typed live in a big-font terminal/text overlay).

Target length 2:45–3:00. Six shots. Record at 1080p or higher, terminal font ≥ 18pt, dark theme.

**录前准备（一次性）**

1. 终端进入仓库根目录：`cd ~/Desktop/hackathons/approval-sentinel`
2. 确认 `.env` 里有 `KH_API_KEY`（不要在镜头里打开 .env！）
3. 确认环境里 **没有** `ANTHROPIC_API_KEY`（scripted 模式是确定性的，录像不会翻车）：录像用的终端里先跑 `unset ANTHROPIC_API_KEY`
4. 浏览器开好 4 个标签页备用：
   - Etherscan LINK allowance 读取页（见镜头 4 说明）
   - KeeperHub 执行页 `https://app.keeperhub.com/executions/`（登录好）
   - `docs/workflows.md` 或 KeeperHub 工作流控制台
   - `bounty/REPORT.md`（GitHub 渲染页或本地预览）
5. 关掉所有通知弹窗（勿扰模式）

> 注意：镜头 3 会真的把 LINK 的无限授权撤销掉（这就是留着它的目的）。**只能成功录一次**。建议先用"排练模式"跑一遍镜头 2（只扫描，不确认），确认流程顺了再正式录镜头 3。如果撤销后还想重录，需要重新创建一笔脏授权（找 Claude 重新跑一遍 seed 脚本）。

---

## Shot 1 — The problem (0:00–0:20)

| # | English caption (on screen) | 中文操作指引 |
| --- | --- | --- |
| 1a | `You approved unlimited token spending. Then you forgot.` | 全屏展示一页简洁文字（可以是一个大字号的 markdown 预览或 Keynote 页）：标题 "Unlimited ERC-20 approvals"，下面三行小字：`approve(spender, MAX_UINT256)` / "one exploit later, the wallet drains" / "revoke tools are manual dashboards"。停留 8 秒。 |
| 1b | `Revoke dashboards are manual. Nobody watches your approvals continuously.` | 同一页或翻到第二页，停留 6 秒。 |
| 1c | `ApprovalSentinel: scan, explain, revoke — through KeeperHub.` | 切到项目 README 顶部（GitHub 或本地渲染），让项目名和一句话方案入镜，停留 6 秒。 |

## Shot 2 — Scanner finds the live exposure (0:20–0:50)

| # | English caption | 中文操作指引 |
| --- | --- | --- |
| 2a | `Scan any wallet. Read-only, no keys.` | 终端输入并回车：`npx tsx scanner/src/cli.ts scan 0xC7d92E2089BfD22539553FA8ea061cB094274dc5 --chain sepolia`（在 `scanner/` 目录下则用 `src/cli.ts`；在仓库根目录用完整路径）。等待输出。 |
| 2b | `Unlimited LINK approval to an unknown spender. High risk.` | 输出表格出现后，用鼠标选中/高亮 LINK 那一行（allowance = unlimited，spender = 0x…dEaD，分数最高）。停留 8 秒，让评委看清 SCORE / ALLOWANCE / REASONS 列。 |

## Shot 3 — Agent explains, you confirm, KeeperHub executes (0:50–1:45)

| # | English caption | 中文操作指引 |
| --- | --- | --- |
| 3a | `The agent presents each risk. Nothing executes without your explicit "yes".` | 终端输入并回车：`npx tsx agent/src/cli.ts scan-and-fix 0xC7d92E2089BfD22539553FA8ea061cB094274dc5 --chain sepolia`。会先打印 "ANTHROPIC_API_KEY not set — running scripted orchestration (no LLM)."（这行留在镜头里没问题，README 已说明）。 |
| 3b | `One confirmation = one revocation. Enforced in code, not in a prompt.` | 等它列出发现的授权并逐条询问。看到 **LINK → 0xdEaD** 那条的确认提问（token/spender/allowance 三行 + "Type yes to revoke"）时，先停 3 秒不要动，让评委读完。 |
| 3c | `Confirming the LINK revocation.` | 输入 `yes` 回车。如果它先问到其它授权（不该有，LINK 应是唯一剩下的），对非 LINK 的一律输入 `no`。 |
| 3d | `KeeperHub executes approve(spender, 0). Gas sponsored. Polling to final state.` | 等待执行输出：executionId、轮询、最终 txHash + run URL。全部打印完后停 5 秒。用鼠标高亮 txHash 那一行。 |

## Shot 4 — Onchain proof (1:45–2:15)

| # | English caption | 中文操作指引 |
| --- | --- | --- |
| 4a | `Allowance is now zero. Verified on-chain.` | 切到浏览器 Etherscan 标签页：打开 `https://sepolia.etherscan.io/address/0x779877A7B0D9E8603169DdbD7836e478b4624789#readContract`，展开 `allowance`，owner 填 `0xC7d92E2089BfD22539553FA8ea061cB094274dc5`，spender 填 `0x000000000000000000000000000000000000dEaD`，点 Query，结果显示 `0`。（建议录屏前先演练一遍这个查询。）也可以直接打开撤销 tx 的 Etherscan 页面展示 Approval 事件 value=0。 |
| 4b | `Full audit trail on the KeeperHub run page.` | 切到 KeeperHub 标签页，打开刚才终端里打印的 run URL（`https://app.keeperhub.com/executions/<executionId>`），停留 6 秒，滚动一屏展示状态/交易链接。 |

## Shot 5 — Continuous monitoring + paid marketplace scan (2:15–2:45)

| # | English caption | 中文操作指引 |
| --- | --- | --- |
| 5a | `A scheduled KeeperHub workflow re-reads the exposure weekly.` | 打开 KeeperHub 控制台的 workflows 页面，让 `sentinel-rescan` 和 `sentinel-alert` 两条同框；或展示 `docs/workflows.md` 里的 evidence 表格（含 executed ✅ 那行）。停留 6 秒。 |
| 5b | `The scan is a $0.01 marketplace workflow. Live x402 payment challenge.` | 终端输入并回车：`node workflows/scripts/kh-mcp.mjs call_workflow '{"slug":"approval-risk-rescan","inputs":{}}'`。输出 x402 challenge JSON 后，高亮 `"x402Version": 2`、`"amount": "10000"`、USDC/Base 字段。停留 8 秒。 |

## Shot 6 — Bounty report + roadmap (2:45–3:00)

| # | English caption | 中文操作指引 |
| --- | --- | --- |
| 6a | `We also filed 12 onboarding fixes and a starter template.` | 切到 `bounty/REPORT.md` 渲染页，缓慢滚动严重度表格一屏，停留 6 秒。 |
| 6b | `Next: mainnet, Pro notifications, x402 self-pay. Repo in the description.` | 切回 README 的 Roadmap 小节，停留到结束。最后一帧保持 README 顶部项目名。 |

---

## Appendix — 录屏建议

- **工具**：macOS 自带 QuickTime（文件 → 新建屏幕录制）或 Cmd+Shift+5 选区域录制即可；不需要麦克风（无口播）。想加字幕，用 iMovie / CapCut 把上面每条 caption 按时间点叠上去，白字黑底半透明条最稳。
- **终端**：录之前把终端窗口调到约 1280×720 居中，字号 18–20pt，清屏（`clear`）再开录。每条命令可以先粘贴好再按回车，避免打字出错。
- **节奏**：命令执行等待时不要乱动鼠标；输出出来后至少停 3 秒再切换。宁可素材长一点，剪辑时再压到 3 分钟。
- **分段录**：6 个镜头分开录 6 段，剪辑拼接，比一条过容错率高得多。镜头 3 是唯一不可重复的（真撤销），放在最后录，前面镜头都确认没问题了再录它。
- **敏感信息**：全程不要让 `.env`、API key、浏览器书签栏、邮箱标签页入镜。录之前浏览器开无痕窗口最省心。
- **校验**：剪完后自己静音看一遍，检查 (1) 每条 caption ≤ 12 个英文词 (2) tx hash 和 allowance=0 的画面清晰可读 (3) 总长 ≤ 3:00。
