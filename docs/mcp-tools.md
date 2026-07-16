# KeeperHub MCP tool inventory

Source of truth for the agent layer. Captured via JSON-RPC `tools/list` against
`https://app.keeperhub.com/mcp` (Bearer `KH_API_KEY`), server `keeperhub v1.2.0`, 2026-07-16.
31 tools. Full schemas retrievable any time with the curl snippet in `bounty/onboarding-notes.md`
plus `{"method":"tools/list"}`; condensed here to name + purpose + key params.

## Direct execution (agent hot path)

- **`execute_transfer`** — Transfer native tokens (ETH, MATIC) or ERC20 tokens from your wallet to a recipient address.
  - Params ( * = required): `chain_id`*, `to_address`*, `amount`*, `token_address`, `idempotency_key`
- **`execute_contract_call`** — Call a smart contract function.
  - Params ( * = required): `contract_address`*, `chain_id`*, `function_name`*, `function_args`, `abi`, `value`, `gas_limit_multiplier`, `priority_fee_gwei`, `idempotency_key`
- **`execute_check_and_execute`** — Read a contract value, evaluate a condition, and execute an action if the condition is met.
  - Params ( * = required): `contract_address`*, `chain_id`*, `function_name`*, `function_args`, `abi`, `condition`*, `action`*, `idempotency_key`
- **`get_direct_execution_status`** — Get the status of a direct execution (transfer or contract call).
  - Params ( * = required): `execution_id`*

## Workflows

- **`list_workflows`** — List all workflows for the authenticated organization.
  - Params ( * = required): `projectId`, `tagId`
- **`get_workflow`** — Get a single workflow by ID, including its nodes, edges, and configuration.
  - Params ( * = required): `workflowId`*
- **`create_workflow`** — Create a new workflow with nodes and edges.
  - Params ( * = required): `name`*, `description`, `nodes`*, `edges`*, `enabled`, `projectId`, `tagId`, `idempotency_key`
- **`update_workflow`** — Update an existing workflow's name, description, nodes, edges, project/tag assignment, or enabled state.
  - Params ( * = required): `workflowId`*, `name`, `description`, `nodes`, `edges`, `enabled`, `projectId`, `tagId`
- **`delete_workflow`** — Delete a workflow by ID.
  - Params ( * = required): `workflowId`*
- **`execute_workflow`** — Trigger a manual execution of a workflow.
  - Params ( * = required): `workflowId`*, `input`, `idempotency_key`
- **`get_execution`** — Get combined status and step-by-step logs for a workflow execution.
  - Params ( * = required): `executionId`*, `includeData`, `nodeIds`, `truncateData`
- **`ai_generate_workflow`** — Generate a complete workflow from a natural language description using AI.
  - Params ( * = required): `prompt`*, `context`
- **`validate_workflow`** — Validate a workflow's structural and Web3-specific correctness before calling create_workflow or executing it.
  - Params ( * = required): `workflowId`*, `deepCheck`
- **`prepare_test_pin_data`** — Return the JSON Schema each node in a workflow expects as pin data, so an agent can construct valid test inputs.
  - Params ( * = required): `workflowId`*

## Marketplace

- **`search_workflows`** — Search KeeperHub listed workflows callable by external agents.
  - Params ( * = required): `query`, `category`, `chain`, `sort`, `workflowType`
- **`call_workflow`** — Invoke a listed KeeperHub workflow.
  - Params ( * = required): `slug`*, `inputs`*
- **`list_workflow`** — Publish a workflow to the KeeperHub marketplace catalog.
  - Params ( * = required): `workflowId`*, `slug`, `category`, `chain`, `inputSchema`, `outputMapping`, `workflowType`
- **`unlist_workflow`** — Remove a workflow from the marketplace catalog.
  - Params ( * = required): `workflowId`*
- **`update_workflow_listing`** — Edit listing metadata for a workflow (description, tags, category, chain, schemas).
  - Params ( * = required): `workflowId`*, `category`, `chain`, `inputSchema`, `outputMapping`, `workflowType`, `priceUsdcPerCall`
- **`get_workflow_listing`** — Read full listing metadata for a workflow by its public slug.
  - Params ( * = required): `slug`*

## Templates / plugins / integrations

- **`search_templates`** — Search for pre-built workflow templates that can be deployed and customized.
  - Params ( * = required): `query`, `category`
- **`get_template`** — [DEPRECATED — will be removed in v1.13.
  - Params ( * = required): `templateId`*
- **`deploy_template`** — Clone a public template workflow into the organization as a new workflow.
  - Params ( * = required): `templateId`*, `name`
- **`search_plugins`** — [DEPRECATED — will be removed in v1.13.
  - Params ( * = required): `category`*
- **`get_plugin`** — Get schema details for a specific plugin or integration type.
  - Params ( * = required): `pluginType`*
- **`list_action_schemas`** — List all available action schemas, triggers, and supported chains.
  - Params ( * = required): `category`, `includeChains`
- **`list_integrations`** — List all configured integrations (credentials) for the organization.
  - Params ( * = required): (none)
- **`get_wallet_integration`** — Get details for a specific wallet integration.
  - Params ( * = required): `integrationId`*
- **`search_protocol_actions`** — Search for available protocol actions across all supported DeFi protocols (Aave, Morpho, Chronicle, Chainlink, Uniswap, Compound, Lido, etc.).
  - Params ( * = required): `query`, `protocol`
- **`execute_protocol_action`** — Execute a DeFi protocol action directly.
  - Params ( * = required): `actionType`*, `params`*

## Meta

- **`tools_documentation`** — Get documentation on how to use the KeeperHub MCP tools, including examples and best practices for workflow creation.
  - Params ( * = required): (none)

## Notes for the agent layer

- Revocation path: `execute_contract_call` with `function_name: "approve"`, `function_args: '["<spender>", "0"]'`, `chain_id: "11155111"` (Sepolia) / `"1"` (mainnet). ABI auto-fetched for verified contracts; pass `abi` explicitly for unverified ones.
- Poll `get_direct_execution_status` (NOT `get_execution` — that one is for workflow executions) with the `execution_id` returned by the execute_* tools until status is terminal; response carries the tx hash.
- `function_args` and `abi` are JSON **strings**, not arrays/objects.
- `idempotency_key` on all execute_* tools: same key + same args within 24h replays the original result; same key + different args → 409.
- View/pure functions via `execute_contract_call` return the value directly (no execution id, no wallet needed).
- Wallet: org Turnkey wallet is used implicitly for writes; `list_integrations` / `get_wallet_integration` expose its id/address.
