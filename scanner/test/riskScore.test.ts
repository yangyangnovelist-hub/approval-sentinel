import { describe, expect, it } from 'vitest';
import { maxUint256, type Address } from 'viem';
import {
  KNOWN_PROTOCOLS,
  scoreApprovals,
  type ApprovalForScoring,
  type Finding,
} from '../src/riskScore.js';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const UNKNOWN_SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

function approval(overrides: Partial<ApprovalForScoring> = {}): ApprovalForScoring {
  return {
    token: TOKEN,
    symbol: 'TKA',
    spender: UNKNOWN_SPENDER,
    allowance: 1000n,
    ageDays: 0,
    ownerBalance: 0n,
    ...overrides,
  };
}

describe('scoreApprovals — table-driven scoring', () => {
  interface Case {
    name: string;
    input: ApprovalForScoring;
    expected: Partial<Finding> & { reasonCount: number };
  }

  const cases: Case[] = [
    {
      name: 'fresh finite approval to a known protocol, no balance -> score 0',
      input: approval({ spender: UNISWAP_V2_ROUTER }),
      expected: { score: 0, unlimited: false, spenderLabel: 'Uniswap V2 Router 02', reasonCount: 0 },
    },
    {
      name: 'unlimited allowance -> +40',
      input: approval({ spender: UNISWAP_V2_ROUTER, allowance: maxUint256 }),
      expected: { score: 40, unlimited: true, reasonCount: 1 },
    },
    {
      name: 'near-max allowance also counts as unlimited',
      input: approval({ spender: UNISWAP_V2_ROUTER, allowance: maxUint256 / 2n + 1n }),
      expected: { score: 40, unlimited: true, reasonCount: 1 },
    },
    {
      name: 'unknown spender -> +30',
      input: approval(),
      expected: { score: 30, unlimited: false, reasonCount: 1 },
    },
    {
      name: 'age >= 180 days -> +10',
      input: approval({ spender: PERMIT2, ageDays: 180 }),
      expected: { score: 10, spenderLabel: 'Permit2', reasonCount: 1 },
    },
    {
      name: 'age >= 365 days -> +20',
      input: approval({ spender: PERMIT2, ageDays: 400 }),
      expected: { score: 20, reasonCount: 1 },
    },
    {
      name: 'owner still holds the token -> +15',
      input: approval({ spender: PERMIT2, ownerBalance: 10n ** 18n }),
      expected: { score: 15, reasonCount: 1 },
    },
    {
      name: 'worst case: unlimited + unknown + old + balance at risk -> 105',
      input: approval({ allowance: maxUint256, ageDays: 400, ownerBalance: 10n ** 18n }),
      expected: { score: 105, unlimited: true, reasonCount: 4 },
    },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    const [finding] = scoreApprovals([input]);
    expect(finding).toBeDefined();
    const { reasonCount, ...fields } = expected;
    expect(finding).toMatchObject(fields);
    expect(finding!.reasons).toHaveLength(reasonCount);
    if (!('spenderLabel' in expected)) {
      // unknown spenders carry no label
      if (input.spender === UNKNOWN_SPENDER) expect(finding!.spenderLabel).toBeUndefined();
    }
  });

  it('serializes allowance as a decimal string and echoes input fields', () => {
    const [finding] = scoreApprovals([
      approval({ allowance: 12345n, ageDays: 7, symbol: 'USDC' }),
    ]);
    expect(finding).toMatchObject({
      token: TOKEN,
      symbol: 'USDC',
      spender: UNKNOWN_SPENDER,
      allowance: '12345',
      ageDays: 7,
    });
    // Finding must be JSON-safe (no bigint fields)
    expect(() => JSON.stringify(finding)).not.toThrow();
  });

  it('sorts findings by score descending', () => {
    const findings = scoreApprovals([
      approval({ spender: PERMIT2 }), // 0
      approval({ allowance: maxUint256, ageDays: 400, ownerBalance: 1n }), // 105
      approval({ spender: UNISWAP_V2_ROUTER, allowance: maxUint256 }), // 40
    ]);
    expect(findings.map((f) => f.score)).toEqual([105, 40, 0]);
  });

  it('matches known protocols case-insensitively', () => {
    const [finding] = scoreApprovals([
      approval({ spender: UNISWAP_V2_ROUTER.toLowerCase() as Address }),
    ]);
    expect(finding!.spenderLabel).toBe('Uniswap V2 Router 02');
    expect(finding!.score).toBe(0);
  });
});

describe('bundled known-protocols allowlist', () => {
  it('contains the 10 curated mainnet protocol contracts', () => {
    const labels = Object.values(KNOWN_PROTOCOLS);
    expect(labels).toHaveLength(10);
    for (const expected of [
      'Uniswap V2 Router 02',
      'Uniswap V3 SwapRouter02',
      'Permit2',
      '1inch Aggregation Router V5',
      '1inch Aggregation Router V6',
      '0x Exchange Proxy',
      'OpenSea Seaport 1.5',
      'OpenSea Seaport 1.6',
      'Aave V3 Pool',
      'CoW Protocol GPv2 Settlement',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('keys every entry by lowercase address', () => {
    for (const address of Object.keys(KNOWN_PROTOCOLS)) {
      expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });
});
