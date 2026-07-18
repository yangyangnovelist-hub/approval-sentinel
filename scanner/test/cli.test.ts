import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { runCli, scanWithClient, type CliIO, type ScanFn } from '../src/cli.js';
import type { Finding } from '../src/riskScore.js';
import { loadFixture, makeMockClient } from './helpers/mockClient.js';

const fixture = loadFixture('approval-logs.json');
const OWNER = fixture.owner; // 0x1111...11

function makeIO(): CliIO & { out: string[]; errors: string[] } {
  const out: string[] = [];
  const errors: string[] = [];
  return { out, errors, write: (s) => out.push(s), writeErr: (s) => errors.push(s) };
}

/** Fixture-backed scan: same pipeline the real CLI runs, minus the network. */
const fixtureScan: ScanFn = async (address) =>
  scanWithClient(makeMockClient(fixture), address, { fromBlock: 0n });

describe('scanWithClient (pipeline against fixtures)', () => {
  it('produces sorted findings from raw logs', async () => {
    const findings = await scanWithClient(makeMockClient(fixture), OWNER as Address, {
      fromBlock: 0n,
    });

    expect(findings).toHaveLength(2);
    // unlimited + unknown + 400 days + balance at risk
    expect(findings[0]).toMatchObject({
      symbol: 'TKA',
      spender: '0x2222222222222222222222222222222222222222',
      unlimited: true,
      ageDays: 400,
      score: 105,
    });
    // known router, finite, fresh, balance at risk
    expect(findings[1]).toMatchObject({
      spenderLabel: 'Uniswap V2 Router 02',
      unlimited: false,
      score: 15,
    });
  });
});

describe('cli argument parsing and output', () => {
  it('prints a human-readable table by default', async () => {
    const io = makeIO();
    const code = await runCli(['scan', OWNER, '--chain', 'mainnet'], { scan: fixtureScan }, io);

    expect(code).toBe(0);
    const output = io.out.join('\n');
    expect(output).toContain('SCORE');
    expect(output).toContain('TKA');
    expect(output).toContain('unlimited');
    expect(output).toContain('Uniswap V2 Router 02');
    expect(output).toContain('105');
    expect(io.errors).toEqual([]);
  });

  it('emits machine-readable findings with --json', async () => {
    const io = makeIO();
    const code = await runCli(
      ['scan', OWNER, '--chain', 'sepolia', '--json'],
      { scan: fixtureScan },
      io,
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join('\n')) as Finding[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.score).toBe(105);
    expect(parsed[0]!.reasons.length).toBeGreaterThan(0);
    expect(parsed[1]!.spenderLabel).toBe('Uniswap V2 Router 02');
  });

  it('passes chain and --from-block through to the scan function', async () => {
    const calls: Array<{ address: string; chain: string; fromBlock?: bigint }> = [];
    const spyScan: ScanFn = async (address, chain, fromBlock) => {
      calls.push({ address, chain, ...(fromBlock !== undefined ? { fromBlock } : {}) });
      return [];
    };
    const io = makeIO();
    const code = await runCli(
      ['scan', OWNER, '--chain', 'sepolia', '--from-block', '123'],
      { scan: spyScan },
      io,
    );

    expect(code).toBe(0);
    expect(calls).toEqual([{ address: OWNER, chain: 'sepolia', fromBlock: 123n }]);
    expect(io.out.join('\n')).toContain('No live approvals found');
  });

  it('uses block zero for an explicit full-history scan', async () => {
    const starts: Array<bigint | undefined> = [];
    const spyScan: ScanFn = async (_address, _chain, fromBlock) => {
      starts.push(fromBlock);
      return [];
    };

    const code = await runCli(
      ['scan', OWNER, '--chain', 'mainnet', '--full-history'],
      { scan: spyScan },
      makeIO(),
    );

    expect(code).toBe(0);
    expect(starts).toEqual([0n]);
  });

  it('rejects combining --full-history with --from-block', async () => {
    const io = makeIO();
    const code = await runCli(
      ['scan', OWNER, '--full-history', '--from-block', '123'],
      { scan: fixtureScan },
      io,
    );

    expect(code).toBe(1);
    expect(io.errors.join('\n')).toContain('cannot be combined');
  });

  it('defaults to mainnet when --chain is omitted', async () => {
    const chains: string[] = [];
    const spyScan: ScanFn = async (_address, chain) => {
      chains.push(chain);
      return [];
    };
    await runCli(['scan', OWNER], { scan: spyScan }, makeIO());
    expect(chains).toEqual(['mainnet']);
  });

  it('rejects an invalid address', async () => {
    const io = makeIO();
    const code = await runCli(['scan', 'not-an-address'], { scan: fixtureScan }, io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/invalid.*address/i);
  });

  it('rejects an unsupported chain', async () => {
    const io = makeIO();
    const code = await runCli(
      ['scan', OWNER, '--chain', 'dogechain'],
      { scan: fixtureScan },
      io,
    );
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toMatch(/chain/i);
  });

  it('shows usage when no command is given', async () => {
    const io = makeIO();
    const code = await runCli([], { scan: fixtureScan }, io);
    expect(code).toBe(1);
    expect(io.errors.join('\n')).toContain('Usage');
  });
});
