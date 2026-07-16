import { erc20Abi, parseAbiItem } from 'viem';
import type { Address } from 'viem';

/** ERC-20 Approval(address indexed owner, address indexed spender, uint256 value) */
export const approvalEvent = parseAbiItem(
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
);

/** Default getLogs chunk — public RPCs commonly cap eth_getLogs ranges around 10k blocks. */
export const DEFAULT_CHUNK_SIZE = 10_000n;

export interface ApprovalLog {
  address: Address;
  args: { owner?: Address; spender?: Address; value?: bigint };
  blockNumber: bigint;
  logIndex: number;
}

export interface MulticallContract {
  address: Address;
  abi: typeof erc20Abi;
  functionName: 'allowance' | 'symbol' | 'decimals' | 'balanceOf';
  args?: readonly unknown[];
}

export type MulticallResult =
  | { status: 'success'; result: unknown }
  | { status: 'failure'; error: Error };

/**
 * The narrow, structural slice of a viem PublicClient the scanner needs.
 * Keeps unit tests offline: fixtures implement this interface directly.
 * A real PublicClient satisfies it at runtime (cast at the composition root).
 */
export interface ScannerClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(params: {
    event: typeof approvalEvent;
    args: { owner: Address };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<ApprovalLog[]>;
  multicall(params: {
    contracts: MulticallContract[];
    allowFailure: true;
  }): Promise<MulticallResult[]>;
  getBlock(params?: { blockNumber?: bigint }): Promise<{ number: bigint; timestamp: bigint }>;
}

export interface FetchApprovalsOptions {
  fromBlock?: bigint;
  toBlock?: bigint;
  chunkSize?: bigint;
}

export interface LiveApproval {
  token: Address;
  spender: Address;
  /** current on-chain allowance(owner, spender) — authoritative, not the event value */
  allowance: bigint;
  /** block of the latest Approval event for this (token, spender) pair */
  approvedAtBlock: bigint;
}

export interface EnrichedApproval extends LiveApproval {
  symbol: string;
  decimals: number;
  ownerBalance: bigint;
  ageDays: number;
}

/**
 * Scans Approval events for `owner` over chunked block ranges, dedupes to the
 * latest event per (token, spender), then reads allowance(owner, spender) via
 * one multicall batch and keeps only allowances that are still > 0.
 */
export async function fetchApprovals(
  client: ScannerClient,
  owner: Address,
  options: FetchApprovalsOptions = {},
): Promise<LiveApproval[]> {
  const toBlock = options.toBlock ?? (await client.getBlockNumber());
  const fromBlock = options.fromBlock ?? 0n;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;

  const logs: ApprovalLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n < toBlock ? start + chunkSize - 1n : toBlock;
    const chunk = await client.getLogs({
      event: approvalEvent,
      args: { owner },
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }

  // Latest Approval per (token, spender) wins — order by (blockNumber, logIndex).
  const latest = new Map<string, ApprovalLog>();
  for (const log of logs) {
    if (!log.args.spender) continue;
    const key = `${log.address.toLowerCase()}:${log.args.spender.toLowerCase()}`;
    const previous = latest.get(key);
    if (
      !previous ||
      log.blockNumber > previous.blockNumber ||
      (log.blockNumber === previous.blockNumber && log.logIndex > previous.logIndex)
    ) {
      latest.set(key, log);
    }
  }

  const candidates = [...latest.values()];
  if (candidates.length === 0) return [];

  const allowances = await client.multicall({
    contracts: candidates.map((log) => ({
      address: log.address,
      abi: erc20Abi,
      functionName: 'allowance' as const,
      args: [owner, log.args.spender!] as const,
    })),
    allowFailure: true,
  });

  const live: LiveApproval[] = [];
  candidates.forEach((log, i) => {
    const result = allowances[i];
    if (!result || result.status !== 'success') return;
    const allowance = result.result as bigint;
    if (allowance <= 0n) return;
    live.push({
      token: log.address,
      spender: log.args.spender!,
      allowance,
      approvedAtBlock: log.blockNumber,
    });
  });
  return live;
}

const SECONDS_PER_DAY = 86_400n;

/**
 * Adds token metadata (symbol, decimals, owner balance) via one multicall
 * batch and approval age in days from block timestamps. Metadata read
 * failures degrade to placeholders instead of failing the scan.
 */
export async function enrichApprovals(
  client: ScannerClient,
  owner: Address,
  approvals: LiveApproval[],
): Promise<EnrichedApproval[]> {
  if (approvals.length === 0) return [];

  const tokens = [...new Set(approvals.map((a) => a.token.toLowerCase() as Address))];
  const meta = await client.multicall({
    contracts: tokens.flatMap((token): MulticallContract[] => [
      { address: token, abi: erc20Abi, functionName: 'symbol' },
      { address: token, abi: erc20Abi, functionName: 'decimals' },
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] as const },
    ]),
    allowFailure: true,
  });

  const tokenMeta = new Map<string, { symbol: string; decimals: number; ownerBalance: bigint }>();
  tokens.forEach((token, i) => {
    const [symbol, decimals, balance] = [meta[i * 3], meta[i * 3 + 1], meta[i * 3 + 2]];
    tokenMeta.set(token, {
      symbol: symbol?.status === 'success' ? (symbol.result as string) : '???',
      decimals: decimals?.status === 'success' ? Number(decimals.result) : 18,
      ownerBalance: balance?.status === 'success' ? (balance.result as bigint) : 0n,
    });
  });

  const latestBlock = await client.getBlock();
  const timestampByBlock = new Map<bigint, bigint>();
  for (const blockNumber of new Set(approvals.map((a) => a.approvedAtBlock))) {
    const block = await client.getBlock({ blockNumber });
    timestampByBlock.set(blockNumber, block.timestamp);
  }

  return approvals.map((approval) => {
    const metadata = tokenMeta.get(approval.token.toLowerCase())!;
    const approvedAt = timestampByBlock.get(approval.approvedAtBlock) ?? latestBlock.timestamp;
    const age = (latestBlock.timestamp - approvedAt) / SECONDS_PER_DAY;
    return {
      ...approval,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      ownerBalance: metadata.ownerBalance,
      ageDays: Number(age < 0n ? 0n : age),
    };
  });
}
