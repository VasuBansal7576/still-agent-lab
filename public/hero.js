const form = document.querySelector('#run-form');
const results = document.querySelector('#results');
const sandbox = document.querySelector('#sandbox');
const status = document.querySelector('#status');
const runButton = document.querySelector('#run');
const agent = document.querySelector('#agent');
const endpoint = document.querySelector('#endpoint');
const policy = document.querySelector('#policy');
const personaSource = document.querySelector('#persona-source');
const accountLoad = document.querySelector('#account-load');
const accountStatus = document.querySelector('#account-status');
const shadowStart = document.querySelector('#shadow-start');
const shadowStatus = document.querySelector('#shadow-status');
const shadowResult = document.querySelector('#shadow-result');
const recentBatches = document.querySelector('#recent-batches');
const savedBatchStatus = document.querySelector('#saved-batch-status');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => escape(JSON.stringify(value ?? null, null, 2));
const state = { run: null, selectedCluster: null, selectedTrial: null, page: null, pageError: null, permission: null, permissionUrl: null, replay: null, toolkitConfig: null, selectedReplay: null, coverage: null, explanation: null, sandbox: null, accountSnapshot: null, busy: false };
const agentNames = { external: 'Local HTTP agent', buggy: 'Scripted buggy example', safe: 'Scripted corrected example' };
let recentRequest = 0;
let recentData = null, recentExpanded = false;

async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.checkout = data.checkout; error.noOrderAttempted = data.noOrderAttempted === true; throw error; }
  return data;
}
function renderRecentBatches() {
  if (!recentData) return;
  const labels = { pass:'Passed', fail:'Failed', unverified:'Unverified' };
  const sources = { public:'Public-data personas', 'sandbox-account':'Sandbox account-derived personas', unknown:'Persona source not recorded' };
  const shown = recentExpanded ? recentData.batches : recentData.batches.slice(0, 5);
  const rows = shown.map((batch, index) => {
    const label = labels[batch.verdict] || 'Unknown', agentName = agentNames[batch.agent] || 'Agent not recorded';
    const when = new Date(batch.createdAt).toLocaleString();
    return `<div class="row"><span><strong>${escape(label)} · mock</strong><br>${escape(agentName)} · ${escape(sources[batch.source] || sources.unknown)}<br><span class="hint">${Number(batch.personaCount).toLocaleString()} personas × ${Number(batch.trials)} trials · ${escape(when)}</span></span><button type="button" class="secondary" data-recent-id="${escape(batch.id)}" aria-label="${escape(`Open ${label.toLowerCase()} ${agentName} run ${index + 1}, ${when}`)}">Open run</button></div>`;
  }).join('');
  const toggle = recentData.batches.length > 5 ? `<button type="button" class="secondary" data-recent-expand aria-expanded="${recentExpanded}">${recentExpanded ? 'Show fewer runs' : `Show ${recentData.batches.length - 5} more runs`}</button>` : '';
  recentBatches.innerHTML = `${rows ? `<div class="rows">${rows}</div>${toggle}` : '<p>No recent saved runs found.</p>'}${recentData.limited ? '<p class="hint">Some runs could not be listed within the history limits. Open an older batch by ID.</p>' : ''}`;
}
async function loadRecentBatches() {
  const sequence = ++recentRequest;
  recentBatches.innerHTML = '<p>Loading recent runs…</p>';
  try {
    const data = await request('/api/upgrade/recent-batches');
    if (sequence !== recentRequest) return;
    recentData = data; recentExpanded = false; renderRecentBatches();
  } catch { if (sequence === recentRequest) recentBatches.innerHTML='<p>Recent runs are unavailable. You can open a saved batch by ID below.</p>'; }
}
function sourceLink(url, label) {
  try { const parsed = new URL(url); if (parsed.protocol === 'https:') return `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`; } catch {}
  return '';
}
function provenance(source) {
  if (!source) return '<p>Persona source is unavailable for this trace.</p>';
  return `<p><strong>${escape(source.dataset)}</strong><br>Record ${escape(source.recordId)}<br>${escape(source.license)}</p>${Array.isArray(source.recordIds) ? `<p>Linked record IDs: ${source.recordIds.map(escape).join(', ')}</p>` : ''}${source.scenarioAssumptions ? `<p>${escape(source.scenarioAssumptions)}</p>` : ''}${source.accountEvidence ? `<details><summary>Account evidence and coverage</summary><pre>${json(source.accountEvidence)}</pre></details>` : ''}<p>${sourceLink(source.url, 'Open source record')} ${sourceLink(source.evidenceUrl, 'Source evidence')}</p>`;
}
function eventSummary(event) {
  if (event.type === 'customer') return { label:'Customer', text:event.text };
  if (event.type === 'agent_message' || event.type === 'agent') return event.text ? { label:'Agent', text:event.text } : null;
  if (event.type === 'error') return { label:'Error', text:event.message || 'The agent did not complete.' };
  if (event.type === 'tool_call') {
    const args = event.arguments || {};
    const amount = args.amount == null ? '' : typeof args.amount === 'object' ? ` · ${args.amount.value || ''} ${args.amount.currency_code || ''}` : ` · ${args.amount} ${args.currency || ''}`;
    return { label:'Tool call', text:`${event.tool || 'Unknown tool'}${amount}` };
  }
  if (event.type === 'tool_result') {
    const response = event.response || {};
    if (event.tool === 'get_order') return { label:'Mock order', text:`Payment ${response.payment?.status || 'unknown'} · approved return ${response.approvedReturn ?? 'unknown'} ${response.payment?.amount?.currency_code || ''}` };
    if (event.tool === 'list_disputes') return { label:'Mock dispute list', text:response.complete ? `${response.items?.length || 0} disputes for this capture · complete in mock` : response.error || response.reason || 'Listing unverified' };
    if (event.tool === 'get_dispute') return { label:'Mock dispute', text:`Dispute status: ${response.status || 'unknown'}` };
    const body = response.body || {};
    const value = body.amount ? ` · ${body.amount.value} ${body.amount.currency_code}` : '';
    return { label:'Mock tool result', text:`${event.tool || 'Tool'} · ${response.status ? `HTTP ${response.status}` : response.error || 'no provider status'}${body.status ? ` · ${body.status}` : ''}${value}` };
  }
  if (event.type === 'fault_injection') return { label:'Simulated fault', text:event.message || event.text || 'Fault injected.' };
  return null;
}
function traceView(trace, label) {
  if (!trace) return '<p>No example trace is available.</p>';
  const checks = Array.isArray(trace.checks) ? trace.checks : trace.check ? [trace.check] : [];
  const source = trace.provenance?.persona || trace.provenance;
  const events = (trace.events || []).map(event => {
    const summary = eventSummary(event);
    if (!summary) return '';
    return `<li><span class="label">${escape(summary.label)} · ${escape(event.id)}</span><p>${escape(summary.text)}</p>${event.type === 'tool_call' || event.type === 'tool_result' ? `<details><summary>Inspect ${event.type === 'tool_call' ? 'arguments' : 'response'}</summary><pre>${json(event.type === 'tool_call' ? (event.requestId ? { arguments:event.arguments, requestId:event.requestId } : event.arguments) : event.response)}</pre></details>` : ''}</li>`;
  }).join('');
  return `<div id="trace" class="card"><div class="label">${escape(label)} · mock</div><h3>Trace for ${escape(trace.personaId)} · trial ${escape(trace.trial)}</h3><p class="hint">These events come from the selected mock trial, not PayPal sandbox.</p><ul class="timeline">${events || '<li>No events recorded.</li>'}</ul><h3>Rule evidence</h3>${checks.map(check=>`<div class="rule"><strong class="${check.status === 'pass' ? 'good' : 'bad'}">${escape(String(check.status || 'unverified').toUpperCase())}</strong> · ${escape(check.id)}<p>${escape(check.evidence)}</p></div>`).join('') || '<p>Rule evidence is unavailable.</p>'}<details><summary>Persona provenance</summary>${provenance(source)}</details><details><summary>Complete trace</summary><pre>${json(trace)}</pre></details></div>`;
}
function clearPermission() {
  if (state.permissionUrl) URL.revokeObjectURL(state.permissionUrl);
  state.permission = null;
  state.permissionUrl = null;
  state.replay = null;
  state.toolkitConfig = null;
}
function comparisonObservation(value, provider = false) {
  if (!value || typeof value !== 'object') return 'unavailable';
  const body = value.body || {};
  const amount = provider ? body.amount || value.amount : value.amount;
  const outcome = provider ? body.status || value.outcome : value.outcome;
  const issues = provider ? body.details?.map(item => item.issue).filter(Boolean) || value.issues : value.issue ? [value.issue] : [];
  const parts = [];
  if (Number.isInteger(value.status)) parts.push(`HTTP ${value.status}`);
  if (outcome) parts.push(outcome);
  if (amount?.value && amount?.currency_code) parts.push(`${amount.value} ${amount.currency_code}`);
  if (issues?.length) parts.push(issues.join(', '));
  if (!provider && value.timeoutInjected) parts.push('timeout simulated after this mock outcome');
  return parts.length ? parts.join(' · ') : 'unavailable';
}
function comparisonSummary(comparison, result) {
  let rows = [];
  if (comparison?.source === 'paypal-sandbox') {
    if (Array.isArray(comparison.comparisons)) rows = comparison.comparisons;
    else if (comparison.mock || comparison.provider) rows = [{ mock: comparison.mock, provider: comparison.provider }];
    else if (comparison.refundCalls === 0) return '<p>Recorded replay made no refund call. A matching sandbox capture was observed.</p>';
  }
  if (!rows.length && result?.receipt?.source === 'paypal-sandbox' && result.receipt.simulated === false) {
    const receipt = result.receipt;
    rows = Array.isArray(receipt.attempts) ? receipt.attempts.map(attempt => ({ provider: attempt.refund })) : receipt.refund ? [{ provider: receipt.refund }] : [];
  }
  if (!rows.length) return comparison?.reason ? `<p>${escape(comparison.reason)}</p>` : '';
  const pending = rows.some(row => (row.provider?.body?.status || row.provider?.outcome) === 'PENDING');
  return `<div class="trace">${rows.map((row,index)=>`<p><strong>Refund ${index+1}</strong><br>Mock: ${escape(comparisonObservation(row.mock))}<br>PayPal sandbox: ${escape(comparisonObservation(row.provider, true))}</p>`).join('')}</div>${pending ? '<p class="hint">PENDING means PayPal received the request; it does not establish a completed refund.</p>' : ''}${comparison?.status !== 'agreed' && comparison?.status !== 'disagreed' ? '<p class="hint">A response is shown, but the sandbox comparison remains unverified.</p>' : ''}`;
}
function sandboxReplayView(selected) {
  if (!selected) return '';
  const selectedReplay = state.selectedReplay;
  const intro = '<p class="hint">This sends the recorded mock tool calls to a fresh matching PayPal sandbox capture. It does not rerun the agent. Customer and store facts are synthetic; no real money moves.</p>';
  if (!selectedReplay) return `<div class="card"><div class="label">Selected trial · PayPal sandbox</div><h3>Compare this trace.</h3>${intro}<button type="button" data-action="sandbox-select">Check sandbox replay</button></div>`;
  if (selectedReplay.status !== 'selected') return `<div class="card"><div class="label">Selected trial · PayPal sandbox</div><h3>Replay unavailable.</h3>${intro}<p>${escape(selectedReplay.reason)}</p></div>`;
  const checkout = selectedReplay.checkoutMatches ? selectedReplay.checkout : null;
  const otherCheckout = !selectedReplay.checkoutMatches && selectedReplay.checkout && selectedReplay.checkout.state !== 'spent';
  let controls = '';
  if (selectedReplay.locked) controls = '<p>The operation outcome is uncertain. Do not retry automatically; check the sandbox state in the advanced lab.</p>';
  else if (['recorded','recorded-unverified'].includes(selectedReplay.execution)) controls = '<p>A sandbox attempt is recorded for this trial. An uncertain result must not be retried automatically.</p>';
  else if (selectedReplay.execution === 'unsupported') controls = `<p>${escape(selectedReplay.reason)}</p>`;
  else if (otherCheckout) controls = '<p>Another sandbox checkout is active or unresolved. Finish it in the <a href="/lab">advanced lab</a> before starting this replay.</p>';
  else if (!checkout && !selectedReplay.paypalReady) controls = '<p>Connect PayPal sandbox in <a href="/setup">setup</a> before creating the order.</p><button type="button" class="secondary" data-action="sandbox-select">Check connection again</button>';
  else if (!checkout) controls = '<button type="button" data-action="sandbox-prepare">Create matching sandbox order</button><p class="hint">A sandbox buyer must approve the order before capture.</p>';
  else if (checkout.state === 'spent') controls = '<p>This sandbox capture was already used. An uncertain result must not be retried automatically.</p>';
  else if (checkout.state === 'approval_required') {
    let link = '';
    try { const u = new URL(checkout.approvalUrl); if (u.protocol === 'https:' && u.hostname === 'www.sandbox.paypal.com' && !u.username && !u.password && !u.port) link = `<a class="button secondary" href="${escape(u.href)}" target="_blank" rel="noopener noreferrer">Approve in PayPal sandbox ↗</a>`; } catch {}
    controls = `<p>Approve the ${escape(checkout.currency)} ${escape(checkout.amount)} sandbox order, then capture it.</p><div class="actions">${link}<button type="button" data-action="sandbox-capture">Capture approved order</button></div>`;
  } else if (checkout.state === 'captured') {
    if (selectedReplay.execution === 'requires-sandbox-dispute' && !checkout.replayDisputeId) controls = `<p>A real unresolved sandbox dispute linked to capture ${escape(checkout.captureId)} is required before replay.</p><label>Sandbox dispute ID <input id="selected-dispute-id" placeholder="PayPal dispute ID"></label><button type="button" data-action="sandbox-dispute">Verify linked dispute</button>`;
    else controls = `<p>Matching ${escape(checkout.currency)} ${escape(checkout.amount)} sandbox capture ${escape(checkout.captureId)} is ready${checkout.replayDisputeId ? `; dispute ${escape(checkout.replayDisputeId)} was verified` : ''}.</p><button type="button" data-action="sandbox-execute">Replay recorded calls against sandbox</button>`;
  } else controls = `<p>Checkout outcome: ${escape(checkout.state)}. ${escape(checkout.error || 'Do not automatically retry an uncertain operation.')}</p>`;
  const comparison = selectedReplay.comparison;
  const comparisonText = comparison?.status === 'agreed' || comparison?.status === 'disagreed' ? `Sandbox comparison ${comparison.status}.` : 'Sandbox comparison unverified.';
  return `<div class="card" id="selected-sandbox"><div class="label">Selected trial · PayPal sandbox</div><h3>${escape(comparisonText)}</h3><p>${escape(selectedReplay.personaId)} · trial ${escape(selectedReplay.trial)}</p>${intro}${selectedReplay.reason ? `<p>${escape(selectedReplay.reason)}</p>` : ''}${controls}${comparisonSummary(comparison, selectedReplay.result)}${comparison ? `<details><summary>Inspect sandbox comparison</summary><pre>${json(comparison)}</pre></details>` : ''}${selectedReplay.result ? `<details><summary>Inspect sandbox response</summary><pre>${json(selectedReplay.result)}</pre></details>` : ''}</div>`;
}
function renderResults() {
  if (!state.run) { results.innerHTML='<p>Run an agent to see its decisions, rule evidence, and persona source here.</p>'; return; }
  const { data, config } = state.run;
  const total = data.personaCount * data.trials;
  const passed = data.counts.pass === total && data.counts.fail === 0 && data.counts.unverified === 0;
  const verdict = data.counts.fail > 0 ? 'Failed' : passed ? 'Passed' : 'Unverified';
  const cluster = data.failureClusters.find(item => item.id === state.selectedCluster);
  const selected = state.selectedTrial?.trial || (cluster ? cluster.example : data.exampleTrial);
  const scope = config.agent === 'external' ? `${agentNames[config.agent]}${data.protocolVersion === 3 ? ' · toolkit-style v3' : ''} · ${config.endpoint || 'original endpoint not saved'}` : agentNames[config.agent] || 'Saved agent';
  const structuredPolicy = data.structuredPolicy ? `<p>Checked store limits: ${[data.structuredPolicy.maxPerRefund ? `${escape(data.structuredPolicy.maxPerRefund)} ${escape(data.structuredPolicy.currency)} per refund call` : null, data.structuredPolicy.maxPerOrder ? `${escape(data.structuredPolicy.maxPerOrder)} ${escape(data.structuredPolicy.currency)} total per order` : null].filter(Boolean).join(' · ')}. ${data.structuredPolicy.maxPerRefund && !data.structuredPolicy.maxPerOrder ? 'Multiple calls can total more. ' : ''}The earned mock permission has a separate per-order ceiling. If the approved return is larger than an applicable limit, no refund is an acceptable safety outcome; customer-facing wording is not checked.</p>` : '';
  const clusters = data.failureClusters.map(item=>{ const match=state.coverage?.clusterReplays?.find(entry=>entry.clusterId === item.id)?.result; return `<div class="row"><span><strong>${escape(item.label)}</strong><br><span class="hint">${Number(item.count).toLocaleString()} trial${item.count === 1 ? '' : 's'}${match ? ` · example sandbox ${escape(match.status === 'agreed' || match.status === 'disagreed' ? match.status : 'unverified')}` : ''}</span></span><button type="button" class="secondary" data-action="cluster" data-id="${escape(item.id)}">Inspect example</button></div>`; }).join('');
  let browser = '<p>Trial list is unavailable.</p><button type="button" class="secondary" data-action="page" data-offset="0">Load trials</button>';
  if (state.page) {
    const page=state.page;
    const rows=page.items.map(item=>`<div class="row"><span><strong>${escape(item.status.toUpperCase())}</strong> · ${escape(item.personaId)} · trial ${escape(item.trial)}<br><span class="hint">${escape(item.provenance?.persona?.dataset || 'Source unavailable')}</span></span><button type="button" class="secondary" data-action="trial" data-index="${Number(item.index)}">Inspect trial</button></div>`).join('');
    browser=`<p>Showing ${page.total ? page.offset+1 : 0}–${Math.min(page.offset+page.items.length,page.total)} of ${Number(page.total).toLocaleString()} trials. Select any trial to inspect its decisions and source.</p><div class="rows">${rows || '<p>No trials on this page.</p>'}</div><div class="actions"><button type="button" class="secondary" data-action="page" data-offset="${Math.max(0,page.offset-20)}" ${page.offset === 0 ? 'disabled' : ''}>Previous 20</button><button type="button" class="secondary" data-action="page" data-offset="${page.offset+20}" ${page.offset+page.items.length >= page.total ? 'disabled' : ''}>Next 20</button></div>`;
  }
  if (state.pageError) browser += `<p class="status">${escape(state.pageError)}</p>`;
  let access = '';
  if (config.personaSource === 'sandbox-account') access = '<p>Account history and dispute coverage are incomplete. Account-derived runs cannot earn a permission.</p>';
  else if (config.policy) access = '<p>Additional instructions are not automatically checked. This run cannot earn a permission.</p>';
  else if (!passed) access = '<p>A permission requires every trial to pass with complete evidence.</p>';
  else if (!state.permission) access = `<p>A fully passing run can request a USD mock-only permission. A grant also requires completed USD refund evidence.${data.protocolVersion === 3 ? ' Each refund must have a supplied request ID and matching order and complete dispute-list evidence.' : ''}</p><button type="button" data-action="permission">Request mock permission</button>`;
  else if (!state.permission.create_refund?.allowed) access = `<div class="trace"><strong>No permission issued</strong><p>${escape(state.permission.reason || 'Insufficient evidence for a grant.')}</p></div>`;
  else { const p=state.permission; const toolkit=state.toolkitConfig; access = `<div class="trace"><strong>Mock refunds up to ${escape(p.create_refund.maxPerOrder)} ${escape(p.create_refund.currency)} per order</strong><p>${Number(p.evidence.personaCount).toLocaleString()} observed personas · ${Number(p.evidence.trialCount).toLocaleString()} trials. ${escape(p.evidence.coverage)}</p><p>Dispute check, approved amount, identity match, and stable decision ID are required. No production access is granted.</p>${data.protocolVersion === 3 ? '<p>The gateway example uses scripted mock calls. It does not rerun this agent.</p>' : ''}</div><div class="actions"><a class="button secondary" href="${escape(state.permissionUrl)}" download="still-permission.json">Download permission JSON</a><button type="button" data-action="gateway">Try mock gateway</button>${data.protocolVersion === 3 ? `<label>Stable refund decision ID<input id="toolkit-decision-id" maxlength="127" autocomplete="off" value="${escape(toolkit?.decisionId || '')}" placeholder="Enter your decision ID"><span class="hint">Use the same ID for retries of this refund decision. One process handles one decision and its mock resets when the process exits.</span></label>` : ''}<button type="button" class="secondary" data-action="toolkit">Connect a toolkit agent</button></div>${toolkit ? `<div class="trace"><h4>MCP configuration · mock only</h4><p>Use this configuration in an MCP stdio host on this machine. The server exposes get_order, get_refund, get_dispute and create_refund${toolkit.protocolVersion === 3 ? ', plus capture-scoped list_disputes' : ''}. Each process represents one refund decision; the mock resets on exit. ${toolkit.protocolVersion === 3 ? 'Look up synthetic order 8AA00000BB000000C and check its capture with list_disputes before a refund.' : 'Check batch-dispute before a refund.'} It does not authenticate the client or fall back to PayPal. It cannot authorize sandbox or production access.</p><pre>${json(toolkit.config)}</pre><h4>OpenAI PayPal toolkit</h4><p>For the PayPal OpenAI toolkit, replace its dispatcher with the wrapper below; an MCP configuration alone does not redirect direct SDK calls. Install the MCP SDK alongside the toolkit.</p><pre>${escape(`import { connectStillToolkit } from ${JSON.stringify(toolkit.toolkitModule)};\nconst toolkit = await connectStillToolkit(paypalToolkit, { batchId: ${JSON.stringify(toolkit.batchId)}${toolkit.decisionId ? `, decisionId: ${JSON.stringify(toolkit.decisionId)}` : ''} });`)}</pre><p><a href="${toolkit.protocolVersion === 3 ? 'https://github.com/VasuBansal7576/still-agent-lab/blob/main/docs/toolkit-v3-mcp.md' : 'https://github.com/VasuBansal7576/still-agent-lab/blob/main/docs/actual-toolkit.md'}" target="_blank" rel="noopener noreferrer">Toolkit setup and limitations ↗</a></p></div>` : ''}`; }
  let gateway = '';
  if (state.replay) { const calls = state.replay.events.filter(event => event.name === 'create_refund'); gateway = `<div class="card"><div class="label">Mock gateway replay</div><h3>Permission enforcement</h3>${calls.map((call,index)=>`<p><strong>${index === 0 ? 'Over limit' : 'Eligible'} · ${escape(call.arguments?.amount?.value)} ${escape(call.arguments?.amount?.currency_code)}</strong> · ${call.result?.blocked ? 'Blocked' : call.result?.ok ? 'Allowed' : 'Unverified'}</p>`).join('')}<p class="hint">The gateway uses an isolated mock. No PayPal payment was made.</p><details><summary>Inspect gateway events</summary><pre>${json(state.replay)}</pre></details></div>`; }
  const explanation = cluster ? `<div class="actions"><button type="button" class="secondary" data-action="explain">Explain this failure with AI</button></div>${state.explanation ? `<p>${escape(state.explanation)}</p>` : '<p class="hint">AI explains evidence; deterministic checks decide the verdict. Model access is required.</p>'}` : '';
  const retryNext = cluster?.id === 'duplicate_refund' ? `<div class="card"><div class="label">Retry evidence and next step</div><h3>See the saved PayPal result.</h3><p>The saved sandbox run is a separate $100 capture with a simulated timeout. It is not a replay of this selected mock trial.</p><div class="actions"><button type="button" class="secondary" data-action="saved-retry">Show saved PayPal sandbox evidence</button>${config.agent === 'buggy' ? '<button type="button" data-action="corrected-example">Run corrected scripted example</button>' : '<a href="#connect-heading">Change your agent and rerun ↑</a>'}</div>${config.agent === 'buggy' ? '<p class="hint">Runs the separate corrected scripted example with the current settings. It does not change your agent.</p>' : '<p class="hint">Change the connected agent, then run the mock trials again.</p>'}</div>` : '';
  const coverage = state.coverage ? `<div class="card"><div class="label">Saved sandbox comparisons</div><h3>${state.coverage.compared ? `${Number(state.coverage.agreed).toLocaleString()} of ${Number(state.coverage.compared).toLocaleString()} compared agreed` : 'Sandbox agreement unverified'}</h3><p>${Number(state.coverage.agreed).toLocaleString()} agreed · ${Number(state.coverage.disagreed).toLocaleString()} disagreed · ${Number(state.coverage.unverified).toLocaleString()} unverified across ${Number(state.coverage.queueCount).toLocaleString()} queued trials.</p><p class="hint">This queue includes ${Number(state.coverage.failureCount).toLocaleString()} failures and ${Number(state.coverage.sampledPassCount).toLocaleString()} sampled passes; ${Number(state.coverage.excludedUnverifiedCount).toLocaleString()} incomplete mock trials are excluded. It uses recorded immediate sandbox receipts for this batch. Agreement can include PENDING refunds; pending does not mean completed. Unverified and simulated outcomes do not count as PayPal comparisons; this is not a real-world failure rate.</p><button type="button" class="secondary" data-action="coverage">Refresh saved comparisons</button></div>` : '<div class="card"><div class="label">Saved sandbox comparisons</div><h3>Check this batch’s coverage.</h3><p class="hint">Reads saved immediate sandbox receipts. It does not contact PayPal.</p><button type="button" class="secondary" data-action="coverage">Show sandbox coverage</button></div>';
  results.innerHTML = `<div class="card"><span class="pill">${escape(verdict)} · mock</span><h3>${escape(scope)}</h3><p>${Number(data.personaCount).toLocaleString()} personas × ${Number(data.trials)} trials · ${escape(config.profile === 'sandbox-test-card' ? 'Observed sandbox test-card profile' : 'Completed-refund profile')} · ${config.personaSource === 'sandbox-account' ? 'Sandbox account-derived personas' : 'Public-data personas'}</p>${data.accountImport ? `<p class="hint">Account report ${escape(data.accountImport.effectiveStart)} to ${escape(data.accountImport.effectiveEnd)}. ${escape(data.accountImport.evidence.transactions.reason)}. ${escape(data.accountImport.evidence.disputes.reason)}. Scenario requests and policy facts are synthetic.</p>` : ''}<p class="hint">Batch ${escape(data.id)}. Results belong to the settings used for this run, even if you change the form above. ${config.agent === 'external' ? 'The host identifies this agent by its endpoint; the endpoint does not authenticate the agent.' : 'This is a built-in scripted example.'}</p>${structuredPolicy}<div class="metrics"><div class="metric"><span>pass@1 · per trial</span><strong>${(Number(data.passAt1)*100).toFixed(1)}%</strong></div><div class="metric"><span>pass^${Number(data.trials)} · passed every trial</span><strong>${(Number(data.passAllTrials)*100).toFixed(1)}%</strong></div></div><p>${Number(data.counts.pass).toLocaleString()} passed · ${Number(data.counts.fail).toLocaleString()} failed · ${Number(data.counts.unverified).toLocaleString()} unverified</p><p class="hint">Unverified trials do not count as passes. These are mock results, not estimates of real-world reliability.</p>${data.effectivePolicy ? `<details><summary>Agent instructions used for this run</summary><pre>${escape(data.effectivePolicy)}</pre></details>` : ''}<h3>Failure map</h3><p class="hint">A trial can appear in multiple groups. Select a group to inspect its example.</p><div class="rows">${clusters || '<p>No observed failure groups.</p>'}</div><div class="actions"><button type="button" class="secondary" data-action="example">Inspect example trial</button><a href="#connect-heading">Change or rerun agent ↑</a></div><details id="trial-browser"><summary>Browse all trials</summary>${browser}</details></div>${coverage}${traceView(selected, state.selectedTrial ? `Trial ${state.selectedTrial.index+1}` : cluster ? cluster.label : 'Example trial')}${retryNext}${explanation}${sandboxReplayView(selected)}<div class="card"><div class="label">Earned permission</div><h3>Scope access to observed evidence.</h3>${access}</div>${gateway}`;
}
function renderSandbox() {
  if (!state.sandbox) { sandbox.innerHTML='<button type="button" data-action="sandbox">Show saved retry evidence</button>'; return; }
  const runs=state.sandbox.runs || [];
  const buggy=runs[0]?.events?.filter(event=>event.type==='tool_result' && event.tool==='refund_order') || [];
  const fixed=runs[1]?.events?.filter(event=>event.type==='tool_result' && event.tool==='refund_order') || [];
  const cards=buggy.map((event,index)=>`<div class="metric"><span>Refund ${index+1} · saved sandbox response</span><strong>HTTP ${escape(event.response?.status)}</strong><span>${escape(event.response?.body?.amount?.value)} ${escape(event.response?.body?.amount?.currency_code)} · ${escape(event.response?.body?.status)}<br>ID ${escape(event.response?.body?.id)}</span></div>`).join('');
  const sameRefund = fixed.length === 2 && fixed[0].response?.body?.id && fixed[0].response.body.id === fixed[1].response?.body?.id;
  const fixedSummary = sameRefund ? `In a separate fixed run, PayPal returned HTTP ${escape(fixed[0].response.status)} and HTTP ${escape(fixed[1].response.status)} for the same refund ID.` : 'The fixed retry outcome is unavailable or unverified.';
  sandbox.innerHTML=`<div class="card"><h3>Saved sandbox retry responses</h3><div class="metrics">${cards || '<p>No saved refund responses available.</p>'}</div><p>The saved buggy run used one $100 capture and a simulated timeout. ${fixedSummary}</p><p><a href="/replay">Open the full saved sandbox replay ↗</a></p><details><summary>Inspect saved retry traces</summary><pre>${json(runs)}</pre></details></div>`;
}
function modeChanged() {
  const external = agent.value === 'external';
  document.querySelector('#endpoint-label').hidden = !external;
  document.querySelector('#protocol-label').hidden = !external;
  document.querySelector('#policy-label').hidden = !external;
  document.querySelector('#external-help').hidden = !external;
  endpoint.required = external;
  document.querySelector('#account-import').hidden = personaSource.value !== 'sandbox-account';
}
agent.addEventListener('change', modeChanged);
personaSource.addEventListener('change', modeChanged);
for (const selector of ['#personas', '#account-start', '#account-start-time', '#account-end', '#account-end-time', '#account-disputes']) document.querySelector(selector).addEventListener('change', () => { state.accountSnapshot=null; accountStatus.textContent='Settings changed. Import the account snapshot again.'; });
accountLoad.addEventListener('click', async () => {
  if (state.busy) return;
  const startDate=document.querySelector('#account-start').value, endDate=document.querySelector('#account-end').value, startTime=document.querySelector('#account-start-time').value, endTime=document.querySelector('#account-end-time').value;
  const personas=Number(document.querySelector('#personas').value), includeDisputes=document.querySelector('#account-disputes').checked;
  if (!startDate || !endDate) { accountStatus.textContent='Choose a report start and end date.'; return; }
  state.accountSnapshot=null; state.busy=true; accountLoad.disabled=true; runButton.disabled=true;
  accountStatus.textContent='Reading sandbox account records. No payment action is performed.';
  try {
    const data=await request('/api/upgrade/account-snapshot',{ startDate, endDate, startTime, endTime, personas, includeDisputes });
    if (data.status !== 'ready') { accountStatus.textContent=`Account import unverified for ${data.effectiveStart} to ${data.effectiveEnd}. ${data.reason} ${data.evidence?.transactions?.reason || ''}`; return; }
    state.accountSnapshot=data;
    accountStatus.textContent=`Imported ${data.count} synthetic personas from ${data.importedTransactions} eligible sandbox transactions (${data.effectiveStart} to ${data.effectiveEnd}); ${data.importedDisputes} dispute details retrieved. ${data.evidence.transactions.reason}. ${data.evidence.disputes.reason}. This snapshot lasts for this browser session.`;
  } catch (error) { accountStatus.textContent=`Account import unavailable: ${error.message}`; }
  finally { state.busy=false; accountLoad.disabled=false; runButton.disabled=false; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !form.reportValidity()) return;
  const values = new FormData(form);
  const config = { agent:values.get('agent'), endpoint:String(values.get('endpoint') || '').trim(), personas:Number(values.get('personas')), trials:Number(values.get('trials')), concurrency:Number(values.get('concurrency')), profile:values.get('profile'), policy:String(values.get('policy') || '').trim(), personaSource:values.get('personaSource'), protocolVersion:Number(values.get('protocolVersion')) };
  if (config.agent !== 'external') { config.endpoint=''; config.policy=''; }
  const body = { agent:config.agent, personas:config.personas, trials:config.trials, concurrency:config.concurrency, mockProfile:config.profile, personaSource:config.personaSource };
  const maxPerRefund = String(values.get('refundLimit') || '').trim(), maxPerOrder = String(values.get('orderRefundLimit') || '').trim(), limitCurrency = String(values.get('refundLimitCurrency') || '').trim().toUpperCase();
  if (maxPerRefund || maxPerOrder) body.structuredPolicy = { currency: limitCurrency, ...(maxPerRefund ? { maxPerRefund } : {}), ...(maxPerOrder ? { maxPerOrder } : {}) };
  if (config.personaSource === 'sandbox-account') { if (!state.accountSnapshot) { status.textContent='Import sandbox account personas first.'; return; } body.snapshotId=state.accountSnapshot.id; }
  if (config.agent === 'external') { body.protocolVersion=config.protocolVersion; body.endpoint=config.endpoint; if (config.policy) body.policy=config.policy; }
  state.busy=true; runButton.disabled=true;
  status.textContent='Running mock trials. The previous result stays visible until this run finishes.';
  try {
    const data = await request('/api/upgrade/batch',body);
    clearPermission(); state.run={data,config}; state.selectedCluster=null; state.selectedTrial=null; state.selectedReplay=null; state.coverage=null; state.page=null; state.pageError=null; state.explanation=null;
    try { state.page=await request(`/api/upgrade/batches/${encodeURIComponent(data.id)}/trials?offset=0&limit=20`); } catch(error) { state.pageError=`Could not load trials: ${error.message}`; }
    renderResults();
    status.textContent=`Mock run ${data.id} finished. Inspect its results below.`;
    void loadRecentBatches();
    document.querySelector('#results-heading').scrollIntoView({block:'start'});
  } catch (error) { status.textContent=`Run failed to start or complete: ${error.message} The previous result, if any, is unchanged.`; }
  finally { state.busy=false; runButton.disabled=false; }
});
async function openSavedBatch(id) {
  if (state.busy) return;
  const message = savedBatchStatus;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { message.textContent='Enter a valid saved batch ID.'; return; }
  state.busy=true; document.querySelector('#open-saved-batch').disabled=true; runButton.disabled=true; message.textContent='Opening saved batch…';
  try {
    const [data,page] = await Promise.all([request(`/api/upgrade/batches/${id}`), request(`/api/upgrade/batches/${id}/trials?offset=0&limit=20`)]);
    const config = { agent:data.agent, endpoint:'', personas:data.personaCount, trials:data.trials, concurrency:data.concurrency, profile:data.mockProfile || 'completed', policy:data.additionalPolicy || '', personaSource:data.personaSource || 'public', protocolVersion:data.protocolVersion || 2 };
    clearPermission(); state.run={data,config}; state.selectedCluster=null; state.selectedTrial=null; state.selectedReplay=null; state.coverage=null; state.page=page; state.pageError=null; state.explanation=null;
    renderResults(); message.textContent=`Opened saved mock batch ${id}.`; status.textContent='';
  } catch(error) { message.textContent=`Could not open saved batch: ${error.message} The current result is unchanged.`; }
  finally { state.busy=false; document.querySelector('#open-saved-batch').disabled=false; runButton.disabled=false; }
}
document.querySelector('#open-saved-batch').addEventListener('click', () => openSavedBatch(document.querySelector('#saved-batch-id').value.trim()));
document.querySelector('#refresh-batches').addEventListener('click', () => { void loadRecentBatches(); });
recentBatches.addEventListener('click', event => {
  if (event.target.closest('button[data-recent-expand]')) { recentExpanded = !recentExpanded; renderRecentBatches(); return; }
  const button=event.target.closest('button[data-recent-id]'); if (button) void openSavedBatch(button.dataset.recentId);
});
results.addEventListener('click', async event => {
  const button=event.target.closest('button[data-action]'); if (!button || !state.run || state.busy) return;
  const action=button.dataset.action;
  if (action === 'cluster') { state.selectedCluster=button.dataset.id; state.selectedTrial=null; state.selectedReplay=null; state.explanation=null; renderResults(); document.querySelector('#trace')?.scrollIntoView({block:'start'}); return; }
  if (action === 'example') { state.selectedCluster=null; state.selectedTrial=null; state.selectedReplay=null; state.explanation=null; renderResults(); document.querySelector('#trace')?.scrollIntoView({block:'start'}); return; }
  if (action === 'corrected-example') { agent.value='safe'; modeChanged(); form.requestSubmit(); return; }
  if (action === 'saved-retry') { button.disabled=true; try { state.sandbox=await request('/sandbox-retry.json'); renderSandbox(); sandbox.scrollIntoView({block:'start'}); } catch (error) { status.textContent=`Saved sandbox evidence unavailable: ${error.message}`; } finally { button.disabled=false; } return; }
  const runId=state.run.data.id;
  state.busy=true; button.disabled=true; status.textContent='Working…';
  try {
    if (action === 'page') { state.page=await request(`/api/upgrade/batches/${encodeURIComponent(runId)}/trials?offset=${Number(button.dataset.offset)}&limit=20`); state.pageError=null; }
    if (action === 'trial') { const data=await request(`/api/upgrade/batches/${encodeURIComponent(runId)}/trials/${Number(button.dataset.index)}`); state.selectedTrial=data; state.selectedCluster=null; state.selectedReplay=null; state.explanation=null; }
    if (action === 'coverage') state.coverage=await request(`/api/upgrade/batches/${encodeURIComponent(runId)}/sandbox-coverage`);
    if (action === 'permission') { const data=await request('/api/upgrade/permission',{batchId:runId}); clearPermission(); state.permission=data.permission; if (data.permission?.create_refund?.allowed) state.permissionUrl=URL.createObjectURL(new Blob([JSON.stringify(data.permission,null,2)],{type:'application/json'})); }
    if (action === 'toolkit') { const decisionId = state.run.data.protocolVersion === 3 ? document.querySelector('#toolkit-decision-id')?.value.trim() : undefined; if (state.run.data.protocolVersion === 3 && !/^[A-Za-z0-9_-]{1,127}$/.test(decisionId || '')) throw new Error('Enter a decision ID using 1 to 127 letters, digits, underscores, or hyphens.'); state.toolkitConfig=await request('/api/upgrade/toolkit-config',{batchId:runId,...(decisionId === undefined ? {} : {decisionId})}); }
    if (action === 'gateway') state.replay=await request('/api/upgrade/permission-replay',{batchId:runId});
    if (action === 'explain') { const data=await request('/api/upgrade/explain',{batchId:runId,clusterId:state.selectedCluster}); state.explanation=`AI explanation of mock evidence: ${data.explanation}`; }
    if (action === 'sandbox-select') {
      const cluster = state.run.data.failureClusters.find(item => item.id === state.selectedCluster);
      const selected = state.selectedTrial?.trial || cluster?.example || state.run.data.exampleTrial;
      state.selectedReplay = await request('/api/upgrade/replay-select',{batchId:runId,personaId:selected.personaId,trial:selected.trial});
    }
    if (action === 'sandbox-prepare') { const selected=state.selectedReplay; const data=await request('/api/upgrade/replay-prepare',{batchId:runId,index:selected.index,selectionMode:selected.selectionMode,personaId:selected.personaId,trial:selected.trial}); state.selectedReplay.checkout=data.checkout; state.selectedReplay.checkoutMatches=true; }
    if (action === 'sandbox-capture') { const data=await request(`/api/orders/${encodeURIComponent(state.selectedReplay.checkout.orderId)}/capture`,{}); state.selectedReplay.checkout=data.checkout; }
    if (action === 'sandbox-dispute') { const data=await request('/api/upgrade/replay-dispute',{disputeId:document.querySelector('#selected-dispute-id').value.trim()}); state.selectedReplay.checkout.replayDisputeId=data.id; }
    if (action === 'sandbox-execute') {
      const old=state.selectedReplay;
      const result=await request('/api/upgrade/replay-execute',{batchId:runId,index:old.index,selectionMode:old.selectionMode,personaId:old.personaId,trial:old.trial});
      state.selectedReplay={...old,locked:true,result};
      const updated=await request('/api/upgrade/replay-select',{batchId:runId,personaId:old.personaId,trial:old.trial});
      state.selectedReplay={...updated,locked: !['recorded','recorded-unverified'].includes(updated.execution),result};
    }
    renderResults(); status.textContent=action === 'gateway' ? 'Mock gateway replay completed.' : action === 'permission' ? 'Permission request completed.' : action === 'toolkit' ? 'Mock toolkit configuration ready.' : action === 'explain' ? 'Explanation generated.' : action === 'coverage' ? 'Saved sandbox coverage loaded.' : action.startsWith('sandbox-') ? 'Sandbox replay state updated.' : 'Trial evidence loaded.'; if (action === 'trial') document.querySelector('#trace')?.scrollIntoView({block:'start'}); if (action === 'page') { const details=results.querySelector('#trial-browser'); if (details) details.open=true; }
  } catch (error) {
    if (action.startsWith('sandbox-') && state.selectedReplay) { if (error.checkout) { state.selectedReplay.checkout=error.checkout; state.selectedReplay.checkoutMatches=error.checkout.replayKey === JSON.stringify([runId,String(state.selectedReplay.personaId),state.selectedReplay.trial]); } else if (['sandbox-capture','sandbox-execute'].includes(action) || action === 'sandbox-prepare' && !error.noOrderAttempted) state.selectedReplay.locked=true; renderResults(); }
    status.textContent=error.message; button.disabled=false; results.querySelectorAll('.action-error').forEach(item=>item.remove()); const message=document.createElement('p'); message.className='status action-error'; message.setAttribute('role','status'); message.textContent=error.message; (results.querySelector('#selected-sandbox') || button).append(message);
  }
  finally { state.busy=false; }
});
sandbox.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action="sandbox"]'); if (!button) return;
  button.disabled=true;
  try { state.sandbox=await request('/sandbox-retry.json'); renderSandbox(); }
  catch(error) { button.disabled=false; status.textContent=`Saved sandbox evidence unavailable: ${error.message}`; const message=document.createElement('p'); message.className='status'; message.setAttribute('role','status'); message.textContent=`Saved sandbox evidence unavailable: ${error.message}`; button.after(message); }
});
let shadowRecord = null;
let shadowBusy = false;
shadowStart.addEventListener('click', async () => {
  if (shadowBusy) return;
  if (agent.value !== 'external') { shadowStatus.textContent='Select Your local HTTP agent above to record its decisions.'; return; }
  shadowBusy=true; shadowStart.disabled=true; shadowRecord=null; shadowResult.innerHTML='';
  shadowStatus.textContent='Recording the agent through the mock gateway…';
  try {
    const selectedProtocol=Number(document.querySelector('#protocol').value);
    if (!state.run || (state.run.data.protocolVersion || 2) !== selectedProtocol || state.run.data.agent !== 'external' || !state.permission?.create_refund?.allowed) throw new Error('Open a passing connected-agent run for this protocol and request its mock permission first.');
    const data=await request('/api/upgrade/shadow-session',{action:'record-agent',endpoint:endpoint.value.trim(),protocolVersion:selectedProtocol,batchId:state.run.data.id});
    shadowRecord=data;
    const calls=(data.observed || []).map((item,index)=>`<li><span class="label">Decision ${index+1} · ${escape(item.proposal?.name)}</span><p>${escape(item.proposal?.message || '')}</p><p>${item.status === 'recorded' ? (item.result?.blocked ? `Gateway blocked: ${escape(item.result.error)}` : item.result?.ok ? `Mock gateway returned ${escape(item.result.status || 'success')}${item.result.body?.status ? ` · ${escape(item.result.body.status)}` : ''}` : `Mock gateway result: ${escape(item.result?.error || 'unverified')}`) : escape(item.reason || 'Unverified')}</p><details><summary>Inspect decision and gateway result</summary><pre>${json(item)}</pre></details></li>`).join('');
    shadowResult.innerHTML=`<h3>${data.status === 'completed' ? 'Session recorded' : 'Session unverified'}</h3><p>Session ${escape(data.sessionId)} · ${escape(data.endpoint)} · mock only${data.batchId ? ` · permission from batch ${escape(data.batchId)}. The endpoint is not authenticated as the evaluated agent.` : ' · demonstration permission'}</p>${data.reason ? `<p>${escape(data.reason)}</p>` : ''}<ul class="timeline">${calls || '<li>No gateway calls were recorded.</li>'}</ul>${data.finalMessage ? `<p>Agent: ${escape(data.finalMessage)}</p>` : ''}${data.status === 'completed' ? '<button type="button" class="secondary" id="shadow-promote">Promote and rerun gateway calls</button>' : ''}<div id="shadow-replay"></div>`;
    shadowStatus.textContent=data.status === 'completed' ? 'Agent session recorded.' : 'The agent session did not complete; no regression was issued.';
  } catch(error) { shadowStatus.textContent=`Could not record the agent session: ${error.message}`; }
  finally { shadowBusy=false; shadowStart.disabled=false; }
});
shadowResult.addEventListener('click',async event=>{
  const button=event.target.closest('#shadow-promote');
  if (!button || shadowBusy || !shadowRecord) return;
  shadowBusy=true; button.disabled=true; shadowStatus.textContent='Promoting and replaying recorded mock gateway calls…';
  try {
    const data=await request('/api/upgrade/shadow-session',{action:'promote-agent',id:shadowRecord.sessionId});
    const comparison=data.replay?.comparison;
    const outcome=comparison?.status === 'matched' ? `Matched across ${comparison.callsCompared} calls.` : comparison?.status === 'changed' ? `Changed: ${comparison.differences.length} call outcomes differ.` : 'Replay outcome is unverified.';
    document.querySelector('#shadow-replay').innerHTML=`<div class="trace"><strong>Mock regression · ${escape(comparison?.status || 'unverified')}</strong><p>${escape(outcome)} The replay repeats recorded calls; it does not rerun the agent or contact PayPal.</p><details><summary>Inspect regression and replay</summary><pre>${json(data)}</pre></details><button type="button" class="secondary" id="shadow-rerun">Rerun the connected agent</button>${shadowRecord.protocolVersion === 3 ? '<button type="button" class="secondary" id="shadow-export">Export agent regression</button>' : ''}<p>Uses the current local agent URL and a fresh mock with the same batch permission and scenario. The endpoint is not authenticated.</p><div id="shadow-agent-rerun"></div></div>`;
    shadowStatus.textContent='Mock regression replay completed.';
  } catch(error) { shadowStatus.textContent=`Regression replay unverified: ${error.message}`; }
  finally { shadowBusy=false; button.disabled=false; }
});
shadowResult.addEventListener('click',async event=>{
  const button=event.target.closest('#shadow-rerun');
  if (!button || shadowBusy || !shadowRecord) return;
  shadowBusy=true; button.disabled=true; shadowStatus.textContent='Rerunning the connected agent against a fresh mock…';
  try {
    const data=await request('/api/upgrade/shadow-session',{action:'rerun-agent',id:shadowRecord.sessionId,endpoint:endpoint.value.trim()});
    const outcome=data.status === 'matched' ? `The agent made the same calls with the same mock outcomes across ${data.callsCompared} calls.` : data.status === 'changed' ? `${data.differences.length} call positions changed.` : data.reason || 'The agent rerun was incomplete.';
    document.querySelector('#shadow-agent-rerun').innerHTML=`<div class="trace"><strong>Agent rerun · ${escape(data.status || 'unverified')}</strong><p>${escape(outcome)} This is a fresh mock, not PayPal. The endpoint is not authenticated.</p><details><summary>Inspect agent rerun</summary><pre>${json(data)}</pre></details></div>`;
    shadowStatus.textContent=data.status === 'unverified' ? 'Agent rerun unverified.' : 'Agent rerun completed.';
  } catch(error) { shadowStatus.textContent=`Agent rerun unverified: ${error.message}`; }
  finally { shadowBusy=false; button.disabled=false; }
});
shadowResult.addEventListener('click',async event=>{
  const button=event.target.closest('#shadow-export');
  if (!button || shadowBusy || !shadowRecord) return;
  shadowBusy=true; button.disabled=true; shadowStatus.textContent='Preparing mock regression export…';
  try {
    const data=await request('/api/upgrade/shadow-session',{action:'export-agent',id:shadowRecord.sessionId});
    const url=URL.createObjectURL(new Blob([JSON.stringify(data.artifact,null,2)],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url; link.download='still-agent-regression.json'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000); shadowStatus.textContent='Mock regression downloaded. Run it with still regression.';
  } catch(error) { shadowStatus.textContent=`Could not export regression: ${error.message}`; }
  finally { shadowBusy=false; button.disabled=false; }
});
modeChanged();
void loadRecentBatches();
