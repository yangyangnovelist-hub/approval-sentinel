// Minimal KeeperHub MCP (Streamable-HTTP) client for workflow authoring.
//
// Reusable helper: reads KH_API_KEY from the repo-root .env (never prints it),
// runs the initialize / notifications/initialized handshake, and exposes
// callTool(name, args) returning the raw text content of the tool result.
//
// Usage:  node workflows/scripts/kh-mcp.mjs <tool_name> '<json-args>'
//   e.g.  node workflows/scripts/kh-mcp.mjs tools_documentation '{}'
//         node workflows/scripts/kh-mcp.mjs list_action_schemas '{"includeChains":true}'
//
// This is intentionally dependency-free (no tsx / build step) so it can drive
// the live MCP without touching the agent package that a parallel task owns.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_MCP = 'https://app.keeperhub.com/mcp';

function apiKey() {
  if (process.env.KH_API_KEY) return process.env.KH_API_KEY;
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  const raw = readFileSync(envPath, 'utf8');
  const m = raw.match(/^KH_API_KEY=(.+)$/m);
  if (!m) throw new Error('KH_API_KEY not found in env or .env');
  return m[1].trim();
}

function parseBody(text) {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  const payload = dataLines.length > 0 ? dataLines.join('') : text.trim();
  return JSON.parse(payload);
}

export class KhMcp {
  constructor(key) {
    this.key = key;
    this.sessionId = undefined;
  }
  headers() {
    const h = {
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }
  async init() {
    if (this.sessionId) return;
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'approval-sentinel-workflows', version: '0.1.0' },
        },
      }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (!sid) throw new Error('initialize returned no Mcp-Session-Id');
    this.sessionId = sid;
    await fetch(URL_MCP, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }
  /** Returns { text, isError, raw } for a tool call. */
  async call(name, args = {}) {
    await this.init();
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const body = parseBody(await res.text());
    if (body.error) {
      const msg = typeof body.error === 'string' ? body.error : (body.error.message ?? 'unknown');
      return { text: msg, isError: true, raw: body };
    }
    const content = body.result?.content ?? [];
    const textPart = content.find((c) => c.type === 'text' && typeof c.text === 'string');
    return {
      text: textPart?.text ?? JSON.stringify(body.result),
      isError: Boolean(body.result?.isError),
      raw: body,
    };
  }
}

export function makeClient() {
  return new KhMcp(apiKey());
}

// CLI entry
const isDirect = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirect) {
  const [, , tool, argsJson] = process.argv;
  if (!tool) {
    console.error('usage: node kh-mcp.mjs <tool_name> [json-args]');
    process.exit(1);
  }
  const args = argsJson ? JSON.parse(argsJson) : {};
  const client = makeClient();
  const out = await client.call(tool, args);
  if (out.isError) console.error('[tool error]');
  console.log(out.text);
}
