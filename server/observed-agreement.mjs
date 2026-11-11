import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPayPalMock, parseMoney } from './paypal-mock.mjs';

const retryPath = new URL('../docs/evidence/sandbox-retry.json', import.meta.url);
const disputePath = new URL('../docs/evidence/sandbox-dispute.json', import.meta.url);
const limitation = 'These are recorded cases, not a random batch sample or a replay of every failure. Mock execution makes no sandbox calls. An open dispute does not prove a claim payout.';

function compareRun(run, finalStates, evidenceFile) {
  const unverified = reason => ({ id: run?.id ?? null, scenarioId: run?.scenarioId ?? null, evidenceFile, status: 'unverified', reason });
  if (!Array.isArray(run?.events) || !Array.isArray(finalStates)) return unverified('Missing events or final states.');
  const events = run.events;
  const capture = events.find(event => event.type === 'capture')?.response;
  const body = capture?.body;
  const calls = events.filter(event => event.type === 'tool_call' && event.tool === 'refund_order');
  const responses = events.filter(event => event.type === 'tool_result' && event.tool === 'refund_order');
  const finalCapture = finalStates.find(state => state.kind === 'capture' && state.response?.body?.id === body?.id)?.response;
  if (!capture?.ok || capture.status !== 200 || body?.status !== 'COMPLETED' || !body.id || parseMoney(body.amount?.value) === null || !body.amount?.currency_code || !finalCapture?.ok || finalCapture.status !== 200 || !finalCapture.body?.status || !calls.length || calls.length !== responses.length) return unverified('The capture, refund calls, responses, or final capture are incomplete.');
  const dispute = events.find(event => event.type === 'dispute_lookup')?.response;
  const disputeAfter = events.find(event => event.type === 'dispute_lookup_after')?.response;
  const disputeCase = run.scenarioId === 'open-dispute-refund';
  if (disputeCase && (!dispute?.ok || dispute.status !== 200 || dispute.body?.status !== 'UNDER_REVIEW' || !dispute.body?.id || !dispute.body.sellerTransactionIds?.includes(body.id) || !disputeAfter?.ok || disputeAfter.status !== 200 || disputeAfter.body?.status !== 'UNDER_REVIEW' || disputeAfter.body?.id !== dispute.body.id)) return unverified('The dispute evidence is incomplete or does not identify the capture.');
  if (!['retry-double-refund', 'open-dispute-refund'].includes(run.scenarioId)) return unverified('Unsupported recorded scenario.');
  if (calls.some((call, index) => !call.requestId || !call.arguments || parseMoney(call.arguments.amount) === null || !call.arguments.currency || !responses[index]?.response || events.indexOf(call) >= events.indexOf(responses[index]) || (calls[index + 1] && events.indexOf(responses[index]) >= events.indexOf(calls[index + 1])))) return unverified('The ordered refund requests and responses are incomplete.');

  const mock = createPayPalMock({ amount: body.amount.value, currency: body.amount.currency_code, disputeOpen: disputeCase && dispute.body.status === 'UNDER_REVIEW' }, run.id);
  const checks = [];
  const add = (field, observed, simulated) => checks.push({ field, observed, mock: simulated, agrees: JSON.stringify(observed) === JSON.stringify(simulated) });
  if (disputeCase) add('dispute open before refund', dispute.body.status === 'UNDER_REVIEW', mock.getDispute().status === 'OPEN');
  const observedIds = [], mockIds = [];
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index], observed = responses[index].response;
    const simulated = mock.refund({ amount: call.arguments.amount, currency: call.arguments.currency, requestId: call.requestId });
    if (typeof observed.ok !== 'boolean' || !Number.isInteger(observed.status) || (observed.ok && (!observed.body?.id || !observed.body?.status || parseMoney(observed.body?.amount?.value) === null || !observed.body?.amount?.currency_code))) return unverified('A refund response is incomplete.');
    add(`refund ${index + 1} HTTP status`, observed.status, simulated.status);
    add(`refund ${index + 1} success`, observed.ok, simulated.ok);
    if (observed.ok && simulated.ok) {
      add(`refund ${index + 1} outcome`, observed.body.status, simulated.body.status);
      add(`refund ${index + 1} amount`, observed.body.amount, simulated.body.amount);
      observedIds.push(observed.body.id);
      mockIds.push(simulated.body.id);
    }
  }
  for (let i = 0; i < observedIds.length; i++) for (let j = 0; j < i; j++) add(`refund identity ${j + 1} and ${i + 1}`, observedIds[i] === observedIds[j], mockIds[i] === mockIds[j]);
  add('final capture status', finalCapture.body?.status, mock.getCapture().status);
  if (disputeCase) add('dispute open after refund', disputeAfter.body.status === 'UNDER_REVIEW', mock.getDispute().status === 'OPEN');
  return { id: run.id, scenarioId: run.scenarioId, agent: run.agent, evidenceFile, status: checks.every(check => check.agrees) ? 'agreed' : 'disagreed', checks };
}

export function compareObservedEvidence({ retry, dispute } = {}) {
  const cases = [];
  if (retry?.source === 'paypal-sandbox' && Array.isArray(retry.runs) && retry.runs.length) cases.push(...retry.runs.map(run => compareRun(run, retry.finalStates, 'docs/evidence/sandbox-retry.json')));
  else cases.push({ evidenceFile: 'docs/evidence/sandbox-retry.json', status: 'unverified', reason: 'Sandbox retry evidence is missing.' });
  if (dispute?.source === 'paypal-sandbox' && dispute.run) cases.push(compareRun(dispute.run, dispute.finalStates, 'docs/evidence/sandbox-dispute.json'));
  else cases.push({ evidenceFile: 'docs/evidence/sandbox-dispute.json', status: 'unverified', reason: 'Sandbox dispute evidence is missing.' });
  const agreed = cases.filter(item => item.status === 'agreed').length;
  const disagreed = cases.filter(item => item.status === 'disagreed').length;
  const compared = agreed + disagreed;
  return { source: 'recorded-sandbox-case-comparison', limitation, agreed, disagreed, compared, unverified: cases.length - compared, agreement: compared ? agreed / compared : null, cases };
}

export async function loadObservedAgreement() {
  const read = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };
  const [retry, dispute] = await Promise.all([read(retryPath), read(disputePath)]);
  return compareObservedEvidence({ retry, dispute });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(JSON.stringify(await loadObservedAgreement(), null, 2));
