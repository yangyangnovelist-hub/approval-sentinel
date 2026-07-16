import { readFileSync } from 'node:fs';
import type { Address } from 'viem';
import { maxUint256 } from 'viem';
import type {
  ApprovalLog,
  MulticallResult,
  ScannerClient,
} from '../../src/fetchApprovals.js';

interface FixtureLog {
  token: string;
  spender: string;
  value: string;
  blockNumber: string;
  logIndex: number;
}

export interface Fixture {
  owner: string;
  latestBlock: string;
  logs: FixtureLog[];
  allowances: Record<string, string>;
  tokens: Record<string, { symbol: string; decimals: number; ownerBalance: string }>;
  blockTimestamps: Record<string, string>;
}

function parseValue(value: string): bigint {
  return value === 'MAX_UINT256' ? maxUint256 : BigInt(value);
}

export function loadFixture(name: string): Fixture {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Fixture;
}

export interface MockClient extends ScannerClient {
  /** block ranges passed to getLogs, for chunking assertions */
  getLogsCalls: Array<{ fromBlock: bigint; toBlock: bigint; owner: Address }>;
  multicallCalls: Array<{ functionName: string; address: string; args: readonly unknown[] }[]>;
}

/**
 * Builds an offline ScannerClient backed entirely by the JSON fixture.
 * No network access — getLogs serves recorded log entries filtered by the
 * requested block range, multicall answers allowance/symbol/decimals/balanceOf
 * from fixture maps, getBlock serves recorded timestamps.
 */
export function makeMockClient(fixture: Fixture): MockClient {
  const getLogsCalls: MockClient['getLogsCalls'] = [];
  const multicallCalls: MockClient['multicallCalls'] = [];

  return {
    getLogsCalls,
    multicallCalls,

    async getBlockNumber() {
      return BigInt(fixture.latestBlock);
    },

    async getLogs({ args, fromBlock, toBlock }) {
      getLogsCalls.push({ fromBlock, toBlock, owner: args.owner });
      const logs: ApprovalLog[] = [];
      for (const log of fixture.logs) {
        const blockNumber = BigInt(log.blockNumber);
        if (blockNumber < fromBlock || blockNumber > toBlock) continue;
        logs.push({
          address: log.token as Address,
          args: {
            owner: fixture.owner as Address,
            spender: log.spender as Address,
            value: parseValue(log.value),
          },
          blockNumber,
          logIndex: log.logIndex,
        });
      }
      return logs;
    },

    async multicall({ contracts }) {
      multicallCalls.push(
        contracts.map((c) => ({
          functionName: c.functionName,
          address: c.address.toLowerCase(),
          args: c.args ?? [],
        })),
      );
      return contracts.map((contract): MulticallResult => {
        const token = contract.address.toLowerCase();
        const tokenMeta = fixture.tokens[token];
        switch (contract.functionName) {
          case 'allowance': {
            const spender = String(contract.args?.[1]).toLowerCase();
            const allowance = fixture.allowances[`${token}:${spender}`];
            if (allowance === undefined) {
              return { status: 'failure', error: new Error(`no allowance fixture for ${token}:${spender}`) };
            }
            return { status: 'success', result: parseValue(allowance) };
          }
          case 'symbol':
            if (!tokenMeta) return { status: 'failure', error: new Error(`no token fixture for ${token}`) };
            return { status: 'success', result: tokenMeta.symbol };
          case 'decimals':
            if (!tokenMeta) return { status: 'failure', error: new Error(`no token fixture for ${token}`) };
            return { status: 'success', result: tokenMeta.decimals };
          case 'balanceOf':
            if (!tokenMeta) return { status: 'failure', error: new Error(`no token fixture for ${token}`) };
            return { status: 'success', result: BigInt(tokenMeta.ownerBalance) };
          default:
            return { status: 'failure', error: new Error(`unexpected call ${contract.functionName}`) };
        }
      });
    },

    async getBlock(params) {
      const blockNumber = params?.blockNumber ?? BigInt(fixture.latestBlock);
      const timestamp = fixture.blockTimestamps[blockNumber.toString()];
      if (timestamp === undefined) {
        throw new Error(`no timestamp fixture for block ${blockNumber}`);
      }
      return { number: blockNumber, timestamp: BigInt(timestamp) };
    },
  };
}
