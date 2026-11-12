import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMockBatchBinding } from './mcp-batch-binding.mjs';
import { runMcpEarnedSession } from './mcp-earned-session.mjs';
import { normalizeDecisionIds } from './decision-equivalence.mjs';
import { DEFAULT_TRIAL_POLICY } from './trial-agent.mjs';
import { normalizeRefundPolicy, refundPolicyInstruction } from './refund-policy.mjs';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encoded = v => JSON.stringify(canonical(v));
const checksum = p => createHash('sha256').update(encoded(p)).digest('hex');
const order = '8AA00000BB000000C', capture = '9AA00000BB000000C';
const calls = events => normalizeDecisionIds(events.map(({name, arguments: args, decisionId, result}) => ({name, arguments: args, ...(decisionId ? {decisionId} : {}), result})), 'decisionId');
function cleanPermission(p) {
  const f = p?.create_refund, e = p?.evidence;
  if (p?.version !== 1 || p.scope !== 'deterministic-mock' || !/^mcp-local-[a-f0-9]{24}$/.test(p.agentId || '') || f?.allowed !== true || f.currency !== 'USD' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(f.maxPerOrder || '') || Number(f.maxPerOrder) <= 0 || !['requireDisputeClear','requireDisputeCheck','requireApprovedAmount','requireIdentityMatch','requireStableDecisionId'].every(k => f[k] === true) || !Number.isSafeInteger(e?.personaCount) || e.personaCount < 1 || !Number.isSafeInteger(e.trialsPerPersona) || e.trialsPerPersona < 1 || e.trialCount !== e.personaCount * e.trialsPerPersona) throw new Error('Invalid mock permission.');
  const policy = e.structuredPolicy ? normalizeRefundPolicy(e.structuredPolicy) : null;
  return {version:1, agentId:p.agentId, scope:'deterministic-mock', evidence:{personaCount:e.personaCount,trialsPerPersona:e.trialsPerPersona,trialCount:e.trialCount,sandboxReplay:'unverified',coverage:'Only observed passing mock trials; unobserved scenarios and live behavior are unverified.', ...(policy ? {structuredPolicy:policy} : {})}, create_refund:{allowed:true,currency:'USD',maxPerOrder:f.maxPerOrder,requireDisputeClear:true,requireDisputeCheck:true,requireApprovedAmount:true,requireIdentityMatch:true,requireStableDecisionId:true}};
}
function validateCalls(baseline) {
  if (!Array.isArray(baseline) || !baseline.length || baseline.length > 16) throw new Error('Invalid mock calls.');
  for (const c of baseline) {
    const a=c?.arguments;
    if (!a || typeof a !== 'object' || Array.isArray(a) || !c.result || typeof c.result !== 'object') throw new Error('Invalid mock call.');
    const keys=Object.keys(a).sort().join(',');
    if (c.name === 'get_order' && (keys !== 'order_id' || a.order_id !== order)) throw new Error('Unsupported mock order.');
    else if (c.name === 'list_disputes' && (keys !== 'disputed_transaction_id' || a.disputed_transaction_id !== capture)) throw new Error('Unsupported mock dispute.');
    else if (c.name === 'get_refund' && (keys !== 'refund_id' || !/^MOCK-REFUND-batch-[1-9][0-9]{0,2}$/.test(a.refund_id || ''))) throw new Error('Unsupported mock refund.');
    else if (c.name === 'create_refund' && (keys !== 'amount,capture_id' || a.capture_id !== capture || Object.keys(a.amount || {}).sort().join(',') !== 'currency_code,value' || a.amount.currency_code !== 'USD' || !/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(a.amount.value || '') || !Number.isSafeInteger(c.decisionId) || c.decisionId < 1 || c.decisionId > 16)) throw new Error('Unsupported mock refund.');
    else if (!['get_order','list_disputes','get_refund','create_refund'].includes(c.name)) throw new Error('Unsupported mock call.');
    if (c.name !== 'create_refund' && Object.hasOwn(c,'decisionId')) throw new Error('Invalid decision ID.');
    if (Object.keys(c).some(k => !['name','arguments','decisionId','result'].includes(k))) throw new Error('Invalid mock call.');
  }
}
async function replay(permission, baseline) {
  validateCalls(baseline);
  const {gateway}=createMockBatchBinding({permission,agentId:permission.agentId,toolkitTrial:true,decisionId:'session-binding'});
  const reg={version:1,kind:'gateway-regression',calls:baseline.map(({name,arguments:args,decisionId})=>({name,arguments:args,...(decisionId ? {decisionId:`portable-${decisionId}`} : {})}))};
  const r=await gateway.replay(reg);
  if (encoded(r.results) !== encoded(baseline.map(c=>c.result))) throw new Error('Recorded mock calls do not reproduce their outcomes.');
}
export async function exportMcpPortable({record,permission}) {
  if (record?.status !== 'completed' || !record.regression?.calls?.length || !Array.isArray(record.events)) throw new Error('Promote a completed MCP session first.');
  const p=cleanPermission(permission), baseline=calls(record.events);
  await replay(p,baseline);
  const payload={version:1,kind:'still-portable-mcp-regression',provenance:'deterministic-mock',permission:p,baseline};
  return {payload,checksum:checksum(payload)};
}
export async function runMcpPortable({path,agentModule}) {
  const raw=await readFile(path,'utf8');
  if (Buffer.byteLength(raw)>1000000) throw new Error('Regression artifact is too large.');
  const artifact=JSON.parse(raw), p=artifact?.payload;
  if (Object.keys(artifact || {}).sort().join(',') !== 'checksum,payload' || !/^[a-f0-9]{64}$/.test(artifact.checksum || '') || checksum(p)!==artifact.checksum || p?.version!==1 || p.kind!=='still-portable-mcp-regression' || p.provenance!=='deterministic-mock' || Object.keys(p).sort().join(',')!=='baseline,kind,permission,provenance,version') throw new Error('Invalid or altered mock regression artifact.');
  const permission=cleanPermission(p.permission);
  if (encoded(permission)!==encoded(p.permission)) throw new Error('Invalid mock permission.');
  await replay(permission,p.baseline);
  const host=await import(pathToFileURL(resolve(agentModule)).href);
  const structured=permission.evidence.structuredPolicy;
  const policy=`${DEFAULT_TRIAL_POLICY}${structured ? `\n${refundPolicyInstruction(structured)}` : ''}`;
  const outcome=await runMcpEarnedSession({host,permission,policy});
  if (outcome.status!=='completed' || !outcome.events?.length) return {status:'unverified',reason:'MCP agent session did not complete.',provenance:'deterministic-mock'};
  const actual=calls(outcome.events), expected=p.baseline;
  const differences=Array.from({length:Math.max(actual.length,expected.length)},(_,i)=>encoded(actual[i]??null)===encoded(expected[i]??null)?null:i+1).filter(Boolean);
  return {status:differences.length?'changed':'matched',callsCompared:Math.max(actual.length,expected.length),differences,provenance:'deterministic-mock'};
}
