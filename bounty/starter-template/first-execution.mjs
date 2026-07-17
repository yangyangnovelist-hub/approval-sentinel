// create-keeperhub-agent: first onchain execution via the raw KeeperHub MCP HTTP API.
// Sends a harmless approve(0xdEaD, 0) on Sepolia WETH (sets an allowance to zero),
// then polls until it has a real transaction hash. No dependencies, Node 20+.
//   KH_API_KEY=kh_... node first-execution.mjs   (or put the key in ./.env)
import { readFileSync } from 'node:fs';

const MCP = 'https://app.keeperhub.com/mcp';
const KEY = process.env.KH_API_KEY
  ?? readFileSync(new URL('./.env', import.meta.url), 'utf8').match(/^KH_API_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) throw new Error('Set KH_API_KEY (env or ./.env)');

let sessionId;
const headers = () => ({
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}), // required on EVERY call after initialize
});
const parse = (t) => JSON.parse(t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') || t);
const post = async (body) => {
  const res = await fetch(MCP, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  sessionId ??= res.headers.get('mcp-session-id'); // the session id lives in a RESPONSE HEADER
  const text = await res.text();
  return text ? parse(text) : {};
};
const call = async (name, args) => {
  const r = await post({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
  if (r.error || r.result?.isError) throw new Error(JSON.stringify(r.error ?? r.result));
  return JSON.parse(r.result.content.find((c) => c.type === 'text').text);
};

// Handshake: initialize -> notifications/initialized (skip either and every later call fails).
await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'create-keeperhub-agent', version: '0.1.0' } } });
await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

const exec = await call('execute_contract_call', {
  contract_address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia WETH (verified: ABI auto-fetched)
  chain_id: '11155111',
  function_name: 'approve',
  function_args: '["0x000000000000000000000000000000000000dEaD","0"]', // JSON *string*, not an array
  idempotency_key: `first-execution-${new Date().toISOString().slice(0, 10)}`, // retry-safe for 24h
});
console.log('executionId:', exec.executionId, '| submitted, polling for the tx hash...');

// The execute response has NO tx hash, even when already "completed" — always poll to a terminal state.
for (let i = 0; i < 30; i++) {
  const s = await call('get_direct_execution_status', { execution_id: exec.executionId });
  if (['failed', 'error', 'reverted', 'cancelled'].includes(s.status)) throw new Error(`execution ${s.status}: ${JSON.stringify(s)}`);
  if (['completed', 'success', 'confirmed'].includes(s.status)) {
    console.log('status:', s.status, '\ntx:', s.transactionHash, '\nlink:', s.transactionLink ?? `https://sepolia.etherscan.io/tx/${s.transactionHash}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
throw new Error('timed out waiting for a terminal execution status');
