import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress } from 'viem';
import type { Address } from 'viem';
import { revokeApproval, RevokeError } from '../src/revoke.js';
import type {
  ExecuteContractCallParams,
  ExecuteResult,
  ExecutionStatus,
  RevokeExecutor,
} from '../src/mcpClient.js';

const TOKEN = getAddress('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'); // Sepolia WETH
const SPENDER = getAddress('0x000000000000000000000000000000000000dEaD');
const TX = '0x10334ebfdef7b3f11e6c9787fb2ed7a4834345340e9586f28c51f6b2048d93d4';

const noSleep = () => Promise.resolve();

/** A scripted RevokeExecutor: one execute result, then a queue of status responses. */
function makeExecutor(opts: {
  submit?: ExecuteResult;
  statuses: ExecutionStatus[];
  onExecute?: (p: ExecuteContractCallParams) => void;
}): RevokeExecutor {
  const statuses = [...opts.statuses];
  return {
    executeContractCall: vi.fn(async (p: ExecuteContractCallParams) => {
      opts.onExecute?.(p);
      return opts.submit ?? { executionId: 'exec_1', status: 'pending' };
    }),
    getDirectExecutionStatus: vi.fn(async (executionId: string): Promise<ExecutionStatus> => {
      // Last scripted status repeats once the queue drains.
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return { ...next, executionId };
    }),
  };
}

const req = { token: TOKEN, spender: SPENDER, chainId: '11155111' } as const;

describe('revokeApproval — request construction', () => {
  it('submits approve with the spender and amount "0" as a JSON-string arg array', async () => {
    let captured: ExecuteContractCallParams | undefined;
    const executor = makeExecutor({
      submit: { executionId: 'exec_1', status: 'completed' },
      statuses: [{ executionId: 'exec_1', status: 'completed', transactionHash: TX }],
      onExecute: (p) => {
        captured = p;
      },
    });

    await revokeApproval(req, executor, { sleep: noSleep });

    expect(captured?.contract_address).toBe(TOKEN);
    expect(captured?.chain_id).toBe('11155111');
    expect(captured?.function_name).toBe('approve');
    expect(captured?.function_args).toBe(JSON.stringify([SPENDER, '0']));
    // KeeperHub requires function_args as a JSON string, not an array.
    expect(typeof captured?.function_args).toBe('string');
  });

  it('encodes calldata as a real approve(spender, 0) call', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_1', status: 'completed' },
      statuses: [{ executionId: 'exec_1', status: 'completed', transactionHash: TX }],
    });

    const { calldata } = await revokeApproval(req, executor, { sleep: noSleep });

    expect(calldata.startsWith('0x095ea7b3')).toBe(true); // approve selector
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calldata });
    expect(decoded.functionName).toBe('approve');
    expect((decoded.args as [Address, bigint])[0]).toBe(SPENDER);
    expect((decoded.args as [Address, bigint])[1]).toBe(0n);
  });

  it('forwards an idempotency key when provided, and omits it otherwise', async () => {
    let withKey: ExecuteContractCallParams | undefined;
    let withoutKey: ExecuteContractCallParams | undefined;

    await revokeApproval(req, makeExecutor({
      submit: { executionId: 'e', status: 'completed' },
      statuses: [{ executionId: 'e', status: 'completed', transactionHash: TX }],
      onExecute: (p) => { withKey = p; },
    }), { sleep: noSleep, idempotencyKey: 'revoke-weth-01' });

    await revokeApproval(req, makeExecutor({
      submit: { executionId: 'e', status: 'completed' },
      statuses: [{ executionId: 'e', status: 'completed', transactionHash: TX }],
      onExecute: (p) => { withoutKey = p; },
    }), { sleep: noSleep });

    expect(withKey?.idempotency_key).toBe('revoke-weth-01');
    expect(withoutKey && 'idempotency_key' in withoutKey).toBe(false);
  });
});

describe('revokeApproval — polling to a terminal state', () => {
  it('polls through non-terminal states until completed, then returns the receipt', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_9', status: 'pending' },
      statuses: [
        { executionId: 'exec_9', status: 'pending' },
        { executionId: 'exec_9', status: 'processing' },
        {
          executionId: 'exec_9',
          status: 'completed',
          transactionHash: TX,
          transactionLink: `https://sepolia.etherscan.io/tx/${TX}`,
          result: { success: true, sponsored: true },
        },
      ],
    });
    const sleep = vi.fn(noSleep);

    const result = await revokeApproval(req, executor, { sleep, pollIntervalMs: 1 });

    expect(result.txHash).toBe(TX);
    expect(result.executionId).toBe('exec_9');
    expect(result.runUrl).toBe('https://app.keeperhub.com/executions/exec_9');
    expect(result.transactionLink).toBe(`https://sepolia.etherscan.io/tx/${TX}`);
    expect(executor.getDirectExecutionStatus).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // slept between the three polls
  });

  it('reads the transaction hash from result.transactionHash when not at top level', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_r', status: 'completed' },
      statuses: [
        {
          executionId: 'exec_r',
          status: 'completed',
          result: { success: true, transactionHash: TX },
        },
      ],
    });

    const result = await revokeApproval(req, executor, { sleep: noSleep });
    expect(result.txHash).toBe(TX);
  });

  it('re-reads allowance and records zero before reporting success', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_verify', status: 'completed' },
      statuses: [
        { executionId: 'exec_verify', status: 'completed', transactionHash: TX },
      ],
    });

    const result = await revokeApproval(req, executor, {
      sleep: noSleep,
      verifyAllowance: async () => 0n,
    });

    expect(result.verifiedAllowance).toBe('0');
  });
});

describe('revokeApproval — failure paths (never claims success without a receipt)', () => {
  it('throws RevokeError with the run link when the execution status is failed', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_bad', status: 'pending' },
      statuses: [
        { executionId: 'exec_bad', status: 'failed', error: 'execution reverted' },
      ],
    });

    await expect(revokeApproval(req, executor, { sleep: noSleep })).rejects.toMatchObject({
      name: 'RevokeError',
      executionId: 'exec_bad',
      runUrl: 'https://app.keeperhub.com/executions/exec_bad',
    });
  });

  it('treats result.success === false as a failure even if status looks complete', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_rf', status: 'completed' },
      statuses: [
        { executionId: 'exec_rf', status: 'completed', result: { success: false }, error: 'reverted' },
      ],
    });

    await expect(revokeApproval(req, executor, { sleep: noSleep })).rejects.toBeInstanceOf(
      RevokeError,
    );
  });

  it('refuses to report success when a completed execution has no tx hash', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_nh', status: 'completed' },
      statuses: [{ executionId: 'exec_nh', status: 'completed', result: { success: true } }],
    });

    await expect(revokeApproval(req, executor, { sleep: noSleep })).rejects.toThrow(
      /without a transaction hash/,
    );
  });

  it('throws a timeout RevokeError when no terminal state is reached within maxPollAttempts', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_to', status: 'pending' },
      statuses: [{ executionId: 'exec_to', status: 'processing' }],
    });

    await expect(
      revokeApproval(req, executor, { sleep: noSleep, maxPollAttempts: 3 }),
    ).rejects.toThrow(/did not reach a terminal state after 3 polls/);
    expect(executor.getDirectExecutionStatus).toHaveBeenCalledTimes(3);
  });

  it('refuses to report success when the post-transaction allowance is still non-zero', async () => {
    const executor = makeExecutor({
      submit: { executionId: 'exec_stale', status: 'completed' },
      statuses: [
        { executionId: 'exec_stale', status: 'completed', transactionHash: TX },
      ],
    });

    await expect(
      revokeApproval(req, executor, {
        sleep: noSleep,
        verifyAllowance: async () => 123n,
      }),
    ).rejects.toThrow(/allowance is still 123/);
  });
});
