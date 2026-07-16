import { describe, expect, it } from 'vitest';
import { maxUint256, type Address } from 'viem';
import { enrichApprovals, fetchApprovals } from '../src/fetchApprovals.js';
import { loadFixture, makeMockClient } from './helpers/mockClient.js';

const fixture = loadFixture('approval-logs.json');
const OWNER = fixture.owner as Address;
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const UNKNOWN_SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address;

describe('fetchApprovals', () => {
  it('chunks the getLogs block range to respect public RPC limits', async () => {
    const client = makeMockClient(fixture);
    await fetchApprovals(client, OWNER, { fromBlock: 0n, chunkSize: 300n });

    // latest block 1000, chunk 300 -> [0,299] [300,599] [600,899] [900,1000]
    expect(client.getLogsCalls).toEqual([
      { fromBlock: 0n, toBlock: 299n, owner: OWNER },
      { fromBlock: 300n, toBlock: 599n, owner: OWNER },
      { fromBlock: 600n, toBlock: 899n, owner: OWNER },
      { fromBlock: 900n, toBlock: 1000n, owner: OWNER },
    ]);
  });

  it('dedupes to the latest approval per (token, spender) and keeps only live allowances', async () => {
    const client = makeMockClient(fixture);
    const live = await fetchApprovals(client, OWNER, { fromBlock: 0n, chunkSize: 300n });

    // tokenB was revoked on-chain (allowance 0) -> dropped entirely.
    expect(live).toHaveLength(2);

    const unlimited = live.find((a) => a.spender.toLowerCase() === UNKNOWN_SPENDER);
    expect(unlimited).toBeDefined();
    expect(unlimited?.token.toLowerCase()).toBe(TOKEN_A);
    // latest event for (tokenA, unknown) is block 200, not the block-100 one
    expect(unlimited?.approvedAtBlock).toBe(200n);
    // allowance comes from the multicall allowance() read, not the event value
    expect(unlimited?.allowance).toBe(maxUint256);

    const router = live.find(
      (a) => a.spender.toLowerCase() === UNISWAP_V2_ROUTER.toLowerCase(),
    );
    expect(router).toBeDefined();
    expect(router?.approvedAtBlock).toBe(150n);
    // partially spent: allowance() returns 3000e18 even though the event said 5000e18
    expect(router?.allowance).toBe(3000n * 10n ** 18n);

    expect(live.some((a) => a.token.toLowerCase() === TOKEN_B)).toBe(false);
  });

  it('queries allowance(owner, spender) via a single multicall batch', async () => {
    const client = makeMockClient(fixture);
    await fetchApprovals(client, OWNER, { fromBlock: 0n, chunkSize: 1001n });

    expect(client.multicallCalls).toHaveLength(1);
    const batch = client.multicallCalls[0]!;
    expect(batch.every((c) => c.functionName === 'allowance')).toBe(true);
    // 3 deduped (token, spender) pairs
    expect(batch).toHaveLength(3);
    expect(batch.every((c) => c.args[0] === OWNER)).toBe(true);
  });

  it('returns [] without multicalling when no Approval logs exist', async () => {
    const client = makeMockClient({ ...fixture, logs: [] });
    const live = await fetchApprovals(client, OWNER, { fromBlock: 0n });
    expect(live).toEqual([]);
    expect(client.multicallCalls).toHaveLength(0);
  });

  it('defaults toBlock to the current block number', async () => {
    const client = makeMockClient(fixture);
    await fetchApprovals(client, OWNER, { fromBlock: 900n });
    expect(client.getLogsCalls).toEqual([{ fromBlock: 900n, toBlock: 1000n, owner: OWNER }]);
  });
});

describe('enrichApprovals', () => {
  it('adds symbol, decimals, owner balance and approval age in days', async () => {
    const client = makeMockClient(fixture);
    const live = await fetchApprovals(client, OWNER, { fromBlock: 0n });
    const enriched = await enrichApprovals(client, OWNER, live);

    expect(enriched).toHaveLength(2);

    const unlimited = enriched.find((a) => a.spender.toLowerCase() === UNKNOWN_SPENDER)!;
    expect(unlimited.symbol).toBe('TKA');
    expect(unlimited.decimals).toBe(18);
    expect(unlimited.ownerBalance).toBe(10n ** 18n);
    // block 200 ts vs latest block ts = exactly 400 days
    expect(unlimited.ageDays).toBe(400);

    const router = enriched.find(
      (a) => a.spender.toLowerCase() === UNISWAP_V2_ROUTER.toLowerCase(),
    )!;
    // block 150 ts vs latest block ts = exactly 30 days
    expect(router.ageDays).toBe(30);
    expect(router.ownerBalance).toBe(10n ** 18n);
  });

  it('returns [] for empty input without any RPC reads', async () => {
    const client = makeMockClient(fixture);
    expect(await enrichApprovals(client, OWNER, [])).toEqual([]);
    expect(client.multicallCalls).toHaveLength(0);
  });

  it('falls back gracefully when token metadata reads fail', async () => {
    const noMeta = { ...fixture, tokens: {} };
    const client = makeMockClient(noMeta);
    const live = await fetchApprovals(client, OWNER, { fromBlock: 0n });
    const enriched = await enrichApprovals(client, OWNER, live);

    expect(enriched).toHaveLength(2);
    for (const approval of enriched) {
      expect(approval.symbol).toBe('???');
      expect(approval.decimals).toBe(18);
      expect(approval.ownerBalance).toBe(0n);
    }
  });
});
