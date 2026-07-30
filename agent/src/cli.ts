/**
 * ApprovalSentinel agent CLI (Task 2.3).
 *
 *   npx tsx agent/src/cli.ts scan-and-fix <address> [--chain sepolia|mainnet] [--from-block <n>] [--to-block <n>]
 *
 * Two modes, picked automatically:
 *   - LLM mode (ANTHROPIC_API_KEY set): Claude Agent SDK session with a
 *     security-analyst system prompt and two in-process MCP tools
 *     (scan_approvals / revoke_approval).
 *   - Scripted mode (no ANTHROPIC_API_KEY): deterministic orchestration —
 *     scan → present findings → per-approval confirmation → revoke.
 *
 * Either way, every revocation passes the SAME code-enforced gate in
 * harness.ts: token + spender listed, explicit "yes" required, one
 * confirmation = one revocation. KH_API_KEY comes from the environment or the
 * repo-root .env (never logged).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { createPublicClient, erc20Abi, http, isAddress } from 'viem';
import type { Address } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { scanWithClient } from '../../scanner/src/cli.js';
import type { ScannerClient } from '../../scanner/src/fetchApprovals.js';
import { KeeperHubMcpClient } from './mcpClient.js';
import { revokeApproval } from './revoke.js';
import {
  createSessionTools,
  runScanAndFix,
  SECURITY_ANALYST_SYSTEM_PROMPT,
  type ChainName,
  type HarnessIO,
  type RevokeTool,
  type ScanTool,
} from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Same lookback as the scanner CLI default. */
const DEFAULT_LOOKBACK_BLOCKS = 2_000_000n;

const USAGE = `Usage: npx tsx agent/src/cli.ts scan-and-fix <address> [--chain sepolia|mainnet] [--from-block <n> | --full-history] [--to-block <n>]

Scans the wallet for live ERC-20 approvals and interactively revokes the ones
you confirm — one explicit "yes" per revocation, executed via KeeperHub.
Use --full-history for a complete but RPC-intensive scan from block 0.`;

function loadEnvKey(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(here, '../../.env'), 'utf8');
    return env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  } catch {
    return undefined;
  }
}

interface ParsedArgs {
  address: Address;
  chain: ChainName;
  fromBlock?: bigint;
  toBlock?: bigint;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, address, ...rest] = argv;
  if (command !== 'scan-and-fix' || !address) throw new Error(USAGE);
  if (!isAddress(address, { strict: false })) throw new Error(`Invalid Ethereum address: ${address}`);

  let chain: ChainName = 'sepolia';
  let fromBlock: bigint | undefined;
  let toBlock: bigint | undefined;
  let fullHistory = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--chain') {
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
    ...(fromBlock !== undefined ? { fromBlock } : {}),
    ...(toBlock !== undefined ? { toBlock } : {}),
  };
}

function rpcUrlFor(chain: ChainName): string | undefined {
  return chain === 'sepolia'
    ? (process.env.SEPOLIA_RPC_URL ?? 'https://11155111.rpc.thirdweb.com')
    : process.env.MAINNET_RPC_URL;
}

function buildScanTool(): ScanTool {
  return async (address, chain, fromBlock, toBlock) => {
    const client = createPublicClient({
      chain: chain === 'mainnet' ? mainnet : sepolia,
      transport: http(rpcUrlFor(chain)),
    }) as unknown as ScannerClient;
    const latest = toBlock ?? (await client.getBlockNumber());
    const from =
      fromBlock ?? (latest > DEFAULT_LOOKBACK_BLOCKS ? latest - DEFAULT_LOOKBACK_BLOCKS : 0n);
    return scanWithClient(client, address, { fromBlock: from, toBlock: latest });
  };
}

function buildRevokeTool(
  apiKey: string,
  owner: Address,
  chainName: ChainName,
): RevokeTool {
  const client = new KeeperHubMcpClient({ apiKey });
  const chainClient = createPublicClient({
    chain: chainName === 'mainnet' ? mainnet : sepolia,
    transport: http(rpcUrlFor(chainName)),
  });
  return (req) =>
    revokeApproval(req, client, {
      // Replay-safe: retrying the same (token, spender) on the same day replays
      // the original execution instead of spending another transaction.
      idempotencyKey: `as-agent-revoke-${req.token.toLowerCase()}-${req.spender.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
      verifyAllowance: () =>
        chainClient.readContract({
          address: req.token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, req.spender],
        }),
    });
}

/** LLM mode: Claude Agent SDK session with the two sentinel tools. */
async function runLlmMode(
  parsed: ParsedArgs,
  tools: ReturnType<typeof createSessionTools>,
  io: HarnessIO,
): Promise<void> {
  const [{ query, tool, createSdkMcpServer }, { z }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('zod'),
  ]);

  const sentinel = createSdkMcpServer({
    name: 'sentinel',
    version: '0.1.0',
    tools: [
      tool(
        'scan_approvals',
        "Scan a wallet's live ERC-20 approvals and return risk-scored findings (JSON).",
        {
          address: z.string().describe('Wallet address to scan'),
          chain: z.enum(['mainnet', 'sepolia']).describe('Chain to scan'),
        },
        async (args) => {
          const findings = await tools.scan(
            args.address as Address,
            args.chain,
            parsed.fromBlock,
            parsed.toBlock,
          );
          return { content: [{ type: 'text', text: JSON.stringify(findings, null, 2) }] };
        },
      ),
      tool(
        'revoke_approval',
        'Revoke ONE ERC-20 approval (approve(spender, 0)) via KeeperHub. Only (token, spender) pairs from the last scan are accepted, and the user must confirm in the terminal.',
        {
          token: z.string().describe('ERC-20 token contract address, exactly as returned by scan_approvals'),
          spender: z.string().describe('Spender address, exactly as returned by scan_approvals'),
        },
        async (args) => {
          const outcome = await tools.revokeByAddress(args.token, args.spender);
          return { content: [{ type: 'text', text: JSON.stringify(outcome, null, 2) }] };
        },
      ),
    ],
  });

  const result = query({
    prompt: `Scan wallet ${parsed.address} on ${parsed.chain} for risky ERC-20 approvals, explain the findings, and help me revoke the ones I confirm.`,
    options: {
      systemPrompt: SECURITY_ANALYST_SYSTEM_PROMPT,
      mcpServers: { sentinel },
      allowedTools: ['mcp__sentinel__scan_approvals', 'mcp__sentinel__revoke_approval'],
      maxTurns: 30,
    },
  });

  for await (const message of result) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') io.write(block.text);
      }
    } else if (message.type === 'result') {
      io.write('');
      io.write(message.subtype === 'success' ? 'Session complete.' : `Session ended: ${message.subtype}`);
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const khKey = loadEnvKey('KH_API_KEY');
  if (!khKey) {
    console.error('KH_API_KEY not found (env or repo-root .env) — cannot execute revocations.');
    return 1;
  }

  const { io, close } = makeTerminalIO();

  const scan = buildScanTool();
  const revoke = buildRevokeTool(khKey, parsed.address, parsed.chain);

  try {
    const anthropicKey = loadEnvKey('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      process.env.ANTHROPIC_API_KEY = anthropicKey;
      const tools = createSessionTools({ scan, revoke, chain: parsed.chain, io });
      await runLlmMode(parsed, tools, io);
    } else {
      io.write('ANTHROPIC_API_KEY not set — running scripted orchestration (no LLM).');
      const summary = await runScanAndFix(parsed, { scan, revoke, io });
      return summary.failed.length > 0 ? 1 : 0;
    }
    return 0;
  } catch (error) {
    console.error(`scan-and-fix failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    close();
  }
}

/**
 * Terminal IO that also works with piped stdin: lines arriving before a
 * question is pending are buffered instead of dropped, and EOF answers every
 * later question with "quit" — a closed stdin can never authorize a revoke.
 */
function makeTerminalIO(): { io: HarnessIO; close: () => void } {
  const rl = createInterface({ input: process.stdin });
  const buffered: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;

  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length > 0) waiters.shift()!('quit');
  });

  const io: HarnessIO = {
    write: (line) => console.log(line),
    ask: (question) => {
      process.stdout.write(question);
      const ready = buffered.shift();
      if (ready !== undefined) {
        process.stdout.write(`${ready}\n`);
        return Promise.resolve(ready);
      }
      if (closed) {
        process.stdout.write('quit (stdin closed)\n');
        return Promise.resolve('quit');
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
  return { io, close: () => rl.close() };
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
