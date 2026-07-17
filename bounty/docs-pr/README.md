# Prepared upstream docs PR (do NOT send before 2026-07-27)

Ready-to-open PR material for the official `KeeperHub/keeperhub` repository, part of the Best Onboarding UX Improvement bounty package. Nothing here has been forked or pushed yet — the hackathon build window opens 2026-07-27; open the PR after that date so the contribution lands inside the window.

## Contents

| File | Becomes (in the upstream repo) |
| --- | --- |
| [`PR-BODY.md`](PR-BODY.md) | The pull-request description (copy-paste into GitHub) |
| [`files/env.example`](files/env.example) | `.env.example` at the repo root |
| [`files/docs/self-hosting-troubleshooting.md`](files/docs/self-hosting-troubleshooting.md) | `docs/self-hosting-troubleshooting.md` |
| [`files/CONTRIBUTING.md`](files/CONTRIBUTING.md) | `CONTRIBUTING.md` at the repo root |
| [`install-docs-quarantine-note.md`](install-docs-quarantine-note.md) | A short section to splice into the existing CLI install docs (exact target file TBD when forking) |

## How to open the PR (after 07-27) — 中文操作步骤

这些都可以让 Claude 代跑，用户只需要确认：

1. `gh repo fork KeeperHub/keeperhub --clone` （fork 并克隆官方仓库）
2. 新建分支 `docs/onboarding-troubleshooting`
3. **先核对再落盘**：对照上游仓库实际的配置加载代码，核对 `files/env.example` 里的变量名（里面标了 TODO 的行必须核实或删除）；对照现有 docs 目录结构决定 troubleshooting 文档放哪、install 文档往哪个文件加 quarantine 说明。
4. 把三个文件拷入对应位置，提交，push 到 fork。
5. `gh pr create` — 标题用 `docs: onboarding troubleshooting guide, .env.example, CONTRIBUTING stub`，正文粘贴 `PR-BODY.md`（把里面的 `<repo-url>` 占位替换成我们已公开的 approval-sentinel 仓库地址）。

## Why this shape

- Everything in the troubleshooting guide is a first-hand, reproduced issue from our onboarding run (full report: [`../REPORT.md`](../REPORT.md)); nothing is speculative.
- The PR deliberately touches **docs only** — zero code, zero behavior change — so it is cheap for maintainers to review and safe to merge.
- KeeperHub has already acknowledged onboarding/auth friction in issue #1700; this PR is positioned as the documentation half of that fix.
