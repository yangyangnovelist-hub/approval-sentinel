import { encodeFunctionData, erc20Abi } from 'viem';
import type { Address, Hex } from 'viem';
import type { ExecutionStatus, RevokeExecutor } from './mcpClient.js';

export interface RevokeRequest {
  /** ERC-20 token contract whose allowance is being cleared. */
  token: Address;
  /** The spender whose allowance is set back to zero. */
  spender: Address;
  /** EVM chain id as a decimal string, e.g. '11155111' for Sepolia. */
  chainId: string;
}

export interface RevokeResult {
  txHash: string;
  /** KeeperHub run page for the execution (audit trail). */
  runUrl: string;
  executionId: string;
  /** The exact `approve(spender, 0)` calldata that was executed. */
  calldata: Hex;
  /** Block explorer link, when KeeperHub supplies one. */
  transactionLink?: string;
  /** Fresh on-chain allowance read after the receipt, when verification is configured. */
  verifiedAllowance?: string;
}

export interface RevokeOptions {
  /** Idempotency-Key so a retry with identical args replays instead of re-executing. */
  idempotencyKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  /** Injected for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Base for the run URL; execution id is appended. */
  runUrlBase?: string;
  /** Independent on-chain allowance read performed after KeeperHub confirms the receipt. */
  verifyAllowance?: () => Promise<bigint>;
}

/** Details attached to a failed revoke so callers can surface the KeeperHub audit trail. */
export class RevokeError extends Error {
  readonly executionId: string;
  readonly runUrl: string;
  readonly status: ExecutionStatus | undefined;

  constructor(
    message: string,
    ctx: { executionId: string; runUrl: string; status?: ExecutionStatus },
  ) {
    super(message);
    this.name = 'RevokeError';
    this.executionId = ctx.executionId;
    this.runUrl = ctx.runUrl;
    this.status = ctx.status;
  }
}

const SUCCESS_STATES = new Set(['completed', 'success', 'confirmed']);
const FAILURE_STATES = new Set(['failed', 'error', 'reverted', 'cancelled', 'canceled']);
const DEFAULT_RUN_URL_BASE = 'https://app.keeperhub.com/executions';

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Builds `approve(spender, 0)` calldata, submits it through the KeeperHub MCP
 * `execute_contract_call` tool, and polls `get_direct_execution_status` until the
 * execution reaches a terminal state.
 *
 * Returns `{ txHash, runUrl, ... }` only on a confirmed on-chain receipt.
 * Any failure — reverted, errored, terminal-without-hash, or poll timeout — throws
 * a `RevokeError` carrying the KeeperHub run link. It never claims success without
 * a transaction hash.
 */
export async function revokeApproval(
  req: RevokeRequest,
  executor: RevokeExecutor,
  options: RevokeOptions = {},
): Promise<RevokeResult> {
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPollAttempts = options.maxPollAttempts ?? 30;
  const runUrlBase = options.runUrlBase ?? DEFAULT_RUN_URL_BASE;

  const calldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [req.spender, 0n],
  });

  const submit = await executor.executeContractCall({
    contract_address: req.token,
    chain_id: req.chainId,
    function_name: 'approve',
    // KeeperHub expects a JSON *string* array; amount as a decimal string.
    function_args: JSON.stringify([req.spender, '0']),
    ...(options.idempotencyKey ? { idempotency_key: options.idempotencyKey } : {}),
  });

  const executionId = submit.executionId;
  const runUrl = `${runUrlBase}/${executionId}`;

  let last: ExecutionStatus = { executionId, status: submit.status };
  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    last = await executor.getDirectExecutionStatus(executionId);
    const state = (last.status ?? '').toLowerCase();

    if (FAILURE_STATES.has(state) || last.result?.success === false) {
      throw new RevokeError(
        `KeeperHub execution ${executionId} failed (${last.status}): ${last.error ?? 'reverted'} — see ${runUrl}`,
        { executionId, runUrl, status: last },
      );
    }

    if (SUCCESS_STATES.has(state)) {
      const txHash = last.transactionHash ?? last.result?.transactionHash;
      if (!txHash) {
        throw new RevokeError(
          `KeeperHub execution ${executionId} reported "${last.status}" without a transaction hash — see ${runUrl}`,
          { executionId, runUrl, status: last },
        );
      }
      const transactionLink = last.transactionLink ?? last.result?.transactionLink;
      let verifiedAllowance: string | undefined;
      if (options.verifyAllowance) {
        let allowance: bigint;
        try {
          allowance = await options.verifyAllowance();
        } catch (error) {
          throw new RevokeError(
            `KeeperHub execution ${executionId} confirmed, but the on-chain allowance re-read failed: ${error instanceof Error ? error.message : String(error)} — see ${runUrl}`,
            { executionId, runUrl, status: last },
          );
        }
        if (allowance !== 0n) {
          throw new RevokeError(
            `KeeperHub execution ${executionId} confirmed, but the on-chain allowance is still ${allowance} — see ${runUrl}`,
            { executionId, runUrl, status: last },
          );
        }
        verifiedAllowance = allowance.toString();
      }
      return {
        txHash,
        runUrl,
        executionId,
        calldata,
        ...(transactionLink ? { transactionLink } : {}),
        ...(verifiedAllowance !== undefined ? { verifiedAllowance } : {}),
      };
    }

    if (attempt < maxPollAttempts - 1) await sleep(pollIntervalMs);
  }

  throw new RevokeError(
    `KeeperHub execution ${executionId} did not reach a terminal state after ${maxPollAttempts} polls (last status: ${last.status}) — see ${runUrl}`,
    { executionId, runUrl, status: last },
  );
}
