/**
 * Integration test — hits the LIVE KeeperHub MCP server and Sepolia.
 *
 * Tagged "integration"; excluded from the default `npm test` run. Execute with
 * `npm run test:integration`. Requires KH_API_KEY (read from the repo-root .env).
 *
 * It revokes ONE of the dirty-wallet approvals seeded in docs/first-execution.md
 * (WETH → 0xdEaD) through the real revoke executor, then reads the on-chain
 * allowance directly with viem and asserts it is exactly 0.
 *
 * LINK's approval is intentionally left dirty so the agent-harness demo (Task 2.3)
 * still has something to revoke.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPublicClient, erc20Abi, getAddress, http } from 'viem';
import { sepolia } from 'viem/chains';
import { revokeApproval } from '../src/revoke.js';
import { KeeperHubMcpClient } from '../src/mcpClient.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadApiKey(): string | undefined {
  if (process.env.KH_API_KEY) return process.env.KH_API_KEY;
  try {
    const env = readFileSync(resolve(here, '../../.env'), 'utf8');
    return env.match(/^KH_API_KEY=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

// Executor wallet + seeded dirty approval — see docs/first-execution.md.
const OWNER = getAddress('0xC7d92E2089BfD22539553FA8ea061cB094274dc5');
const WETH = getAddress('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14');
const DEAD = getAddress('0x000000000000000000000000000000000000dEaD');
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const apiKey = loadApiKey();

const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

function allowance(owner: `0x${string}`, spender: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: WETH,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  });
}

describe.skipIf(!apiKey)('revokeApproval — live KeeperHub + Sepolia', () => {
  it('drives the WETH allowance to zero and returns a real tx receipt', async () => {
    const client = new KeeperHubMcpClient({ apiKey: apiKey! });

    const result = await revokeApproval(
      { token: WETH, spender: DEAD, chainId: '11155111' },
      client,
      {
        // Fixed key: a rerun replays the original revoke (allowance already 0) rather
        // than spending another sponsored tx.
        idempotencyKey: 'as-revoke-weth-dead-integration-01',
        pollIntervalMs: 2_000,
        maxPollAttempts: 40,
      },
    );

    expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.runUrl).toContain(result.executionId);
    expect(result.calldata.startsWith('0x095ea7b3')).toBe(true);

    const after = await allowance(OWNER, DEAD);
    expect(after).toBe(0n);
  });
});
