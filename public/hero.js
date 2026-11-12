const form = document.querySelector('#run-form');
const results = document.querySelector('#results');
const sandbox = document.querySelector('#sandbox');
const status = document.querySelector('#status');
const runButton = document.querySelector('#run');
const agent = document.querySelector('#agent');
const endpoint = document.querySelector('#endpoint');
const policy = document.querySelector('#policy');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => escape(JSON.stringify(value ?? null, null, 2));
const state = { run: null, selectedCluster: null, selectedTrial: null, page: null, pageError: null, permission: null, permissionUrl: null, replay: null, explanation: null, sandbox: null, busy: false };
const agentNames = { external: 'Local HTTP agent', buggy: 'Scripted buggy example', safe: 'Scripted corrected example' };

async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function sourceLink(url, label) {
  try { const parsed = new URL(url); if (parsed.protocol === 'https:') return `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`; } catch {}
  return '';
}
function provenance(source) {
  if (!source) return '<p>Persona source is unavailable for this trace.</p>';
  return `<p><strong>${escape(source.dataset)}</strong><br>Record ${escape(source.recordId)}<br>${escape(source.license)}</p><p>${sourceLink(source.url, 'Open source record')} ${sourceLink(source.evidenceUrl, 'Source evidence')}</p>`;
}
function eventSummary(event) {
  if (event.type === 'customer') return { label:'Customer', text:event.text };
  if (event.type === 'agent_message' || event.type === 'agent') return event.text ? { label:'Agent', text:event.text } : null;
  if (event.type === 'error') return { label:'Error', text:event.message || 'The agent did not complete.' };
  if (event.type === 'tool_call') {
    const args = event.arguments || {};
    const amount = args.amount == null ? '' : ` · ${args.amount} ${args.currency || ''}`;
    return { label:'Tool call', text:`${event.tool || 'Unknown tool'}${amount}` };
  }
  if (event.type === 'tool_result') {
    const response = event.response || {};
    if (event.tool === 'get_order') return { label:'Mock order', text:`Payment ${response.payment?.status || 'unknown'} · approved return ${response.approvedReturn ?? 'unknown'} ${response.payment?.amount?.currency_code || ''}` };
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
    return `<li><span class="label">${escape(summary.label)} · ${escape(event.id)}</span><p>${escape(summary.text)}</p>${event.type === 'tool_call' || event.type === 'tool_result' ? `<details><summary>Inspect ${event.type === 'tool_call' ? 'arguments' : 'response'}</summary><pre>${json(event.type === 'tool_call' ? event.arguments : event.response)}</pre></details>` : ''}</li>`;
  }).join('');
  return `<div id="trace" class="card"><div class="label">${escape(label)} · mock</div><h3>Trace for ${escape(trace.personaId)} · trial ${escape(trace.trial)}</h3><p class="hint">These events come from the selected mock trial, not PayPal sandbox.</p><ul class="timeline">${events || '<li>No events recorded.</li>'}</ul><h3>Rule evidence</h3>${checks.map(check=>`<div class="rule"><strong class="${check.status === 'pass' ? 'good' : 'bad'}">${escape(String(check.status || 'unverified').toUpperCase())}</strong> · ${escape(check.id)}<p>${escape(check.evidence)}</p></div>`).join('') || '<p>Rule evidence is unavailable.</p>'}<details><summary>Persona provenance</summary>${provenance(source)}</details><details><summary>Complete trace</summary><pre>${json(trace)}</pre></details></div>`;
}
function clearPermission() {
  if (state.permissionUrl) URL.revokeObjectURL(state.permissionUrl);
  state.permission = null;
  state.permissionUrl = null;
  state.replay = null;
}
function renderResults() {
  if (!state.run) { results.innerHTML='<p>Run an agent to see its decisions, rule evidence, and persona source here.</p>'; return; }
  const { data, config } = state.run;
  const total = data.personaCount * data.trials;
  const passed = data.counts.pass === total && data.counts.fail === 0 && data.counts.unverified === 0;
  const verdict = data.counts.fail > 0 ? 'Failed' : passed ? 'Passed' : 'Unverified';
  const cluster = data.failureClusters.find(item => item.id === state.selectedCluster);
  const selected = state.selectedTrial?.trial || (cluster ? cluster.example : data.exampleTrial);
  const scope = config.agent === 'external' ? `${agentNames[config.agent]} · ${config.endpoint}` : agentNames[config.agent];
  const permissionEligible = passed && !config.policy;
  const clusters = data.failureClusters.map(item=>`<div class="row"><span><strong>${escape(item.label)}</strong><br><span class="hint">${Number(item.count).toLocaleString()} trial${item.count === 1 ? '' : 's'}</span></span><button type="button" class="secondary" data-action="cluster" data-id="${escape(item.id)}">Inspect example</button></div>`).join('');
  let browser = '<p>Trial list is unavailable.</p><button type="button" class="secondary" data-action="page" data-offset="0">Load trials</button>';
  if (state.page) {
    const page=state.page;
    const rows=page.items.map(item=>`<div class="row"><span><strong>${escape(item.status.toUpperCase())}</strong> · ${escape(item.personaId)} · trial ${escape(item.trial)}<br><span class="hint">${escape(item.provenance?.persona?.dataset || 'Source unavailable')}</span></span><button type="button" class="secondary" data-action="trial" data-index="${Number(item.index)}">Inspect trial</button></div>`).join('');
    browser=`<p>Showing ${page.total ? page.offset+1 : 0}–${Math.min(page.offset+page.items.length,page.total)} of ${Number(page.total).toLocaleString()} trials. Select any trial to inspect its decisions and source.</p><div class="rows">${rows || '<p>No trials on this page.</p>'}</div><div class="actions"><button type="button" class="secondary" data-action="page" data-offset="${Math.max(0,page.offset-20)}" ${page.offset === 0 ? 'disabled' : ''}>Previous 20</button><button type="button" class="secondary" data-action="page" data-offset="${page.offset+20}" ${page.offset+page.items.length >= page.total ? 'disabled' : ''}>Next 20</button></div>`;
  }
  if (state.pageError) browser += `<p class="status">${escape(state.pageError)}</p>`;
  let access = '';
  if (config.policy) access = '<p>Additional instructions are not automatically checked. This run cannot earn a permission.</p>';
  else if (!passed) access = '<p>A permission requires every trial to pass with complete evidence.</p>';
  else if (!state.permission) access = '<p>A fully passing run can request a USD mock-only permission. A grant also requires completed USD refund evidence.</p><button type="button" data-action="permission">Request mock permission</button>';
  else if (!state.permission.create_refund?.allowed) access = `<div class="trace"><strong>No permission issued</strong><p>${escape(state.permission.reason || 'Insufficient evidence for a grant.')}</p></div>`;
  else { const p=state.permission; access = `<div class="trace"><strong>Mock refunds up to ${escape(p.create_refund.maxPerOrder)} ${escape(p.create_refund.currency)} per order</strong><p>${Number(p.evidence.personaCount).toLocaleString()} observed personas · ${Number(p.evidence.trialCount).toLocaleString()} trials. ${escape(p.evidence.coverage)}</p><p>Dispute check, approved amount, identity match, and stable decision ID are required. No production access is granted.</p></div><div class="actions"><a class="button secondary" href="${escape(state.permissionUrl)}" download="still-permission.json">Download permission JSON</a><button type="button" data-action="gateway">Try mock gateway</button></div>`; }
  let gateway = '';
  if (state.replay) { const calls = state.replay.events.filter(event => event.name === 'create_refund'); gateway = `<div class="card"><div class="label">Mock gateway replay</div><h3>Permission enforcement</h3>${calls.map((call,index)=>`<p><strong>${index === 0 ? 'Over limit' : 'Eligible'} · ${escape(call.arguments?.amount?.value)} ${escape(call.arguments?.amount?.currency_code)}</strong> · ${call.result?.blocked ? 'Blocked' : call.result?.ok ? 'Allowed' : 'Unverified'}</p>`).join('')}<p class="hint">The gateway uses an isolated mock. No PayPal payment was made.</p><details><summary>Inspect gateway events</summary><pre>${json(state.replay)}</pre></details></div>`; }
  const explanation = cluster ? `<div class="actions"><button type="button" class="secondary" data-action="explain">Explain this failure with AI</button></div>${state.explanation ? `<p>${escape(state.explanation)}</p>` : '<p class="hint">AI explains evidence; deterministic checks decide the verdict. Model access is required.</p>'}` : '';
  results.innerHTML = `<div class="card"><span class="pill">${escape(verdict)} · mock</span><h3>${escape(scope)}</h3><p>${Number(data.personaCount).toLocaleString()} personas × ${Number(data.trials)} trials · ${escape(config.profile === 'sandbox-test-card' ? 'Observed sandbox test-card profile' : 'Completed-refund profile')}</p><p class="hint">Batch ${escape(data.id)}. Results belong to the settings used for this run, even if you change the form above. ${config.agent === 'external' ? 'The host identifies this agent by its endpoint; the endpoint does not authenticate the agent.' : 'This is a built-in scripted example.'}</p><div class="metrics"><div class="metric"><span>pass@1 · per trial</span><strong>${(Number(data.passAt1)*100).toFixed(1)}%</strong></div><div class="metric"><span>pass^${Number(data.trials)} · passed every trial</span><strong>${(Number(data.passAllTrials)*100).toFixed(1)}%</strong></div></div><p>${Number(data.counts.pass).toLocaleString()} passed · ${Number(data.counts.fail).toLocaleString()} failed · ${Number(data.counts.unverified).toLocaleString()} unverified</p><p class="hint">Unverified trials do not count as passes. These are mock results, not estimates of real-world reliability.</p>${data.effectivePolicy ? `<details><summary>Agent instructions used for this run</summary><pre>${escape(data.effectivePolicy)}</pre></details>` : ''}<h3>Failure map</h3><p class="hint">A trial can appear in multiple groups. Select a group to inspect its example.</p><div class="rows">${clusters || '<p>No observed failure groups.</p>'}</div><div class="actions"><button type="button" class="secondary" data-action="example">Inspect example trial</button><a href="#connect-heading">Change or rerun agent ↑</a></div><details id="trial-browser"><summary>Browse all trials</summary>${browser}</details></div>${traceView(selected, state.selectedTrial ? `Trial ${state.selectedTrial.index+1}` : cluster ? cluster.label : 'Example trial')}${explanation}<div class="card"><div class="label">Earned permission</div><h3>Scope access to observed evidence.</h3>${access}</div>${gateway}`;
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
  document.querySelector('#policy-label').hidden = !external;
  document.querySelector('#external-help').hidden = !external;
  endpoint.required = external;
}
agent.addEventListener('change', modeChanged);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !form.reportValidity()) return;
  const values = new FormData(form);
  const config = { agent:values.get('agent'), endpoint:String(values.get('endpoint') || '').trim(), personas:Number(values.get('personas')), trials:Number(values.get('trials')), concurrency:Number(values.get('concurrency')), profile:values.get('profile'), policy:String(values.get('policy') || '').trim() };
  if (config.agent !== 'external') { config.endpoint=''; config.policy=''; }
  const body = { agent:config.agent, personas:config.personas, trials:config.trials, concurrency:config.concurrency, mockProfile:config.profile };
  if (config.agent === 'external') { body.endpoint=config.endpoint; if (config.policy) body.policy=config.policy; }
  state.busy=true; runButton.disabled=true;
  status.textContent='Running mock trials. The previous result stays visible until this run finishes.';
  try {
    const data = await request('/api/upgrade/batch',body);
    clearPermission(); state.run={data,config}; state.selectedCluster=null; state.selectedTrial=null; state.page=null; state.pageError=null; state.explanation=null;
    try { state.page=await request(`/api/upgrade/batches/${encodeURIComponent(data.id)}/trials?offset=0&limit=20`); } catch(error) { state.pageError=`Could not load trials: ${error.message}`; }
    renderResults();
    status.textContent=`Mock run ${data.id} finished. Inspect its results below.`;
    document.querySelector('#results-heading').scrollIntoView({block:'start'});
  } catch (error) { status.textContent=`Run failed to start or complete: ${error.message} The previous result, if any, is unchanged.`; }
  finally { state.busy=false; runButton.disabled=false; }
});
results.addEventListener('click', async event => {
  const button=event.target.closest('button[data-action]'); if (!button || !state.run || state.busy) return;
  const action=button.dataset.action;
  if (action === 'cluster') { state.selectedCluster=button.dataset.id; state.selectedTrial=null; state.explanation=null; renderResults(); document.querySelector('#trace')?.scrollIntoView({block:'start'}); return; }
  if (action === 'example') { state.selectedCluster=null; state.selectedTrial=null; state.explanation=null; renderResults(); document.querySelector('#trace')?.scrollIntoView({block:'start'}); return; }
  const runId=state.run.data.id;
  state.busy=true; button.disabled=true; status.textContent='Working…';
  try {
    if (action === 'page') { state.page=await request(`/api/upgrade/batches/${encodeURIComponent(runId)}/trials?offset=${Number(button.dataset.offset)}&limit=20`); state.pageError=null; }
    if (action === 'trial') { const data=await request(`/api/upgrade/batches/${encodeURIComponent(runId)}/trials/${Number(button.dataset.index)}`); state.selectedTrial=data; state.selectedCluster=null; state.explanation=null; }
    if (action === 'permission') { const data=await request('/api/upgrade/permission',{batchId:runId}); clearPermission(); state.permission=data.permission; if (data.permission?.create_refund?.allowed) state.permissionUrl=URL.createObjectURL(new Blob([JSON.stringify(data.permission,null,2)],{type:'application/json'})); }
    if (action === 'gateway') state.replay=await request('/api/upgrade/permission-replay',{batchId:runId});
    if (action === 'explain') { const data=await request('/api/upgrade/explain',{batchId:runId,clusterId:state.selectedCluster}); state.explanation=`AI explanation of mock evidence: ${data.explanation}`; }
    renderResults(); status.textContent=action === 'gateway' ? 'Mock gateway replay completed.' : action === 'permission' ? 'Permission request completed.' : action === 'explain' ? 'Explanation generated.' : 'Trial evidence loaded.'; if (action === 'trial') document.querySelector('#trace')?.scrollIntoView({block:'start'}); if (action === 'page') { const details=results.querySelector('#trial-browser'); if (details) details.open=true; }
  } catch (error) { status.textContent=error.message; button.disabled=false; results.querySelectorAll('.action-error').forEach(item=>item.remove()); const message=document.createElement('p'); message.className='status action-error'; message.setAttribute('role','status'); message.textContent=error.message; button.after(message); }
  finally { state.busy=false; }
});
sandbox.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action="sandbox"]'); if (!button) return;
  button.disabled=true;
  try { state.sandbox=await request('/sandbox-retry.json'); renderSandbox(); }
  catch(error) { button.disabled=false; status.textContent=`Saved sandbox evidence unavailable: ${error.message}`; const message=document.createElement('p'); message.className='status'; message.setAttribute('role','status'); message.textContent=`Saved sandbox evidence unavailable: ${error.message}`; button.after(message); }
});
modeChanged();
