/**
 * Unit tests for the agent harness confirmation gate (Task 2.3).
 *
 * Both tools are mocked. What is pinned down here:
 *   - no revocation ever happens without an explicit per-approval "yes";
 *   - the prompt shown before each revocation names token AND spender;
 *   - one confirmation authorizes exactly one revocation;
 *   - "quit" stops immediately, leaving later approvals untouched;
 *   - a failed revoke surfaces the KeeperHub run link and never counts as revoked;
 *   - the LLM-facing tool set refuses (token, spender) pairs absent from the last scan.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import type { Finding } from '../../scanner/src/riskScore.js';
import {
  createSessionTools,
  isExplicitYes,
  runScanAndFix,
  type HarnessIO,
  type RevokeTool,
  type ScanTool,
} from '../src/harness.js';
import { RevokeError, type RevokeResult } from '../src/revoke.js';

const LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789' as Address;
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as Address;
const DEAD = '0x000000000000000000000000000000000000dEaD' as Address;
const BEEF = '0x000000000000000000000000000000000000bEEF' as Address;
const OWNER = '0xC7d92E2089BfD22539553FA8ea061cB094274dc5' as Address;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    token: LINK,
    symbol: 'LINK',
    spender: DEAD,
    allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    unlimited: true,
    ageDays: 0,
    score: 85,
    reasons: ['Unlimited allowance', 'Spender is not on the known-protocol allowlist'],
    ...overrides,
  };
}

function revokeResult(overrides: Partial<RevokeResult> = {}): RevokeResult {
  return {
    txHash: '0x' + 'ab'.repeat(32),
    runUrl: 'https://app.keeperhub.com/executions/test-exec-1',
    executionId: 'test-exec-1',
    calldata: '0x095ea7b3',
    ...overrides,
  };
}

/** Scripted IO: replays canned answers, records every line + question. */
function makeIO(answers: string[]): HarnessIO & { lines: string[]; questions: string[] } {
  const lines: string[] = [];
  const questions: string[] = [];
  return {
    lines,
    questions,
    write: (line) => lines.push(line),
    ask: async (question) => {
      questions.push(question);
      const next = answers.shift();
      if (next === undefined) throw new Error('IO asked more questions than scripted answers');
      return next;
    },
  };
}

const opts = { address: OWNER, chain: 'sepolia' as const };

describe('isExplicitYes', () => {
  it('accepts only an unambiguous yes', () => {
    for (const yes of ['yes', 'y', ' YES ', 'Y']) expect(isExplicitYes(yes)).toBe(true);
    for (const no of ['', 'no', 'ok', 'sure', 'yes please', 'yeah', 'ja', 'revoke it']) {
      expect(isExplicitYes(no)).toBe(false);
    }
  });
});

describe('runScanAndFix — confirmation gate', () => {
  it('passes explicit block bounds to the scanner', async () => {
    const scan = vi.fn(async () => []) as ScanTool;
    const revoke = vi.fn() as unknown as RevokeTool;

    await runScanAndFix(
      { ...opts, fromBlock: 11284422n, toBlock: 11284422n },
      { scan, revoke, io: makeIO([]) },
    );

    expect(scan).toHaveBeenCalledWith(OWNER, 'sepolia', 11284422n, 11284422n);
  });

  it('reports clean and never asks or revokes when there are no findings', async () => {
    const scan: ScanTool = vi.fn(async () => []);
    const revoke = vi.fn() as unknown as RevokeTool;
    const io = makeIO([]);

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(summary.findings).toEqual([]);
    expect(io.questions).toHaveLength(0);
    expect(revoke).not.toHaveBeenCalled();
    expect(io.lines.join('\n')).toContain('no live approvals');
  });

  it('lists token and spender in the confirmation prompt before any revoke', async () => {
    const scan: ScanTool = async () => [finding()];
    const calls: string[] = [];
    const revoke: RevokeTool = vi.fn(async () => {
      calls.push('revoke');
      return revokeResult();
    });
    const io = makeIO(['yes']);
    const originalAsk = io.ask;
    io.ask = (q) => {
      calls.push('ask');
      return originalAsk(q);
    };

    await runScanAndFix(opts, { scan, revoke, io });

    // The gate asks BEFORE revoking, and the surrounding output names both addresses.
    expect(calls).toEqual(['ask', 'revoke']);
    const shownBeforeAsk = io.lines.join('\n');
    expect(shownBeforeAsk).toContain(LINK);
    expect(shownBeforeAsk).toContain(DEAD);
    expect(io.questions[0]).toContain(DEAD);
  });

  it('revokes exactly the confirmed approval and passes the right chain id', async () => {
    const scan: ScanTool = async () => [finding()];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO(['yes']);

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith({ token: LINK, spender: DEAD, chainId: '11155111' });
    expect(summary.revoked).toHaveLength(1);
    expect(io.lines.join('\n')).toContain(revokeResult().runUrl);
  });

  it('treats anything but an explicit yes as a skip', async () => {
    const scan: ScanTool = async () => [
      finding(),
      finding({ token: WETH, symbol: 'WETH', spender: BEEF }),
    ];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO(['sure', 'yes please']);

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(revoke).not.toHaveBeenCalled();
    expect(summary.revoked).toHaveLength(0);
    expect(summary.skipped).toHaveLength(2);
  });

  it('requires one confirmation per revocation — never batches', async () => {
    const scan: ScanTool = async () => [
      finding(),
      finding({ token: WETH, symbol: 'WETH', spender: BEEF }),
    ];
    const order: string[] = [];
    const revoke: RevokeTool = vi.fn(async (req) => {
      order.push(`revoke:${req.token}`);
      return revokeResult();
    });
    const io = makeIO(['yes', 'yes']);
    const originalAsk = io.ask;
    io.ask = (q) => {
      order.push('ask');
      return originalAsk(q);
    };

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(summary.revoked).toHaveLength(2);
    // Strict interleaving: ask → revoke → ask → revoke.
    expect(order).toEqual(['ask', `revoke:${LINK}`, 'ask', `revoke:${WETH}`]);
  });

  it('stops immediately on quit and leaves the rest untouched', async () => {
    const scan: ScanTool = async () => [
      finding(),
      finding({ token: WETH, symbol: 'WETH', spender: BEEF }),
    ];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO(['quit']);

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(revoke).not.toHaveBeenCalled();
    expect(io.questions).toHaveLength(1);
    expect(summary.quit).toBe(true);
  });

  it('surfaces a failed revoke with its run link and continues to the next finding', async () => {
    const scan: ScanTool = async () => [
      finding(),
      finding({ token: WETH, symbol: 'WETH', spender: BEEF }),
    ];
    const revoke: RevokeTool = vi
      .fn()
      .mockRejectedValueOnce(
        new RevokeError('execution failed (reverted)', {
          executionId: 'exec-bad',
          runUrl: 'https://app.keeperhub.com/executions/exec-bad',
        }),
      )
      .mockResolvedValueOnce(revokeResult({ executionId: 'exec-good' }));
    const io = makeIO(['yes', 'yes']);

    const summary = await runScanAndFix(opts, { scan, revoke, io });

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]!.runUrl).toBe('https://app.keeperhub.com/executions/exec-bad');
    expect(summary.revoked).toHaveLength(1);
    const output = io.lines.join('\n');
    expect(output).toContain('FAILED');
    expect(output).toContain('executions/exec-bad');
    // The failure is never presented as a success.
    expect(output).not.toMatch(/Revoked LINK/);
  });
});

describe('createSessionTools — LLM-facing tool safety', () => {
  it('refuses to revoke a (token, spender) pair that was not in the last scan', async () => {
    const scan: ScanTool = async () => [finding()];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO([]);
    const tools = createSessionTools({ scan, revoke, chain: 'sepolia', io });

    await tools.scan(OWNER, 'sepolia');
    const outcome = await tools.revokeByAddress(WETH, BEEF);

    expect(outcome.status).toBe('rejected');
    expect(revoke).not.toHaveBeenCalled();
    expect(io.questions).toHaveLength(0); // not even asked — rejected before the gate
  });

  it('refuses any revoke before the first scan', async () => {
    const scan = vi.fn(async () => [finding()]) as ScanTool;
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const tools = createSessionTools({ scan, revoke, chain: 'sepolia', io: makeIO([]) });

    const outcome = await tools.revokeByAddress(LINK, DEAD);

    expect(outcome.status).toBe('rejected');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('still runs the terminal confirmation gate for a known pair (case-insensitive match)', async () => {
    const scan: ScanTool = async () => [finding()];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO(['yes']);
    const tools = createSessionTools({ scan, revoke, chain: 'sepolia', io });

    await tools.scan(OWNER, 'sepolia');
    const outcome = await tools.revokeByAddress(LINK.toLowerCase(), DEAD.toUpperCase().replace('0X', '0x'));

    expect(io.questions).toHaveLength(1);
    expect(outcome.status).toBe('revoked');
    expect(revoke).toHaveBeenCalledWith({ token: LINK, spender: DEAD, chainId: '11155111' });
  });

  it('reports declined when the user does not give an explicit yes', async () => {
    const scan: ScanTool = async () => [finding()];
    const revoke = vi.fn(async () => revokeResult()) as RevokeTool;
    const io = makeIO(['no']);
    const tools = createSessionTools({ scan, revoke, chain: 'sepolia', io });

    await tools.scan(OWNER, 'sepolia');
    const outcome = await tools.revokeByAddress(LINK, DEAD);

    expect(outcome.status).toBe('declined');
    expect(revoke).not.toHaveBeenCalled();
  });
});
