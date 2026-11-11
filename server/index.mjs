import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPayPalSandbox } from './paypal.mjs';
import { runScenario, normalizeRuleSettings } from './runner.mjs';
import { codexReady } from './codex-model.mjs';
import { listRuns, readRun, saveRun } from './store.mjs';
import { scenarioCatalog } from './catalog.mjs';
import { endpointUrl } from './agent-connection.mjs';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT || 3000);
const paypalReady = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const modelReady = await codexReady();
const defaultPaypal = paypalReady ? createPayPalSandbox({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET }) : null;
const sessions = new Map();

function sessionFor(request, response) {
  const id = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('still_session='))?.slice('still_session='.length);
  if (id && sessions.has(id)) return sessions.get(id);
  const sessionId = randomUUID();
  const session = { paypal: defaultPaypal, checkout: null, captures: new Set(), spent: new Set() };
  sessions.set(sessionId, session);
  response.setHeader('Set-Cookie', `still_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  return session;
}

function publicCheckout(checkout) {
  if (!checkout) return null;
  const { state, orderId, approvalUrl, captureId, capture, error, providerStatus } = checkout;
  return { state, orderId, approvalUrl, captureId, capture, error, providerStatus };
}

function completedCapture(result) {
  return result.ok && result.body?.captures?.find(item => item.status === 'COMPLETED' && item.id && item.amount?.value === '50.00' && item.amount?.currency_code === 'USD');
}

function recordCapture(session, checkout, capture) {
  checkout.state = 'captured';
  checkout.captureId = capture.id;
  checkout.capture = capture;
  delete checkout.error;
  session.captures.add(capture.id);
}
const files = new Map([['/', ['public/index.html', 'text/html; charset=utf-8']], ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']], ['/setup', ['public/setup.html', 'text/html; charset=utf-8']]]);

function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 8192) throw new Error('Request is too large');
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('Invalid JSON'); }
}
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const session = sessionFor(request, response);
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(response, 403, { error: 'Origin not allowed' });
    if (request.method === 'GET' && files.has(url.pathname)) {
      const [file, contentType] = files.get(url.pathname);
      const content = await readFile(new URL(`../${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(content);
    }
    if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, { ready: Boolean(session.paypal) && modelReady, paypalReady: Boolean(session.paypal), modelReady, model: process.env.CODEX_MODEL || 'gpt-6.1-terra' });
    if (request.method === 'GET' && url.pathname === '/api/checkout') return send(response, 200, { checkout: publicCheckout(session.checkout) });
    if (request.method === 'GET' && url.pathname === '/api/scenarios') return send(response, 200, { scenarios: scenarioCatalog });
    if (request.method === 'GET' && url.pathname === '/api/runs') return send(response, 200, { runs: await listRuns() });
    const savedMatch = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)$/);
    if (request.method === 'GET' && savedMatch) {
      const run = await readRun(savedMatch[1]);
      return run ? send(response, 200, run) : send(response, 404, { error: 'Run not found' });
    }
    if (request.method !== 'POST') return send(response, 404, { error: 'Not found' });
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: 'JSON required' });
    if (url.pathname === '/api/setup/paypal') {
      if (!origin || session.checkout || session.captures.size) return send(response, 403, { error: 'Sandbox setup is unavailable during an active session' });
      const input = await body(request);
      if (!/^[A-Za-z0-9_-]{10,256}$/.test(input.clientId || '') || !/^[A-Za-z0-9_-]{10,256}$/.test(input.clientSecret || '')) return send(response, 400, { error: 'Enter a valid sandbox client ID and secret' });
      session.paypal = createPayPalSandbox({ clientId: input.clientId, clientSecret: input.clientSecret });
      return send(response, 200, { connected: true, persistence: 'memory-only' });
    }
    if (url.pathname === '/api/orders') {
      if (!session.paypal) return send(response, 503, { error: 'PayPal sandbox credentials are not configured' });
      await body(request);
      if (session.checkout && session.checkout.state !== 'spent') return send(response, 409, { error: 'An existing checkout must be resolved first', checkout: publicCheckout(session.checkout) });
      const checkout = { state: 'creating' };
      session.checkout = checkout;
      try {
        const result = await session.paypal.createOrder({ amount: '50.00', currency: 'USD', requestId: randomUUID() });
        if (result.body?.id) checkout.orderId = result.body.id;
        if (result.ok && result.body.id && result.body.approvalUrl) {
          checkout.state = 'approval_required';
          checkout.approvalUrl = result.body.approvalUrl;
          checkout.requestId = randomUUID();
          return send(response, 200, { orderId: checkout.orderId, approvalUrl: checkout.approvalUrl, checkout: publicCheckout(checkout) });
        }
        checkout.state = 'create_unknown';
        checkout.error = 'Order creation could not be confirmed. Do not create another order in this session.';
      } catch {
        checkout.state = 'create_unknown';
        checkout.error = 'Order creation could not be confirmed. Do not create another order in this session.';
      }
      return send(response, 502, { error: checkout.error, checkout: publicCheckout(checkout) });
    }
    const orderMatch = url.pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/(capture|reconcile|abandon)$/);
    if (orderMatch) {
      if (!session.paypal) return send(response, 503, { error: 'PayPal sandbox credentials are not configured' });
      await body(request);
      const checkout = session.checkout;
      if (!checkout || checkout.orderId !== orderMatch[1]) return send(response, 404, { error: 'Order not found in this session' });
      if (['creating', 'capturing', 'checking'].includes(checkout.state)) return send(response, 409, { error: 'A checkout operation is already in progress', checkout: publicCheckout(checkout) });
      if (orderMatch[2] === 'reconcile') {
        if (['captured', 'spent'].includes(checkout.state)) return send(response, 200, { checkout: publicCheckout(checkout) });
        const previous = checkout.state;
        checkout.state = 'checking';
        try {
          const result = await session.paypal.getOrder(checkout.orderId);
          const capture = completedCapture(result);
          if (capture) recordCapture(session, checkout, capture);
          else if (previous === 'approval_required' && result.ok && ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(result.body.status)) {
            checkout.state = 'approval_required';
            checkout.providerStatus = result.body.status;
          } else {
            checkout.state = previous;
            checkout.error = 'PayPal has not confirmed a completed capture. Check again before taking further action.';
          }
        } catch {
          checkout.state = previous;
          checkout.error = 'PayPal could not be reached. The checkout outcome remains unchanged.';
        }
        return send(response, 200, { checkout: publicCheckout(checkout) });
      }
      if (orderMatch[2] === 'abandon') {
        if (checkout.state !== 'approval_required') return send(response, 409, { error: 'This checkout cannot be abandoned while its payment outcome is unresolved or captured', checkout: publicCheckout(checkout) });
        checkout.state = 'checking';
        try {
          const result = await session.paypal.getOrder(checkout.orderId);
          const capture = completedCapture(result);
          if (capture) {
            recordCapture(session, checkout, capture);
            return send(response, 409, { error: 'PayPal shows a captured payment. Use it for a run before creating another checkout.', checkout: publicCheckout(checkout) });
          }
          if (result.ok && ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED', 'VOIDED'].includes(result.body.status)) {
            session.checkout = null;
            return send(response, 200, { checkout: null });
          }
        } catch { /* The order state remains unresolved. */ }
        checkout.state = 'approval_required';
        return send(response, 409, { error: 'PayPal did not confirm that this checkout can be abandoned.', checkout: publicCheckout(checkout) });
      }
      if (checkout.state !== 'approval_required') return send(response, 409, { error: 'Capture cannot be started from this checkout state', checkout: publicCheckout(checkout) });
      checkout.state = 'checking';
      let order;
      try { order = await session.paypal.getOrder(checkout.orderId); } catch {
        checkout.state = 'approval_required';
        return send(response, 502, { error: 'Could not check PayPal approval. No capture was attempted.', checkout: publicCheckout(checkout) });
      }
      const existingCapture = completedCapture(order);
      if (existingCapture) {
        recordCapture(session, checkout, existingCapture);
        return send(response, 200, { captureId: existingCapture.id, capture: existingCapture, checkout: publicCheckout(checkout) });
      }
      if (order.ok && order.body.status === 'COMPLETED') {
        checkout.state = 'capture_unknown';
        checkout.error = 'PayPal reports a completed order without a matching completed capture. Check the order before proceeding.';
        return send(response, 409, { error: checkout.error, checkout: publicCheckout(checkout) });
      }
      if (!order.ok || order.body.status !== 'APPROVED') {
        checkout.state = 'approval_required';
        return send(response, 409, { error: 'PayPal has not confirmed approval. No capture was attempted.', checkout: publicCheckout(checkout) });
      }
      checkout.state = 'capturing';
      try {
        const result = await session.paypal.captureOrder(checkout.orderId, { requestId: checkout.requestId });
        const capture = completedCapture(result);
        if (capture) {
          recordCapture(session, checkout, capture);
          return send(response, 200, { captureId: capture.id, capture, checkout: publicCheckout(checkout) });
        }
      } catch { /* The provider may have received the request. */ }
      checkout.state = 'capture_unknown';
      checkout.error = 'Capture outcome is unknown. Check PayPal status before proceeding; do not retry capture.';
      return send(response, 502, { error: checkout.error, checkout: publicCheckout(checkout) });
    }
    if (url.pathname === '/api/runs') {
      const input = await body(request);
      const scenario = scenarioCatalog.find(item => item.id === input.scenarioId);
      if (!scenario) return send(response, 400, { error: 'Choose a valid scenario' });
      if ((scenario.payment === 'captured' && !session.paypal) || (input.agent !== 'external' && !modelReady)) return send(response, 503, { error: 'The selected scenario needs PayPal sandbox and a configured agent' });
      if (scenario.payment === 'captured' && (!session.captures.has(input.captureId) || session.spent.has(input.captureId))) return send(response, 400, { error: 'Create a fresh captured payment for each run' });
      if (!['buggy', 'safe', 'external'].includes(input.agent)) return send(response, 400, { error: 'Choose a valid agent' });
      if (input.agent === 'external' && (typeof input.agentEndpoint !== 'string' || input.agentEndpoint.length > 2048)) return send(response, 400, { error: 'Enter a local agent endpoint' });
      if (input.agent === 'external') {
        try { endpointUrl(input.agentEndpoint); } catch (error) { return send(response, 400, { error: error.message }); }
      }
      if (input.policy !== undefined && (typeof input.policy !== 'string' || input.policy.length > 2000)) return send(response, 400, { error: 'Policy must be text of at most 2000 characters' });
      let ruleSettings;
      try { ruleSettings = normalizeRuleSettings(scenario, input.ruleSettings); }
      catch (error) { return send(response, 400, { error: error.message }); }
      if (scenario.payment === 'captured') {
        session.spent.add(input.captureId);
        if (session.checkout?.captureId === input.captureId) session.checkout.state = 'spent';
      }
      const result = await runScenario({ captureId: input.captureId, agent: input.agent, agentEndpoint: input.agentEndpoint, scenario, paypal: session.paypal, model: process.env.CODEX_MODEL || 'gpt-6.1-terra', policy: input.policy, ruleSettings });
      result.scenarioId = scenario.id;
      try { return send(response, 200, await saveRun(input.agent, result)); }
      catch { return send(response, 200, { ...result, agent: input.agent, storageWarning: 'The run could not be saved. Copy the trace before leaving this page.' }); }
    }
    return send(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Request failed:', error.message);
    return send(response, 500, { error: 'The request failed. Check server logs and configuration.' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Still is available at http://127.0.0.1:${port}`));
