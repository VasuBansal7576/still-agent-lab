#!/usr/bin/env node
import { generatePersonas } from '../server/personas.mjs';
import { runTrials } from '../server/trials.mjs';
import { createExternalTrialAgent, DEFAULT_TRIAL_POLICY } from '../server/trial-agent.mjs';
import { normalizeRefundPolicy, refundPolicyInstruction } from '../server/refund-policy.mjs';
import { createHash } from 'node:crypto';
import { runPortableShadow } from '../server/portable-shadow.mjs';
import { runMcpPortable } from '../server/mcp-portable-shadow.mjs';
import { createMcpTrialAgent } from '../server/mcp-trial-agent.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `Usage: still test [options]
       still regression --file PATH (--agent-url URL | --agent-module PATH)

Run scripted, local HTTP or local MCP hosts against the deterministic PayPal mock.
  --personas N       Number of synthetic personas (default 1000)
  --trials N         Trials per persona (default 5)
  --concurrency N    Concurrent trials, 1-500 (default 20)
  --agent NAME       safe, buggy, external or mcp (default safe)
  --agent-url URL    Loopback HTTP endpoint for external agent
  --agent-module PATH  Trusted local MCP host module when agent is mcp
  --agent-protocol N  External agent protocol, 2 or 3 (default 2)
  --seed VALUE       Reproducible persona seed (default still)
  --mock-profile VALUE  completed or sandbox-test-card (default completed)
  --mock-refund-outcome VALUE  completed, pending-echeck or refund-not-allowed (default completed)
  --max-refund AMOUNT  Maximum per refund call, with two decimals (requires --refund-currency)
  --max-order-refund AMOUNT  Maximum total refunds per order, with two decimals (requires --refund-currency)
  --refund-currency CODE  Three-letter uppercase currency (requires at least one limit)
  --min-pass-all N   Minimum pass^N fraction, 0-1 (default 1)
  --json             Print the summary as JSON
  --help             Show this help

Exit 0 when the threshold is met with no critical failures or unverified trials.
Exit 1 when the gate fails; exit 2 on invalid input or execution error.`;

function parse(args) {
  if (args.length === 0 || args.includes('--help')) return null;
  if (args.shift() !== 'test') throw new Error('Expected the test command.');
  const options = { personas: 1000, trials: 5, concurrency: 20, agent: 'safe', agentProtocol: '2', seed: 'still', mockProfile: 'completed', mockRefundOutcome: 'completed', minPassAll: 1, json: false };
  const names = { '--personas': 'personas', '--trials': 'trials', '--concurrency': 'concurrency', '--agent': 'agent', '--agent-url': 'endpoint', '--agent-module': 'agentModule', '--agent-protocol': 'agentProtocol', '--seed': 'seed', '--mock-profile': 'mockProfile', '--mock-refund-outcome': 'mockRefundOutcome', '--max-refund': 'maxRefund', '--max-order-refund': 'maxOrderRefund', '--refund-currency': 'refundCurrency', '--min-pass-all': 'minPassAll' };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--json') { options.json = true; continue; }
    const key = names[flag];
    if (!key || !args.length || args[0].startsWith('--')) throw new Error(`Invalid option or missing value: ${flag}`);
    const value = args.shift();
    if (['personas', 'trials', 'concurrency'].includes(key)) {
      if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a positive integer.`);
      options[key] = Number(value);
    } else if (key === 'minPassAll') {
      if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) throw new Error(`${flag} must be a fraction from 0 to 1.`);
      options[key] = Number(value);
    } else options[key] = value;
  }
  if (!Number.isSafeInteger(options.personas) || options.personas < 1 || options.personas > 100000) throw new Error('--personas must be from 1 to 100000.');
  if (!Number.isSafeInteger(options.trials) || options.trials < 1 || options.trials > 100) throw new Error('--trials must be from 1 to 100.');
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 500) throw new Error('--concurrency must be from 1 to 500.');
  if (!['safe', 'buggy', 'external', 'mcp'].includes(options.agent)) throw new Error('--agent must be safe, buggy, external or mcp.');
  if ((options.agent === 'mcp') !== (options.agentModule !== undefined)) throw new Error('--agent mcp requires --agent-module, which is only valid for mcp.');
  if (options.endpoint !== undefined && options.agent !== 'external') throw new Error('--agent-url is only valid for external agents.');
  if (!['2', '3'].includes(options.agentProtocol)) throw new Error('--agent-protocol must be 2 or 3.');
  if (options.agentProtocol === '3' && options.agent !== 'external') throw new Error('--agent-protocol 3 requires --agent external.');
  if (!['completed', 'sandbox-test-card'].includes(options.mockProfile)) throw new Error('--mock-profile must be completed or sandbox-test-card.');
  if (!['completed', 'pending-echeck', 'refund-not-allowed'].includes(options.mockRefundOutcome)) throw new Error('--mock-refund-outcome must be completed, pending-echeck or refund-not-allowed.');
  if (options.mockProfile !== 'completed' && options.mockRefundOutcome !== 'completed') throw new Error('Choose either --mock-profile or --mock-refund-outcome.');
  const hasLimit = options.maxRefund !== undefined || options.maxOrderRefund !== undefined;
  if (hasLimit !== (options.refundCurrency !== undefined)) throw new Error('Provide --refund-currency together with at least one refund limit.');
  options.structuredPolicy = !hasLimit ? null : normalizeRefundPolicy({ currency: options.refundCurrency, ...(options.maxRefund !== undefined ? { maxPerRefund: options.maxRefund } : {}), ...(options.maxOrderRefund !== undefined ? { maxPerOrder: options.maxOrderRefund } : {}) });
  return options;
}

try {
  const args = process.argv.slice(2);
  if (args[0] === 'regression') {
    args.shift();
    const options = {};
    while (args.length) {
      const flag = args.shift();
      if (!['--file', '--agent-url', '--agent-module'].includes(flag) || !args.length || args[0].startsWith('--') || options[flag]) throw new Error(`Invalid regression option: ${flag}`);
      options[flag] = args.shift();
    }
    if (!options['--file'] || Boolean(options['--agent-url']) === Boolean(options['--agent-module'])) throw new Error('Regression requires --file and exactly one of --agent-url or --agent-module.');
    const result = options['--agent-module'] ? await runMcpPortable({ path: options['--file'], agentModule: options['--agent-module'] }) : await runPortableShadow({ path: options['--file'], endpoint: options['--agent-url'] });
    console.log(JSON.stringify(result, null, 2));
    console.log('Deterministic mock only. The agent is not authenticated. Trusted host code runs separately.');
    process.exitCode = result.status === 'matched' ? 0 : 1;
  } else {
  const options = parse(args);
  if (!options) { console.log(usage); process.exitCode = 0; }
  else {
    const personas = generatePersonas({ count: options.personas, seed: options.seed });
    for (const persona of personas) persona.scenario.mockProfile = options.mockProfile;
    if (options.mockRefundOutcome !== 'completed') for (const persona of personas) persona.scenario.mockRefundOutcome = options.mockRefundOutcome;
    const policy = `${DEFAULT_TRIAL_POLICY}${options.structuredPolicy ? `\n${refundPolicyInstruction(options.structuredPolicy)}` : ''}`;
    const host = options.agent === 'mcp' ? await import(pathToFileURL(resolve(options.agentModule)).href) : null;
    const agent = host ? createMcpTrialAgent({ sdk: host.sdk, toolkit: host.toolkit, runAgent: host.runAgent, policy }) : options.agent === 'external' ? createExternalTrialAgent({ endpoint: options.endpoint, policy, version: Number(options.agentProtocol) }) : options.agent;
    const agentId = options.agent === 'external' ? `local-${createHash('sha256').update(options.endpoint).digest('hex').slice(0, 24)}` : host ? `mcp-local-${createHash('sha256').update(resolve(options.agentModule)).digest('hex').slice(0, 24)}` : undefined;
    const run = await runTrials({ personas, trials: options.trials, concurrency: options.concurrency, agent, agentId, structuredPolicy: options.structuredPolicy });
    const criticalFailures = run.failureClusters.reduce((sum, cluster) => sum + cluster.count, 0);
    const passed = run.passAllTrials >= options.minPassAll && criticalFailures === 0 && run.counts.unverified === 0;
    const summary = {
      agent: run.evaluatedAgentId, agentProtocol: options.agent === 'external' ? Number(options.agentProtocol) : null, paymentEnvironment: 'deterministic-mock', mockProfile: options.mockProfile, mockRefundOutcome: options.mockProfile === 'sandbox-test-card' ? 'profile-managed' : options.mockRefundOutcome, structuredPolicy: run.structuredPolicy ?? null,
      sandboxReplay: run.sandboxReplay, personas: run.personaCount, trials: run.trials,
      counts: run.counts, passAt1: run.passAt1, passAllTrials: run.passAllTrials,
      minPassAll: options.minPassAll, criticalFailures, failureClusters: run.failureClusters.map(({ id, label, count }) => ({ id, label, count })), gate: passed ? 'pass' : 'fail'
    };
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else {
      const pct = n => `${(n * 100).toFixed(1)}%`;
      console.log(`Still ${summary.gate.toUpperCase()} | ${summary.agent} | deterministic mock`);
      if (summary.agentProtocol) console.log(`External agent protocol: v${summary.agentProtocol}.`);
      if (summary.structuredPolicy) {
        const p = summary.structuredPolicy;
        console.log(`Checked store limits: ${[p.maxPerRefund && `${p.maxPerRefund} ${p.currency} per refund call`, p.maxPerOrder && `${p.maxPerOrder} ${p.currency} total per order`].filter(Boolean).join(' · ')}.`);
      }
      if (options.mockProfile === 'sandbox-test-card') console.log('Mock profile: sandbox-test-card (modeled observations, not a prediction of PayPal outcomes).');
      if (options.mockRefundOutcome !== 'completed') console.log(`Mock refund outcome: ${options.mockRefundOutcome} (explicit scenario; sandbox funding not predicted).`);
      console.log(`${summary.personas} personas × ${summary.trials} trials: ${summary.counts.pass} passed, ${summary.counts.fail} failed, ${summary.counts.unverified} unverified`);
      console.log(`pass@1 ${pct(summary.passAt1)} | pass^${summary.trials} ${pct(summary.passAllTrials)} | required ${pct(summary.minPassAll)}`);
      console.log(`Critical rule failures: ${summary.criticalFailures} (one trial may appear in multiple clusters)`);
      for (const cluster of summary.failureClusters) console.log(`  ${cluster.count} ${cluster.label} [${cluster.id}]`);
      console.log('Sandbox replay: unverified; Still routed trial tools to the mock. Trusted host code runs separately.');
    }
    process.exitCode = passed ? 0 : 1;
  }
  }
} catch (error) {
  console.error(`still: ${error.message}`);
  process.exitCode = 2;
}
