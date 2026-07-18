/**
 * ApprovalSentinel agent harness (Task 2.3).
 *
 * Two tools — scan (read-only) and revoke (state-changing) — behind ONE
 * code-enforced safety gate:
 *
 *   - every revocation must list token + spender (+ allowance) and receive an
 *     explicit "yes" from the user before anything is submitted;
 *   - one confirmation authorizes exactly one revocation — never batched.
 *
 * The gate lives in `createGatedRevoke`, not in a prompt: whichever brain
 * drives the tools (Claude via the Agent SDK, or the scripted orchestrator
 * used when no ANTHROPIC_API_KEY is available), it is mechanically impossible
 * to revoke without a fresh per-approval confirmation.
 */

import type { Address } from 'viem';
import type { Finding } from '../../scanner/src/riskScore.js';
import { RevokeError, type RevokeResult } from './revoke.js';

export type ChainName = 'mainnet' | 'sepolia';

export interface HarnessIO {
  write(line: string): void;
  /** Prompt the user and resolve with their raw answer. */
  ask(question: string): Promise<string>;
}

export type ScanTool = (address: Address, chain: ChainName, fromBlock?: bigint) => Promise<Finding[]>;
export type RevokeTool = (req: { token: Address; spender: Address; chainId: string }) => Promise<RevokeResult>;

export type GateOutcome =
  | { status: 'revoked'; result: RevokeResult }
  | { status: 'failed'; error: string; runUrl?: string }
  | { status: 'declined' }
  | { status: 'quit' };

/** Only an explicit, unambiguous yes opens the gate. "ok", "sure", "yes please" do not. */
export function isExplicitYes(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'yes' || a === 'y';
}

export function isQuit(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'quit' || a === 'q' || a === 'exit';
}

function describeAllowance(finding: Finding): string {
  return finding.unlimited ? 'UNLIMITED' : finding.allowance;
}

/**
 * Wraps the raw revoke tool in the confirmation gate. Returns a function that
 * (1) prints token + spender + allowance, (2) asks for explicit yes,
 * (3) executes exactly one revocation on yes, and reports the outcome.
 *
 * Only the revoke call itself is caught (reported as `failed` with the
 * KeeperHub run link when available); an IO/confirmation error propagates and
 * aborts the whole run — it must never be misreported as a failed revocation.
 */
export function createGatedRevoke(
  revoke: RevokeTool,
  chainId: string,
  io: HarnessIO,
): (finding: Finding) => Promise<GateOutcome> {
  return async (finding: Finding): Promise<GateOutcome> => {
    io.write('');
    io.write(`About to revoke ONE approval:`);
    io.write(`  token:     ${finding.symbol} (${finding.token})`);
    io.write(`  spender:   ${finding.spenderLabel ? `${finding.spenderLabel} ` : ''}${finding.spender}`);
    io.write(`  allowance: ${describeAllowance(finding)}`);
    const answer = await io.ask(
      `Revoke this ${finding.symbol} approval for spender ${finding.spender}? Type "yes" to revoke, "no" to skip, "quit" to stop: `,
    );
    if (isQuit(answer)) return { status: 'quit' };
    if (!isExplicitYes(answer)) {
      io.write('Skipped (no explicit "yes").');
      return { status: 'declined' };
    }
    try {
      const result = await revoke({ token: finding.token, spender: finding.spender, chainId });
      return { status: 'revoked', result };
    } catch (error) {
      const runUrl = error instanceof RevokeError ? error.runUrl : undefined;
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', error: message, ...(runUrl ? { runUrl } : {}) };
    }
  };
}

export interface ScanAndFixSummary {
  findings: Finding[];
  revoked: Array<{ finding: Finding; result: RevokeResult }>;
  skipped: Finding[];
  failed: Array<{ finding: Finding; error: string; runUrl?: string }>;
  quit: boolean;
}

export interface ScanAndFixOptions {
  address: Address;
  chain: ChainName;
  fromBlock?: bigint;
}

const CHAIN_IDS: Record<ChainName, string> = { mainnet: '1', sepolia: '11155111' };

function presentFindings(findings: Finding[], io: HarnessIO): void {
  io.write(`Found ${findings.length} live approval(s), highest risk first:`);
  findings.forEach((f, i) => {
    io.write('');
    io.write(`${i + 1}. [score ${f.score}] ${f.symbol} → ${f.spenderLabel ?? f.spender}`);
    io.write(`   token ${f.token}`);
    io.write(`   spender ${f.spender}`);
    io.write(`   allowance ${describeAllowance(f)}, ${f.ageDays} day(s) old`);
    for (const reason of f.reasons) io.write(`   - ${reason}`);
  });
}

/**
 * Scripted orchestration: scan → present findings → per-finding confirmation
 * gate → revoke on explicit yes. Used directly when no LLM is available, and
 * unit-tested with mocked tools to pin the gate semantics.
 */
export async function runScanAndFix(
  opts: ScanAndFixOptions,
  deps: { scan: ScanTool; revoke: RevokeTool; io: HarnessIO },
): Promise<ScanAndFixSummary> {
  const { io } = deps;
  const chainId = CHAIN_IDS[opts.chain];
  io.write(`Scanning ${opts.address} on ${opts.chain} for live ERC-20 approvals…`);
  const findings = await deps.scan(opts.address, opts.chain, opts.fromBlock);

  const summary: ScanAndFixSummary = { findings, revoked: [], skipped: [], failed: [], quit: false };
  if (findings.length === 0) {
    io.write('Clean: no live approvals found. Nothing to revoke.');
    return summary;
  }

  presentFindings(findings, io);
  const gatedRevoke = createGatedRevoke(deps.revoke, chainId, io);

  for (const finding of findings) {
    if (summary.quit) break;
    const outcome = await gatedRevoke(finding);
    if (outcome.status === 'quit') {
      summary.quit = true;
      io.write('Stopping at your request. Remaining approvals were NOT touched.');
    } else if (outcome.status === 'declined') {
      summary.skipped.push(finding);
    } else if (outcome.status === 'failed') {
      io.write(`FAILED to revoke ${finding.symbol} → ${finding.spender}: ${outcome.error}`);
      if (outcome.runUrl) io.write(`  audit trail: ${outcome.runUrl}`);
      summary.failed.push({
        finding,
        error: outcome.error,
        ...(outcome.runUrl ? { runUrl: outcome.runUrl } : {}),
      });
    } else {
      summary.revoked.push({ finding, result: outcome.result });
      io.write(`Revoked ${finding.symbol} approval for ${finding.spender}.`);
      io.write(`  tx:        ${outcome.result.transactionLink ?? outcome.result.txHash}`);
      io.write(`  audit run: ${outcome.result.runUrl}`);
      if (outcome.result.verifiedAllowance !== undefined) {
        io.write(`  verified:  on-chain allowance = ${outcome.result.verifiedAllowance}`);
      }
    }
  }

  io.write('');
  io.write(
    `Done. Revoked ${summary.revoked.length}, skipped ${summary.skipped.length}, failed ${summary.failed.length}` +
      (summary.quit ? ' (stopped early at user request)' : '') +
      '.',
  );
  return summary;
}

export type RevokeByAddressOutcome = GateOutcome | { status: 'rejected'; error: string };

export interface SessionTools {
  scan: ScanTool;
  /** Revoke by (token, spender) — only pairs surfaced by the LAST scan are eligible. */
  revokeByAddress(token: string, spender: string): Promise<RevokeByAddressOutcome>;
}

/**
 * Tool pair for the LLM-driven mode. Two extra safety properties on top of the
 * confirmation gate:
 *   - revoke is only possible for (token, spender) pairs present in the most
 *     recent scan result — the model cannot invent targets;
 *   - the terminal confirmation gate still runs for every revocation.
 */
export function createSessionTools(deps: {
  scan: ScanTool;
  revoke: RevokeTool;
  chain: ChainName;
  io: HarnessIO;
}): SessionTools {
  let lastFindings: Finding[] = [];
  const gate = createGatedRevoke(deps.revoke, CHAIN_IDS[deps.chain], deps.io);

  return {
    scan: async (address, chain, fromBlock) => {
      lastFindings = await deps.scan(address, chain, fromBlock);
      return lastFindings;
    },
    revokeByAddress: async (token, spender) => {
      const finding = lastFindings.find(
        (f) =>
          f.token.toLowerCase() === token.toLowerCase() &&
          f.spender.toLowerCase() === spender.toLowerCase(),
      );
      if (!finding) {
        return {
          status: 'rejected',
          error: `No approval for token ${token} / spender ${spender} in the last scan — run scan_approvals first and use an exact (token, spender) pair from its output.`,
        };
      }
      return gate(finding);
    },
  };
}

/** System prompt for the LLM-driven mode (Claude Agent SDK). */
export const SECURITY_ANALYST_SYSTEM_PROMPT = `You are ApprovalSentinel, a careful on-chain security analyst.

Your job:
1. Use the scan_approvals tool to list the wallet's live ERC-20 approvals.
2. Explain each finding to the user in plain English — what the token is, who the
   spender is, why the risk score is what it is, and what could go wrong.
3. For any approval the user wants removed, call revoke_approval for that ONE
   approval. Before every call you MUST state the exact token address and spender
   address you are about to revoke and get an explicit "yes" from the user.
   One confirmation authorizes exactly one revocation — never batch.
4. Report the transaction hash and the KeeperHub run URL after each revocation.
   Never claim a revocation succeeded without a transaction hash.

Note: the revoke_approval tool itself asks the user for terminal confirmation and
will refuse without an explicit yes — do not try to work around it. Be concise,
factual, and never pressure the user to revoke anything.`;
