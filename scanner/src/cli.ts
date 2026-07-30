import { pathToFileURL } from 'node:url';
import { createPublicClient, http, isAddress } from 'viem';
import type { Address } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import {
  enrichApprovals,
  fetchApprovals,
  type FetchApprovalsOptions,
  type ScannerClient,
} from './fetchApprovals.js';
import { scoreApprovals, type Finding } from './riskScore.js';

export type ChainName = 'mainnet' | 'sepolia';

/** How far back the default scan looks when --from-block is not given (~9 months of mainnet blocks). */
export const DEFAULT_LOOKBACK_BLOCKS = 2_000_000n;

export interface CliIO {
  write(line: string): void;
  writeErr(line: string): void;
}

export type ScanFn = (
  address: Address,
  chain: ChainName,
  fromBlock?: bigint,
  toBlock?: bigint,
) => Promise<Finding[]>;

/** Full read-only pipeline: logs -> live allowances -> enrichment -> scored findings. */
export async function scanWithClient(
  client: ScannerClient,
  owner: Address,
  options: FetchApprovalsOptions = {},
): Promise<Finding[]> {
  const live = await fetchApprovals(client, owner, options);
  const enriched = await enrichApprovals(client, owner, live);
  return scoreApprovals(
    enriched.map((approval) => ({
      token: approval.token,
      symbol: approval.symbol,
      spender: approval.spender,
      allowance: approval.allowance,
      ageDays: approval.ageDays,
      ownerBalance: approval.ownerBalance,
    })),
  );
}

const defaultScan: ScanFn = async (address, chain, fromBlock, toBlock) => {
  const rpcUrl =
    chain === 'mainnet'
      ? (process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com')
      : (process.env.SEPOLIA_RPC_URL ?? 'https://11155111.rpc.thirdweb.com');
  const client = createPublicClient({
    chain: chain === 'mainnet' ? mainnet : sepolia,
    transport: http(rpcUrl),
  }) as unknown as ScannerClient;
  const latest = toBlock ?? (await client.getBlockNumber());
  const from =
    fromBlock ?? (latest > DEFAULT_LOOKBACK_BLOCKS ? latest - DEFAULT_LOOKBACK_BLOCKS : 0n);
  return scanWithClient(client, address, { fromBlock: from, toBlock: latest });
};

const USAGE = `Usage: sentinel scan <address> [--chain mainnet|sepolia] [--from-block <n> | --full-history] [--to-block <n>] [--json]

Scans a wallet's live ERC-20 approvals and prints risk-scored findings.
  --chain       target chain (default: mainnet)
  --from-block  first block to scan (default: latest - ${DEFAULT_LOOKBACK_BLOCKS})
  --to-block    last block to scan (default: latest)
  --full-history scan from block 0 (complete but RPC-intensive)
  --json        machine-readable output for agents`;

interface ParsedArgs {
  address: Address;
  chain: ChainName;
  json: boolean;
  fromBlock?: bigint;
  toBlock?: bigint;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, address, ...rest] = argv;
  if (command !== 'scan' || !address) throw new Error(USAGE);
  if (!isAddress(address, { strict: false })) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  let chain: ChainName = 'mainnet';
  let json = false;
  let fromBlock: bigint | undefined;
  let toBlock: bigint | undefined;
  let fullHistory = false;

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--json') {
      json = true;
    } else if (flag === '--chain') {
      const value = rest[++i];
      if (value !== 'mainnet' && value !== 'sepolia') {
        throw new Error(`Unsupported chain "${value ?? ''}" — use mainnet or sepolia`);
      }
      chain = value;
    } else if (flag === '--from-block') {
      const value = rest[++i];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error(`--from-block expects a block number, got "${value ?? ''}"`);
      }
      fromBlock = BigInt(value);
    } else if (flag === '--to-block') {
      const value = rest[++i];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error(`--to-block expects a block number, got "${value ?? ''}"`);
      }
      toBlock = BigInt(value);
    } else if (flag === '--full-history') {
      fullHistory = true;
    } else {
      throw new Error(`Unknown flag: ${flag}\n\n${USAGE}`);
    }
  }

  if (fullHistory && fromBlock !== undefined) {
    throw new Error('--full-history cannot be combined with --from-block');
  }
  if (fullHistory) fromBlock = 0n;
  if (fromBlock !== undefined && toBlock !== undefined && toBlock < fromBlock) {
    throw new Error('--to-block must be greater than or equal to --from-block');
  }

  return {
    address: address as Address,
    chain,
    json,
    ...(fromBlock !== undefined ? { fromBlock } : {}),
    ...(toBlock !== undefined ? { toBlock } : {}),
  };
}

function formatAllowance(finding: Finding): string {
  if (finding.unlimited) return 'unlimited';
  const raw = finding.allowance;
  return raw.length > 18 ? `${raw.slice(0, 15)}…(${raw.length} digits)` : raw;
}

export function formatTable(findings: Finding[]): string {
  const header = ['SCORE', 'TOKEN', 'SPENDER', 'ALLOWANCE', 'AGE(D)', 'REASONS'];
  const rows = findings.map((finding) => [
    String(finding.score),
    finding.symbol,
    finding.spenderLabel ?? finding.spender,
    formatAllowance(finding),
    String(finding.ageDays),
    finding.reasons.join('; ') || '—',
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  );
  const renderRow = (row: string[]) =>
    row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ');
  return [renderRow(header), renderRow(widths.map((w) => '-'.repeat(w))), ...rows.map(renderRow)].join(
    '\n',
  );
}

export async function runCli(
  argv: string[],
  deps: { scan: ScanFn } = { scan: defaultScan },
  io: CliIO = { write: (s) => console.log(s), writeErr: (s) => console.error(s) },
): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.writeErr(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const findings = await deps.scan(parsed.address, parsed.chain, parsed.fromBlock, parsed.toBlock);
    if (parsed.json) {
      io.write(JSON.stringify(findings, null, 2));
    } else if (findings.length === 0) {
      io.write(`No live approvals found for ${parsed.address} on ${parsed.chain}.`);
    } else {
      io.write(`Live approvals for ${parsed.address} on ${parsed.chain}:\n`);
      io.write(formatTable(findings));
    }
    return 0;
  } catch (error) {
    io.writeErr(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
