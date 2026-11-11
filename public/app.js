const landing = document.querySelector('#landing');
const workspace = document.querySelector('#workspace');
const result = document.querySelector('#result');
const runButton = document.querySelector('#run');
const policyInput = document.querySelector('#policy');
const historyList = document.querySelector('#history-list');
const scenarioSelect = document.querySelector('#scenario-select');
const agentEndpoint = document.querySelector('#agent-endpoint');
const agentConnection = document.querySelector('#agent-connection');
const choiceButtons = [...document.querySelectorAll('[data-agent]')];
const state = { agent: 'buggy', phase: 'idle', orderId: null, captureId: null, response: null, history: [], scenarios: [], scenario: null };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function displayText(value) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
}

async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) { const error = new Error(typeof data.error === 'string' ? data.error : data.message || `Request failed (${response.status}).`); error.checkout = data.checkout; throw error; }
  return data;
}

function setPhase(phase) {
  state.phase = phase;
  const busy = ['creating', 'capturing', 'running', 'checking'].includes(phase);
  const locked = busy || ['approval', 'captured', 'unknown'].includes(phase);
  document.querySelectorAll('#rule-options input').forEach(input => { input.disabled = locked; });
  runButton.disabled = busy || phase === 'unknown';
  policyInput.disabled = locked;
  scenarioSelect.disabled = locked;
  agentEndpoint.disabled = locked;
  choiceButtons.forEach(button => { button.disabled = locked; });
  historyList.querySelectorAll('button').forEach(button => { button.disabled = locked; });
}

function message(title, body, action = '') {
  result.innerHTML = `<div class="empty"><div class="empty-mark">✳</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>${action}</div>`;
}

function entries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function displayResults(data) {
  const verdict = String(data.status || 'inconclusive').toLowerCase();
  const list = Array.isArray(data.events) ? data.events : [];
  const checks = Array.isArray(data.checks) ? data.checks : entries(data.checks).map(([name, value]) => ({name, ...(typeof value === 'object' && value !== null ? value : {status: value})}));
  const enabledChecks = checks.filter(check => String(check.status ?? check.result ?? '').toLowerCase() !== 'disabled');
  const pass = ['pass', 'passed'].includes(verdict) && list.length > 0 && enabledChecks.length > 0 && enabledChecks.every(check => ['pass', 'passed'].includes(String(check.status ?? check.result ?? '').toLowerCase()));
  const fail = ['fail', 'failed'].includes(verdict);
  const label = pass ? 'PASSED' : fail ? 'VIOLATION' : 'INCONCLUSIVE';
  const eventRows = list.map((event, index) => {
    const type = event.type || event.kind || event.role || 'event';
    const title = event.title || event.text || event.message || event.content || event.tool || event.name || type;
    const detail = event.detail || event.description || event.summary;
    const extras = Object.fromEntries(entries(event).filter(([key]) => !['type','kind','role','title','text','message','content','name','detail','description','summary'].includes(key)));
    return `<div class="row"><span class="n">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(typeof title === 'string' ? title : JSON.stringify(title))}</strong>${detail ? `<p>${escapeHtml(typeof detail === 'string' ? detail : JSON.stringify(detail))}</p>` : ''}${Object.keys(extras).length ? `<details class="details"><summary>VIEW EVENT DATA +</summary><pre>${escapeHtml(JSON.stringify(extras, null, 2))}</pre></details>` : ''}</div><span class="status">${escapeHtml(String(type).toUpperCase())}</span></div>`;
  }).join('');
  const checkRows = checks.map(check => `<div class="row"><span class="n">•</span><div><strong>${escapeHtml(check.label || check.name || check.rule || check.id || 'Policy check')}</strong><p>${escapeHtml(displayText(check.reason || check.evidence || check.message))}</p></div><span class="status">${escapeHtml(String(check.status ?? check.result ?? 'inconclusive').toUpperCase())}</span></div>`).join('');
  const agent = data.agent || state.agent;
  const agentName = agent === 'sandbox-earned-permission' ? 'Sandbox permission demo' : agent === 'safe' ? 'Corrected agent' : agent === 'external' ? `Your agent${data.metadata?.agent?.origin ? ` (${data.metadata.agent.origin})` : ''}` : 'Buggy agent';
  const scenarioName = data.scenarioId === 'sandbox-earned-permission' ? 'Earned sandbox permission' : state.scenarios.find(item => item.id === data.scenarioId)?.title || 'Repeated cancellation request';
  result.innerHTML = `<div class="result-head"><div><div class="mono" style="color:#85857b">02 / TEST RUN · ${escapeHtml(scenarioName)}</div><h3>${escapeHtml(agentName)}</h3></div><span class="result-tag ${pass ? 'pass' : ''}">${escapeHtml(label)}</span></div>${data.storageWarning ? `<div class="storage-warning" role="alert"><strong>Run was not saved.</strong> ${escapeHtml(data.storageWarning)}</div>` : ''}<div class="rows">${eventRows || '<p>No events were recorded.</p>'}</div><div class="mono" style="margin-top:22px;color:#85857b">POLICY CHECKS</div><div class="rows">${checkRows || '<p>No policy checks were returned. The run cannot be verified.</p>'}</div>${data.explanation ? `<div class="notice"><strong>${data.metadata ? 'AI explanation' : 'AI explanation from an older run (verify against the trace)'}</strong><p>${escapeHtml(typeof data.explanation === 'string' ? data.explanation : JSON.stringify(data.explanation))}</p></div>` : ''}${data.metadata ? `<details class="details"><summary>RUN CONFIGURATION +</summary><pre>${escapeHtml(JSON.stringify(data.metadata, null, 2))}</pre></details>` : '<p class="notice">Configuration details were not recorded for this older run.</p>'}<div class="notice mono">TEST RUN / PROVIDER RESPONSES</div>`;
}

async function loadHistory() {
  historyList.textContent = 'Loading saved runs…';
  try {
    const data = await request('/api/runs');
    if (!Array.isArray(data.runs)) throw new Error('Run history response was incomplete.');
    state.history = data.runs;
    if (!state.history.length) {
      historyList.textContent = 'No saved runs yet. Completed runs will appear here.';
      return;
    }
    historyList.innerHTML = state.history.map(run => {
      const when = new Date(run.createdAt);
      const date = Number.isNaN(when.valueOf()) ? 'Date unavailable' : when.toLocaleString();
      const name = run.agent === 'sandbox-earned-permission' ? 'Sandbox permission demo' : run.agent === 'safe' ? 'Corrected agent' : run.agent === 'buggy' ? 'Buggy agent' : `Your agent${run.agentOrigin ? ` (${run.agentOrigin})` : ''}`;
      const scenarioName = run.scenarioId === 'sandbox-earned-permission' ? 'Earned sandbox permission' : state.scenarios.find(item => item.id === run.scenarioId)?.title || 'Repeated cancellation request';
      return `<button class="history-item" data-run-id="${escapeHtml(run.id)}"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(scenarioName)} · ${escapeHtml(date)}</small></span><span class="mono">${escapeHtml(String(run.status || 'inconclusive').toUpperCase())} &nbsp; ↗</span></button>`;
    }).join('');
    setPhase(state.phase);
  } catch (error) {
    historyList.textContent = `Could not load saved runs. ${error.message}`;
  }
}

historyList.addEventListener('click', async event => {
  const button = event.target.closest('[data-run-id]');
  if (!button || button.disabled) return;
  const id = button.dataset.runId;
  const status = document.querySelector('#history-status');
  button.disabled = true;
  status.textContent = 'Loading run…';
  try {
    const data = await request(`/api/runs/${encodeURIComponent(id)}`);
    if (['creating', 'approval', 'capturing', 'captured', 'running'].includes(state.phase)) {
      status.textContent = 'Finish the current payment before opening a saved run.';
      return;
    }
    status.textContent = '';
    displayResults(data);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    status.textContent = `Could not open the saved run. ${error.message}`;
  } finally {
    setPhase(state.phase);
  }
});

document.querySelector('#history-refresh').onclick = loadHistory;

document.querySelectorAll('.open-app').forEach(button => button.onclick = () => {
  landing.hidden = true; workspace.hidden = false; window.scrollTo(0, 0);
  loadHistory();
});
document.querySelector('#back').onclick = () => { workspace.hidden = true; landing.hidden = false; window.scrollTo(0, 0); };
choiceButtons.forEach(button => button.onclick = () => {
  state.agent = button.dataset.agent;
  agentConnection.hidden = state.agent !== 'external';
  choiceButtons.forEach(choice => choice.classList.toggle('selected', choice === button));
});

function saveCheckoutConfig() {
  sessionStorage.setItem('still-checkout-config', JSON.stringify({ scenarioId: state.scenario.id, agent: state.agent, endpoint: agentEndpoint.value, policy: policyInput.value, rules: Object.fromEntries([...document.querySelectorAll('[data-rule]')].map(input => [input.dataset.rule, input.checked])) }));
}

function restoreCheckoutConfig() {
  try {
    const config = JSON.parse(sessionStorage.getItem('still-checkout-config'));
    if (!config) return;
    if (state.scenarios.some(item => item.id === config.scenarioId)) { scenarioSelect.value = config.scenarioId; chooseScenario(); }
    const selected = choiceButtons.find(button => button.dataset.agent === config.agent);
    if (selected) selected.click();
    agentEndpoint.value = typeof config.endpoint === 'string' ? config.endpoint : agentEndpoint.value;
    policyInput.value = typeof config.policy === 'string' ? config.policy : '';
    document.querySelectorAll('[data-rule]').forEach(input => { if (typeof config.rules?.[input.dataset.rule] === 'boolean') input.checked = config.rules[input.dataset.rule]; });
  } catch {}
}

function showCheckout(checkout) {
  if (!checkout || checkout.state === 'spent') { state.orderId = null; state.captureId = null; chooseScenario(); return; }
  state.orderId = checkout.orderId; state.captureId = checkout.captureId;
  if (checkout.state === 'captured') {
    setPhase('captured'); runButton.innerHTML = 'Run the agent <span>↗</span>';
    message('Payment captured', `Capture ${checkout.captureId} is ready. Run the selected agent against it.`); return;
  }
  if (checkout.state === 'approval_required') {
    setPhase('approval'); runButton.innerHTML = 'Capture approved order <span>↗</span>';
    let link = '';
    try { const url = new URL(checkout.approvalUrl); if (url.protocol === 'https:' && ['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(url.hostname)) link = `<p><a class="primary" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">OPEN PAYPAL SANDBOX ↗</a></p>`; } catch {}
    message('Approve the sandbox payment', 'Approve the sandbox payment and return to capture it. You can also start over before capture.', `${link}<button id="abandon-checkout">Start over</button>`);
    document.querySelector('#abandon-checkout').onclick = async () => {
      setPhase('checking');
      try { await request(`/api/orders/${encodeURIComponent(state.orderId)}/abandon`, {}); sessionStorage.removeItem('still-checkout-config'); state.orderId = null; state.captureId = null; chooseScenario(); }
      catch (error) { if (error.checkout) showCheckout(error.checkout); else showCheckout(checkout); message('Could not start over', error.message, '<button id="check-checkout">Check PayPal status</button>'); document.querySelector('#check-checkout').onclick = reconcileCheckout; }
    }; return;
  }
  setPhase('unknown'); runButton.disabled = true;
  message('Checkout needs attention', checkout.error || 'The payment outcome is not yet confirmed. Check PayPal status before continuing.', checkout.orderId ? '<button id="check-checkout">Check PayPal status</button>' : '');
  const check = document.querySelector('#check-checkout'); if (check) check.onclick = reconcileCheckout;
}

async function reconcileCheckout() {
  setPhase('checking');
  try { const data = await request(`/api/orders/${encodeURIComponent(state.orderId)}/reconcile`, {}); showCheckout(data.checkout); }
  catch (error) { showCheckout(error.checkout || { state: 'capture_unknown', orderId: state.orderId, error: error.message }); }
}

function chooseScenario() {
  state.scenario = state.scenarios.find(item => item.id === scenarioSelect.value);
  if (!state.scenario) return;
  policyInput.value = '';
  const applicable = ['captured'];
  if (['duplicate', 'over_refund', 'unpaid_refund'].includes(state.scenario.expected)) applicable.push('cancellation');
  if (state.scenario.payment === 'captured') applicable.push('refund_limit');
  if (state.scenario.expected === 'duplicate') applicable.push('duplicate');
  if (state.scenario.expected === 'partial_return') applicable.push('return_amount');
  if (state.scenario.expected === 'failed_fulfillment') applicable.push('fulfillment');
  const labels = { captured: 'Refund only captured payments', cancellation: 'Cancel the requested order', refund_limit: 'Stay within the captured amount and currency', duplicate: 'Never refund the same cancellation twice', return_amount: 'Refund only the approved return amount', fulfillment: 'Ship only after payment is captured' };
  document.querySelector('#rule-options').innerHTML = applicable.map(key => `<label style="display:block;margin:10px 0;font-size:12px"><input type="checkbox" data-rule="${key}" checked> ${labels[key]}</label>`).join('');
  document.querySelector('.app-heading h1').textContent = state.scenario.title;
  document.querySelector('.app-heading p').textContent = state.scenario.payment === 'captured' ? 'Use a fresh sandbox capture for each run.' : 'Use a simulated failed payment to check agent decisions.';
  document.querySelector('.runner-left > .notice').textContent = state.scenario.payment === 'captured' ? 'Each run needs a new sandbox payment.' : 'The failed payment is simulated.';
  document.querySelector('.scenario h2').textContent = state.scenario.title;
  const items = state.scenario.basket.map(item => `${item.quantity} × ${item.item}`).join(', ');
  document.querySelector('.scenario p').textContent = `${state.scenario.description} Basket: ${items}. ${state.scenario.provenance}`;
  document.querySelector('.facts').innerHTML = `<div class="fact"><span class="mono">ORDER</span> <strong>${escapeHtml(state.scenario.amount)} ${escapeHtml(state.scenario.currency)}</strong></div> <div class="fact"><span class="mono">PAYMENT</span> <strong>${state.scenario.payment === 'captured' ? 'PayPal sandbox' : 'Simulated failure'}</strong></div>`;
  setPhase('idle');
  runButton.innerHTML = state.scenario.payment === 'captured' ? 'Create sandbox order <span>↗</span>' : 'Run the agent <span>↗</span>';
  message('Ready to run', state.scenario.payment === 'captured' ? 'Create and approve a fresh sandbox payment for this scenario.' : 'This scenario uses a synthetic failed payment. No PayPal transaction is created.');
}
scenarioSelect.onchange = chooseScenario;
request('/api/scenarios').then(async data => {
  state.scenarios = data.scenarios;
  scenarioSelect.innerHTML = state.scenarios.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
  chooseScenario();
  try { const checkout = (await request('/api/checkout')).checkout; if (checkout && checkout.state !== 'spent') { restoreCheckoutConfig(); showCheckout(checkout); } } catch {}
}).catch(() => { scenarioSelect.innerHTML = '<option>Scenarios unavailable</option>'; runButton.disabled = true; });

runButton.onclick = async () => {
  if (state.phase === 'approval') {
    setPhase('capturing');
    message('Capturing the payment', 'Checking the approved sandbox order with PayPal.');
    try {
      const data = await request(`/api/orders/${encodeURIComponent(state.orderId)}/capture`, {});
      showCheckout(data.checkout);
    } catch (error) {
      if (error.checkout) showCheckout(error.checkout);
      else showCheckout({ state: 'capture_unknown', orderId: state.orderId, error: 'Capture outcome is unknown. Check PayPal status before proceeding.' });
    }
    return;
  }
  if (state.phase === 'captured' || (state.scenario?.payment === 'failed' && !['running', 'approval'].includes(state.phase))) {
    const policy = policyInput.value.trim();
    const ruleSettings = Object.fromEntries([...document.querySelectorAll('[data-rule]')].map(input => [input.dataset.rule, input.checked]));
    if (!Object.values(ruleSettings).some(Boolean)) { message('Choose a rule', 'Enable at least one rule before running the agent.'); return; }
    setPhase('running');
    runButton.innerHTML = 'Running agent <span>↗</span>';
    message('Agent is working', state.scenario.payment === 'captured' ? 'Waiting for agent decisions and PayPal sandbox responses.' : 'Waiting for agent decisions against the simulated failed payment.');
    try {
      const data = await request('/api/runs', { captureId: state.captureId, agent: state.agent, agentEndpoint: agentEndpoint.value, scenarioId: state.scenario.id, policy, ruleSettings });
      state.response = data;
      sessionStorage.removeItem('still-checkout-config');
      setPhase('complete');
      runButton.innerHTML = state.scenario.payment === 'captured' ? 'Create another order <span>↗</span>' : 'Run again <span>↗</span>';
      displayResults(data);
      loadHistory();
    } catch (error) {
      if (state.scenario.payment === 'captured') {
        try {
          const checkout = (await request('/api/checkout')).checkout;
          if (checkout && checkout.state !== 'spent') { showCheckout(checkout); const note = document.createElement('p'); note.textContent = `Run not started: ${error.message}`; result.append(note); return; }
        } catch { showCheckout({ state: 'capture_unknown', orderId: state.orderId, error: 'Could not determine whether the run used the capture. Check PayPal status before proceeding.' }); return; }
      }
      setPhase('failed');
      runButton.innerHTML = state.scenario.payment === 'captured' ? 'Create another order <span>↗</span>' : 'Run again <span>↗</span>';
      message('Run not verified', error.message);
    }
    return;
  }
  saveCheckoutConfig();
  setPhase('creating');
  runButton.innerHTML = 'Creating order <span>↗</span>';
  message('Preparing a sandbox order', 'Creating a fresh $50 payment for the selected agent.');
  try {
    const data = await request('/api/orders', {});
    showCheckout(data.checkout);
  } catch (error) {
    if (error.checkout) showCheckout(error.checkout);
    else { try { showCheckout((await request('/api/checkout')).checkout); } catch { showCheckout({ state: 'create_unknown', error: 'Order creation outcome is unknown. Do not create another order in this session.' }); } }
  }
};

request('/api/status').then(data => {
  const status = document.querySelector('#service-status');
  if (status) status.textContent = data.ready === true ? 'SANDBOX AND CODEX READY' : data.modelReady ? 'CODEX READY · PAYPAL SETUP REQUIRED' : data.paypalReady ? 'PAYPAL READY · CODEX SIGN-IN REQUIRED' : 'PAYPAL AND CODEX SETUP REQUIRED';
  if (status && !data.paypalReady) {
    const setup = document.createElement('a');
    setup.href = '/setup';
    setup.textContent = ' · CONNECT SANDBOX';
    setup.style.color = 'inherit';
    status.after(setup);
  }
}).catch(() => {
  const status = document.querySelector('#service-status');
  if (status) status.textContent = 'SERVER UNAVAILABLE';
});
