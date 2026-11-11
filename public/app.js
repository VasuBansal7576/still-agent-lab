const landing = document.querySelector('#landing');
const workspace = document.querySelector('#workspace');
const result = document.querySelector('#result');
const runButton = document.querySelector('#run');
const policyInput = document.querySelector('#policy');
const choiceButtons = [...document.querySelectorAll('[data-agent]')];
const state = { agent: 'buggy', phase: 'idle', orderId: null, captureId: null, response: null };

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
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.message || `Request failed (${response.status}).`);
  return data;
}

function setPhase(phase) {
  state.phase = phase;
  const busy = ['creating', 'capturing', 'running'].includes(phase);
  runButton.disabled = busy;
  policyInput.disabled = busy;
  choiceButtons.forEach(button => { button.disabled = busy || phase === 'approval' || phase === 'capturing' || phase === 'captured'; });
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
  const pass = ['pass', 'passed'].includes(verdict) && list.length > 0 && checks.length > 0 && checks.every(check => ['pass', 'passed'].includes(String(check.status ?? check.result ?? '').toLowerCase()));
  const fail = ['fail', 'failed'].includes(verdict);
  const label = pass ? 'PASSED' : fail ? 'VIOLATION' : 'INCONCLUSIVE';
  const eventRows = list.map((event, index) => {
    const type = event.type || event.kind || event.role || 'event';
    const title = event.title || event.message || event.content || event.name || type;
    const detail = event.detail || event.description || event.summary;
    const extras = Object.fromEntries(entries(event).filter(([key]) => !['type','kind','role','title','message','content','name','detail','description','summary'].includes(key)));
    return `<div class="row"><span class="n">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(typeof title === 'string' ? title : JSON.stringify(title))}</strong>${detail ? `<p>${escapeHtml(typeof detail === 'string' ? detail : JSON.stringify(detail))}</p>` : ''}${Object.keys(extras).length ? `<details class="details"><summary>VIEW EVENT DATA +</summary><pre>${escapeHtml(JSON.stringify(extras, null, 2))}</pre></details>` : ''}</div><span class="status">${escapeHtml(String(type).toUpperCase())}</span></div>`;
  }).join('');
  const checkRows = checks.map(check => `<div class="row"><span class="n">•</span><div><strong>${escapeHtml(check.label || check.name || check.rule || check.id || 'Policy check')}</strong><p>${escapeHtml(displayText(check.reason || check.evidence || check.message))}</p></div><span class="status">${escapeHtml(String(check.status ?? check.result ?? 'inconclusive').toUpperCase())}</span></div>`).join('');
  result.innerHTML = `<div class="result-head"><div><div class="mono" style="color:#85857b">02 / LIVE RUN</div><h3>${state.agent === 'safe' ? 'Corrected agent' : 'Buggy agent'}</h3></div><span class="result-tag ${pass ? 'pass' : ''}">${escapeHtml(label)}</span></div><div class="rows">${eventRows || '<p>No events were recorded.</p>'}</div><div class="mono" style="margin-top:22px;color:#85857b">POLICY CHECKS</div><div class="rows">${checkRows || '<p>No policy checks were returned. The run cannot be verified.</p>'}</div>${data.explanation ? `<div class="notice"><strong>Explanation</strong><p>${escapeHtml(typeof data.explanation === 'string' ? data.explanation : JSON.stringify(data.explanation))}</p></div>` : ''}<div class="notice mono">ACTUAL RUN / SANDBOX PROVIDER RESPONSES</div>`;
}

document.querySelectorAll('.open-app').forEach(button => button.onclick = () => {
  landing.hidden = true; workspace.hidden = false; window.scrollTo(0, 0);
});
document.querySelector('#back').onclick = () => { workspace.hidden = true; landing.hidden = false; window.scrollTo(0, 0); };
choiceButtons.forEach(button => button.onclick = () => {
  state.agent = button.dataset.agent;
  choiceButtons.forEach(choice => choice.classList.toggle('selected', choice === button));
});

runButton.onclick = async () => {
  if (state.phase === 'approval') {
    setPhase('capturing');
    message('Capturing the payment', 'Checking the approved sandbox order with PayPal.');
    try {
      const data = await request(`/api/orders/${encodeURIComponent(state.orderId)}/capture`, {});
      state.captureId = data.captureId || data.capture_id || data.id;
      if (!state.captureId) throw new Error('PayPal returned no capture ID. The run cannot start.');
      setPhase('captured');
      runButton.innerHTML = 'Run the agent <span>↗</span>';
      message('Payment captured', `Capture ${state.captureId} is ready. Run the selected agent against it.`);
    } catch (error) {
      setPhase('approval');
      message('Payment not captured', error.message, '<span class="mono">Approve the order, then try again.</span>');
    }
    return;
  }
  if (state.phase === 'captured') {
    const policy = policyInput.value.trim();
    if (!policy) {
      message('Store policy required', 'Enter a store policy before running the agent.');
      policyInput.focus();
      return;
    }
    setPhase('running');
    runButton.innerHTML = 'Running agent <span>↗</span>';
    message('Agent is working', 'Waiting for agent decisions and PayPal sandbox responses.');
    try {
      const data = await request('/api/runs', { captureId: state.captureId, agent: state.agent, policy });
      state.response = data;
      setPhase('complete');
      runButton.innerHTML = 'Create another order <span>↗</span>';
      displayResults(data);
    } catch (error) {
      setPhase('failed');
      runButton.innerHTML = 'Create another order <span>↗</span>';
      message('Run not verified', `${error.message} Start a fresh sandbox order before trying again.`);
    }
    return;
  }
  setPhase('creating');
  runButton.innerHTML = 'Creating order <span>↗</span>';
  message('Preparing a sandbox order', 'Creating a fresh $50 payment for the selected agent.');
  try {
    const data = await request('/api/orders', {});
    state.orderId = data.orderId || data.order_id || data.id;
    const link = data.approvalUrl || data.approval_url || data.approveUrl || data.links?.find(link => ['approve', 'payer-action'].includes(link.rel))?.href;
    if (!state.orderId || !link) throw new Error('PayPal returned no order ID or approval link.');
    const approval = new URL(link);
    if (approval.protocol !== 'https:' || !['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(approval.hostname)) throw new Error('PayPal returned an unexpected approval address.');
    setPhase('approval');
    runButton.innerHTML = 'Capture approved order <span>↗</span>';
    message('Approve the sandbox payment', 'Open PayPal, sign in as the sandbox buyer and approve the $50 payment. Then return here to capture it.', `<p><a class="primary" href="${escapeHtml(approval.href)}" target="_blank" rel="noopener noreferrer">OPEN PAYPAL SANDBOX ↗</a></p>`);
  } catch (error) {
    setPhase('failed');
    runButton.innerHTML = 'Create sandbox order <span>↗</span>';
    message('Sandbox order unavailable', error.message);
  }
};

request('/api/status').then(data => {
  const status = document.querySelector('#service-status');
  if (status) status.textContent = data.ready === true ? 'SANDBOX READY' : 'SETUP REQUIRED';
}).catch(() => {
  const status = document.querySelector('#service-status');
  if (status) status.textContent = 'SERVER UNAVAILABLE';
});
