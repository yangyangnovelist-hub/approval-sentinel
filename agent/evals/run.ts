import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Address } from 'viem';
import type { Finding } from '../../scanner/src/riskScore.js';

type Expected = { revoked: number; skipped: number; failed: number; quit: boolean };
type Case = {
  id: string;
  description: string;
  findings: number;
  answers: string[];
  revokeOutcomes: Array<'success' | 'failure'>;
  expected: Expected;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const reportDir = path.join(repoRoot, 'reports', 'agent-evaluation');
const OWNER = '0xC7d92E2089BfD22539553FA8ea061cB094274dc5' as Address;
const TOKENS = [
  '0x779877A7B0D9E8603169DdbD7836e478b4624789',
  '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
] as Address[];
const SPENDERS = [
  '0x000000000000000000000000000000000000dEaD',
  '0x000000000000000000000000000000000000bEEF',
] as Address[];

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
trace.setGlobalTracerProvider(provider);
const contextManager = new AsyncLocalStorageContextManager().enable();
context.setGlobalContextManager(contextManager);

const { RevokeError } = await import('../src/revoke.js');
const { isExplicitYes, runScanAndFix } = await import('../src/harness.js');

function finding(index: number): Finding {
  return {
    token: TOKENS[index % TOKENS.length]!,
    symbol: index % 2 === 0 ? 'LINK' : 'WETH',
    spender: SPENDERS[index % SPENDERS.length]!,
    allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    unlimited: true,
    ageDays: 120,
    score: 85,
    reasons: ['Unlimited allowance', 'Unknown spender'],
  };
}

function serializeSpan(span: ReadableSpan) {
  return {
    trace_id: span.spanContext().traceId,
    span_id: span.spanContext().spanId,
    parent_span_id: span.parentSpanContext?.spanId ?? null,
    name: span.name,
    status: span.status,
    duration_ms: Number(span.duration[0]) * 1_000 + Number(span.duration[1]) / 1_000_000,
    attributes: span.attributes,
    events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
  };
}

const cases = JSON.parse(await readFile(path.join(here, 'safety-regression.json'), 'utf8')) as Case[];
const caseResults: Array<Record<string, unknown>> = [];
let unauthorizedWrites = 0;
let totalWrites = 0;
let falseSuccesses = 0;

for (const testCase of cases) {
  const answers = [...testCase.answers];
  const providedAnswers: string[] = [];
  const outcomes = [...testCase.revokeOutcomes];
  let writes = 0;
  const summary = await runScanAndFix(
    { address: OWNER, chain: 'sepolia' },
    {
      scan: async () => Array.from({ length: testCase.findings }, (_, index) => finding(index)),
      revoke: async (request) => {
        const authorizingAnswer = providedAnswers.at(-1) ?? '';
        if (!isExplicitYes(authorizingAnswer)) unauthorizedWrites += 1;
        writes += 1;
        totalWrites += 1;
        const outcome = outcomes.shift();
        if (outcome === 'failure') {
          throw new RevokeError('simulated reverted execution', {
            executionId: `eval-${testCase.id}`,
            runUrl: `https://app.keeperhub.com/executions/eval-${testCase.id}`,
          });
        }
        return {
          txHash: `0x${'ab'.repeat(32)}`,
          runUrl: `https://app.keeperhub.com/executions/eval-${testCase.id}`,
          executionId: `eval-${testCase.id}`,
          calldata: '0x095ea7b3',
          verifiedAllowance: '0',
          requestedTarget: request,
        };
      },
      io: {
        write: () => undefined,
        ask: async () => {
          const answer = answers.shift();
          if (answer === undefined) throw new Error(`missing answer in ${testCase.id}`);
          providedAnswers.push(answer);
          return answer;
        },
      },
    },
  );

  const actual: Expected = {
    revoked: summary.revoked.length,
    skipped: summary.skipped.length,
    failed: summary.failed.length,
    quit: summary.quit,
  };
  if (summary.revoked.some((item) => item.result.verifiedAllowance !== '0')) falseSuccesses += 1;
  const passed = JSON.stringify(actual) === JSON.stringify(testCase.expected);
  caseResults.push({
    id: testCase.id,
    description: testCase.description,
    passed,
    writes,
    answers: testCase.answers,
    expected: testCase.expected,
    actual,
  });
}

await provider.forceFlush();
const spans = exporter.getFinishedSpans().map(serializeSpan);
const passedCases = caseResults.filter((item) => item.passed).length;
const confirmationAdherence = totalWrites === 0 ? 1 : (totalWrites - unauthorizedWrites) / totalWrites;
const report = {
  suite: 'approval-sentinel-agent-safety-v1',
  generated_at: new Date().toISOString(),
  dataset_cases: cases.length,
  passed_cases: passedCases,
  failed_cases: cases.length - passedCases,
  metrics: {
    task_pass_rate: passedCases / cases.length,
    confirmation_adherence: confirmationAdherence,
    unauthorized_writes: unauthorizedWrites,
    total_state_changing_tool_calls: totalWrites,
    false_successes: falseSuccesses,
    trace_span_count: spans.length,
  },
  failure_taxonomy: {
    consent_bypass: unauthorizedWrites,
    false_success: falseSuccesses,
    policy_regression: cases.length - passedCases,
    simulated_tool_failure_cases: cases.filter((item) => item.revokeOutcomes.includes('failure')).length,
  },
  cases: caseResults,
};

await mkdir(reportDir, { recursive: true });
await writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(
  path.join(reportDir, 'traces.jsonl'),
  `${spans.map((span) => JSON.stringify(span)).join('\n')}\n`,
);
const markdown = `# Agent safety evaluation\n\n` +
  `- Cases: ${passedCases}/${cases.length} passed\n` +
  `- Confirmation adherence: ${(confirmationAdherence * 100).toFixed(1)}%\n` +
  `- Unauthorized writes: ${unauthorizedWrites}\n` +
  `- False successes: ${falseSuccesses}\n` +
  `- State-changing tool calls: ${totalWrites}\n` +
  `- OpenTelemetry spans: ${spans.length}\n\n` +
  `The suite is deterministic and does not use an LLM judge. It measures code-enforced safety and orchestration behavior; it does not claim natural-language quality.\n`;
await writeFile(path.join(reportDir, 'summary.md'), markdown);

console.log(JSON.stringify(report, null, 2));
await provider.shutdown();
contextManager.disable();
if (passedCases !== cases.length || unauthorizedWrites !== 0 || falseSuccesses !== 0) process.exitCode = 1;
