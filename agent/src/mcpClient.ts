/**
 * Minimal KeeperHub MCP client over the Streamable-HTTP transport.
 *
 * The transport requires:
 *   1. `initialize` (server replies with an `Mcp-Session-Id` header),
 *   2. a `notifications/initialized` notification carrying that session id,
 *   3. every later request carrying the same `Mcp-Session-Id` header.
 * Responses may come back as plain JSON or as SSE frames (`data: {...}`).
 */

export interface ExecuteContractCallParams {
  contract_address: string;
  chain_id: string;
  function_name: string;
  /** JSON **string** array of args, e.g. '["0x...","0"]'. */
  function_args?: string;
  /** Contract ABI as a JSON **string**. Omit for verified contracts. */
  abi?: string;
  idempotency_key?: string;
}

export interface ExecuteResult {
  executionId: string;
  status: string;
}

export interface ExecutionStatusResult {
  success?: boolean;
  sponsored?: boolean;
  transactionHash?: string;
  transactionLink?: string;
  [k: string]: unknown;
}

export interface ExecutionStatus {
  executionId: string;
  status: string;
  transactionHash?: string | null;
  transactionLink?: string | null;
  error?: string | null;
  result?: ExecutionStatusResult | null;
  [k: string]: unknown;
}

/**
 * The narrow slice of the MCP surface the revoke executor depends on.
 * Unit tests implement this directly; `KeeperHubMcpClient` satisfies it at runtime.
 */
export interface RevokeExecutor {
  executeContractCall(params: ExecuteContractCallParams): Promise<ExecuteResult>;
  getDirectExecutionStatus(executionId: string): Promise<ExecutionStatus>;
}

const DEFAULT_URL = 'https://app.keeperhub.com/mcp';

type FetchImpl = typeof fetch;

export interface KeeperHubMcpClientOptions {
  apiKey: string;
  url?: string;
  fetchImpl?: FetchImpl;
}

/** Parse a plain-JSON or SSE-framed (`data: {...}`) response body. */
export function parseMcpBody(text: string): unknown {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  const payload = dataLines.length > 0 ? dataLines.join('') : text.trim();
  return JSON.parse(payload);
}

export class KeeperHubMcpClient implements RevokeExecutor {
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetchImpl: FetchImpl;
  private sessionId: string | undefined;

  constructor(opts: KeeperHubMcpClientOptions) {
    this.apiKey = opts.apiKey;
    this.url = opts.url ?? DEFAULT_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'approval-sentinel-agent', version: '0.1.0' },
        },
      }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (!sid) throw new Error('KeeperHub MCP initialize returned no Mcp-Session-Id header');
    this.sessionId = sid;
    await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }

  /** Call any KeeperHub MCP tool and return its parsed JSON payload (content[].text unwrapped). */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureSession();
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const body = parseMcpBody(await res.text()) as {
      error?: { message?: string } | string;
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    };
    if (body.error) {
      const msg = typeof body.error === 'string' ? body.error : (body.error.message ?? 'unknown');
      throw new Error(`KeeperHub MCP ${name} error: ${msg}`);
    }
    const content = body.result?.content ?? [];
    const textPart = content.find((c) => c.type === 'text' && typeof c.text === 'string');
    if (!textPart?.text) {
      throw new Error(`KeeperHub MCP ${name} returned no text content`);
    }
    if (body.result?.isError) {
      throw new Error(`KeeperHub MCP ${name} tool error: ${textPart.text}`);
    }
    // Most tools return JSON; a few (e.g. tools_documentation) return plain text.
    try {
      return JSON.parse(textPart.text) as T;
    } catch {
      return textPart.text as unknown as T;
    }
  }

  executeContractCall(params: ExecuteContractCallParams): Promise<ExecuteResult> {
    return this.callTool<ExecuteResult>('execute_contract_call', { ...params });
  }

  getDirectExecutionStatus(executionId: string): Promise<ExecutionStatus> {
    return this.callTool<ExecutionStatus>('get_direct_execution_status', {
      execution_id: executionId,
    });
  }
}
