// Creates the two ApprovalSentinel workflows on KeeperHub via the MCP
// create_workflow tool, validates them, and writes the persisted definitions +
// IDs into workflows/definitions/.
//
// Plan note: on the free plan the notification actions the design calls for
// (webhook/send-webhook, HTTP Request, code/run-code, Discord/Telegram) all
// return 402 upgrade_required. web3 read actions are free, so these creatable
// versions wire the Schedule and Event triggers to a real on-chain
// allowance() read of the demo approval. The pro-gated notify leg is documented
// in docs/workflows.md and kept in workflows/definitions/*-with-notify.json.
//
//   node workflows/scripts/create-workflows.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeClient } from './kh-mcp.mjs';

const OWNER = '0xC7d92E2089BfD22539553FA8ea061cB094274dc5';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const LINK_SEPOLIA = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
const SEPOLIA = '11155111';

const ALLOWANCE_ABI = JSON.stringify([
  {
    constant: true,
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]);

const APPROVAL_ABI = JSON.stringify([
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'spender', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Approval',
    type: 'event',
  },
]);

function readAllowanceNode(id, label) {
  return {
    id,
    type: 'action',
    data: {
      type: 'action',
      label,
      description: 'Read the current on-chain allowance(owner, 0xdEaD) for the demo approval',
      status: 'idle',
      config: {
        actionType: 'web3/read-contract',
        network: SEPOLIA,
        contractAddress: LINK_SEPOLIA,
        abi: ALLOWANCE_ABI,
        abiFunction: 'allowance',
        functionArgs: JSON.stringify([OWNER, DEAD]),
      },
    },
  };
}

const rescan = {
  name: 'sentinel-rescan',
  description:
    'Weekly scheduled re-scan of the watched wallet. Reads the live on-chain ' +
    'allowance of the demo LINK approval on Sepolia. In the full design a ' +
    'notification action follows this read (requires KeeperHub Pro). ' +
    'ApprovalSentinel security monitor (Task 2.4).',
  enabled: false,
  nodes: [
    {
      id: 'schedule-1',
      type: 'trigger',
      data: {
        type: 'trigger',
        label: 'Weekly Monday 09:00 UTC',
        description: 'Fires the re-scan once a week',
        status: 'idle',
        config: { triggerType: 'Schedule', scheduleCron: '0 9 * * 1', scheduleTimezone: 'UTC' },
      },
    },
    readAllowanceNode('read-allowance', 'Re-scan allowance'),
  ],
  edges: [{ id: 'e1', type: 'default', source: 'schedule-1', target: 'read-allowance' }],
};

const alert = {
  name: 'sentinel-alert',
  description:
    'Real-time monitor: fires whenever a new ERC-20 Approval is granted on the ' +
    'watched LINK token (Sepolia), then re-reads the resulting allowance. In the ' +
    'full design a notification action follows (requires KeeperHub Pro). ' +
    'ApprovalSentinel security monitor (Task 2.4).',
  enabled: false,
  nodes: [
    {
      id: 'approval-event',
      type: 'trigger',
      data: {
        type: 'trigger',
        label: 'LINK Approval (Sepolia)',
        description: 'Listens for Approval events on the LINK token',
        status: 'idle',
        config: {
          triggerType: 'Event',
          network: SEPOLIA,
          contractAddress: LINK_SEPOLIA,
          contractABI: APPROVAL_ABI,
          eventName: 'Approval',
        },
      },
    },
    readAllowanceNode('read-allowance', 'Confirm new allowance'),
  ],
  edges: [{ id: 'e1', type: 'default', source: 'approval-event', target: 'read-allowance' }],
};

const defsDir = fileURLToPath(new URL('../definitions/', import.meta.url));

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createOne(client, def) {
  console.log(`\n=== ${def.name} ===`);
  const created = await client.call('create_workflow', {
    name: def.name,
    description: def.description,
    nodes: def.nodes,
    edges: def.edges,
    enabled: def.enabled,
    idempotency_key: `approval-sentinel-${def.name}-web3-v1`,
  });
  console.log('create_workflow:', created.isError ? 'ERROR' : 'ok');
  console.log(created.text.slice(0, 500));

  let workflowId;
  const parsed = safeParse(created.text);
  if (parsed && typeof parsed === 'object') workflowId = parsed.id ?? parsed.workflowId;

  if (workflowId) {
    const val = await client.call('validate_workflow', { workflowId, deepCheck: true });
    console.log('validate_workflow:', val.isError ? 'ERROR' : 'ok');
    console.log(val.text.slice(0, 500));
  }

  writeFileSync(
    `${defsDir}${def.name}.json`,
    JSON.stringify({ definition: def, createResult: parsed, workflowId }, null, 2),
  );
  return { name: def.name, workflowId, createError: created.isError };
}

const client = makeClient();
const results = [];
for (const def of [rescan, alert]) {
  try {
    results.push(await createOne(client, def));
  } catch (e) {
    console.error(`FAILED ${def.name}:`, e.message);
    results.push({ name: def.name, error: e.message });
  }
}
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(results, null, 2));
