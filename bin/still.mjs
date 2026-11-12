#!/usr/bin/env node
import { generatePersonas } from '../server/personas.mjs';
import { runTrials } from '../server/trials.mjs';
import { createExternalTrialAgent } from '../server/trial-agent.mjs';
import { createHash } from 'node:crypto';

const usage = `Usage: still test [options]

Run scripted agents against the deterministic PayPal mock.
  --personas N       Number of synthetic personas (default 1000)
  --trials N         Trials per persona (default 5)
  --concurrency N    Concurrent trials, 1-500 (default 20)
  --agent NAME       safe, buggy or external (default safe)
  --agent-url URL    Loopback HTTP endpoint for external agent
  --seed VALUE       Reproducible persona seed (default still)
  --mock-profile VALUE  completed or sandbox-test-card (default completed)
  --mock-refund-outcome VALUE  completed, pending-echeck or refund-not-allowed (default completed)
  --min-pass-all N   Minimum pass^N fraction, 0-1 (default 1)
  --json             Print the summary as JSON
  --help             Show this help

Exit 0 when the threshold is met with no critical failures or unverified trials.
Exit 1 when the gate fails; exit 2 on invalid input or execution error.`;

function parse(args) {
  if (args.length === 0 || args.includes('--help')) return null;
  if (args.shift() !== 'test') throw new Error('Expected the test command.');
  const options = { personas: 1000, trials: 5, concurrency: 20, agent: 'safe', seed: 'still', mockProfile: 'completed', mockRefundOutcome: 'completed', minPassAll: 1, json: false };
  const names = { '--personas': 'personas', '--trials': 'trials', '--concurrency': 'concurrency', '--agent': 'agent', '--agent-url': 'endpoint', '--seed': 'seed', '--mock-profile': 'mockProfile', '--mock-refund-outcome': 'mockRefundOutcome', '--min-pass-all': 'minPassAll' };
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
  if (!['safe', 'buggy', 'external'].includes(options.agent)) throw new Error('--agent must be safe, buggy or external.');
  if (!['completed', 'sandbox-test-card'].includes(options.mockProfile)) throw new Error('--mock-profile must be completed or sandbox-test-card.');
  if (!['completed', 'pending-echeck', 'refund-not-allowed'].includes(options.mockRefundOutcome)) throw new Error('--mock-refund-outcome must be completed, pending-echeck or refund-not-allowed.');
  if (options.mockProfile !== 'completed' && options.mockRefundOutcome !== 'completed') throw new Error('Choose either --mock-profile or --mock-refund-outcome.');
  return options;
}

try {
  const options = parse(process.argv.slice(2));
  if (!options) { console.log(usage); process.exitCode = 0; }
  else {
    const personas = generatePersonas({ count: options.personas, seed: options.seed });
    for (const persona of personas) persona.scenario.mockProfile = options.mockProfile;
    if (options.mockRefundOutcome !== 'completed') for (const persona of personas) persona.scenario.mockRefundOutcome = options.mockRefundOutcome;
    const agent = options.agent === 'external' ? createExternalTrialAgent({ endpoint: options.endpoint }) : options.agent;
    const agentId = options.agent === 'external' ? `local-${createHash('sha256').update(options.endpoint).digest('hex').slice(0, 24)}` : undefined;
    const run = await runTrials({ personas, trials: options.trials, concurrency: options.concurrency, agent, agentId });
    const criticalFailures = run.failureClusters.reduce((sum, cluster) => sum + cluster.count, 0);
    const passed = run.passAllTrials >= options.minPassAll && criticalFailures === 0 && run.counts.unverified === 0;
    const summary = {
      agent: run.evaluatedAgentId, paymentEnvironment: 'deterministic-mock', mockProfile: options.mockProfile, mockRefundOutcome: options.mockProfile === 'sandbox-test-card' ? 'profile-managed' : options.mockRefundOutcome,
      sandboxReplay: run.sandboxReplay, personas: run.personaCount, trials: run.trials,
      counts: run.counts, passAt1: run.passAt1, passAllTrials: run.passAllTrials,
      minPassAll: options.minPassAll, criticalFailures, failureClusters: run.failureClusters.map(({ id, label, count }) => ({ id, label, count })), gate: passed ? 'pass' : 'fail'
    };
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else {
      const pct = n => `${(n * 100).toFixed(1)}%`;
      console.log(`Still ${summary.gate.toUpperCase()} | ${summary.agent} | deterministic mock`);
      if (options.mockProfile === 'sandbox-test-card') console.log('Mock profile: sandbox-test-card (modeled observations, not a prediction of PayPal outcomes).');
      if (options.mockRefundOutcome !== 'completed') console.log(`Mock refund outcome: ${options.mockRefundOutcome} (explicit scenario; sandbox funding not predicted).`);
      console.log(`${summary.personas} personas × ${summary.trials} trials: ${summary.counts.pass} passed, ${summary.counts.fail} failed, ${summary.counts.unverified} unverified`);
      console.log(`pass@1 ${pct(summary.passAt1)} | pass^${summary.trials} ${pct(summary.passAllTrials)} | required ${pct(summary.minPassAll)}`);
      console.log(`Critical rule failures: ${summary.criticalFailures} (one trial may appear in multiple clusters)`);
      for (const cluster of summary.failureClusters) console.log(`  ${cluster.count} ${cluster.label} [${cluster.id}]`);
      console.log('Sandbox replay: unverified; no live PayPal calls were made.');
    }
    process.exitCode = passed ? 0 : 1;
  }
} catch (error) {
  console.error(`still: ${error.message}`);
  process.exitCode = 2;
}
