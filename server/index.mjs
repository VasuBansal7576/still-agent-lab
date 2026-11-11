import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPayPalSandbox } from './paypal.mjs';
import { runScenario } from './runner.mjs';
import { codexReady } from './codex-model.mjs';
import { listRuns, readRun, saveRun } from './store.mjs';
import { scenarioCatalog } from './catalog.mjs';
import { endpointUrl } from './agent-connection.mjs';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT || 3000);
let paypalReady = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const modelReady = await codexReady();
let paypal = paypalReady ? createPayPalSandbox({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET }) : null;
const pending = new Map();
const captures = new Set();
const spent = new Set();
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
function providerError(result) {
  return result?.body?.details?.[0]?.description || result?.body?.message || `PayPal sandbox request failed (HTTP ${result?.status || 'unknown'})`;
}
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const origin = request.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(response, 403, { error: 'Origin not allowed' });
    if (request.method === 'GET' && files.has(url.pathname)) {
      const [file, contentType] = files.get(url.pathname);
      const content = await readFile(new URL(`../${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(content);
    }
    if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, { ready: paypalReady && modelReady, paypalReady, modelReady, model: process.env.CODEX_MODEL || 'gpt-6.1-terra' });
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
      if (!origin || pending.size || captures.size) return send(response, 403, { error: 'Sandbox setup is unavailable during an active session' });
      const input = await body(request);
      if (!/^[A-Za-z0-9_-]{10,256}$/.test(input.clientId || '') || !/^[A-Za-z0-9_-]{10,256}$/.test(input.clientSecret || '')) return send(response, 400, { error: 'Enter a valid sandbox client ID and secret' });
      paypal = createPayPalSandbox({ clientId: input.clientId, clientSecret: input.clientSecret });
      paypalReady = true;
      return send(response, 200, { connected: true, persistence: 'memory-only' });
    }
    if (url.pathname === '/api/orders') {
      if (!paypal) return send(response, 503, { error: 'PayPal sandbox credentials are not configured' });
      await body(request);
      const result = await paypal.createOrder({ amount: '50.00', currency: 'USD', requestId: randomUUID() });
      if (!result.ok || !result.body.id || !result.body.approvalUrl) return send(response, 502, { error: providerError(result) });
      pending.set(result.body.id, randomUUID());
      return send(response, 200, { orderId: result.body.id, approvalUrl: result.body.approvalUrl });
    }
    const match = url.pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/capture$/);
    if (match) {
      if (!paypal) return send(response, 503, { error: 'PayPal sandbox credentials are not configured' });
      await body(request);
      const requestId = pending.get(match[1]);
      if (!requestId) return send(response, 400, { error: 'Create a fresh order in this session first' });
      const result = await paypal.captureOrder(match[1], { requestId });
      const capture = result.body?.captures?.find(item => item.status === 'COMPLETED');
      if (!result.ok || !capture?.id) return send(response, 502, { error: providerError(result) });
      pending.delete(match[1]); captures.add(capture.id);
      return send(response, 200, { captureId: capture.id, capture });
    }
    if (url.pathname === '/api/runs') {
      const input = await body(request);
      const scenario = scenarioCatalog.find(item => item.id === input.scenarioId);
      if (!scenario) return send(response, 400, { error: 'Choose a valid scenario' });
      if ((scenario.payment === 'captured' && !paypal) || (input.agent !== 'external' && !modelReady)) return send(response, 503, { error: 'The selected scenario needs PayPal sandbox and a configured agent' });
      if (scenario.payment === 'captured' && (!captures.has(input.captureId) || spent.has(input.captureId))) return send(response, 400, { error: 'Create a fresh captured payment for each run' });
      if (!['buggy', 'safe', 'external'].includes(input.agent)) return send(response, 400, { error: 'Choose a valid agent' });
      if (input.agent === 'external' && (typeof input.agentEndpoint !== 'string' || input.agentEndpoint.length > 2048)) return send(response, 400, { error: 'Enter a local agent endpoint' });
      if (input.agent === 'external') {
        try { endpointUrl(input.agentEndpoint); } catch (error) { return send(response, 400, { error: error.message }); }
      }
      if (input.policy !== undefined && (typeof input.policy !== 'string' || input.policy.length > 2000)) return send(response, 400, { error: 'Policy must be text of at most 2000 characters' });
      if (scenario.payment === 'captured') spent.add(input.captureId);
      const result = await runScenario({ captureId: input.captureId, agent: input.agent, agentEndpoint: input.agentEndpoint, scenario, paypal, model: process.env.CODEX_MODEL || 'gpt-6.1-terra', policy: input.policy });
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
