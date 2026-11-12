import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadSandboxCredentials } from './sandbox-credentials.mjs';
import { createPayPalSandbox } from './paypal.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

async function main() {
  const [batchId] = process.argv.slice(2);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '')) throw new Error('Usage: node server/check-deferred-capture-states.mjs BATCH-ID');
  const captures = [];
  for (const file of await readdir('.data/bulk-replay-claims')) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    let lines;
    try { lines = (await readFile(`.data/bulk-replay-claims/${file}`, 'utf8')).trim().split('\n').map(JSON.parse); } catch { continue; }
    const key = lines[0]?.key;
    let identity;
    try { identity = JSON.parse(key); } catch { continue; }
    const capture = lines.find(line => line.state === 'captured');
    if (digest(key) === file.slice(0, 64) && Array.isArray(identity) && identity[0] === batchId && lines.at(-1)?.state === 'chargeback-unverified' && capture?.ok === true && /^[A-Za-z0-9_-]{1,127}$/.test(capture.captureId || '')) captures.push(capture.captureId);
  }
  const adapter = createPayPalSandbox(await loadSandboxCredentials());
  const states = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, captures.length) }, async () => {
    while (next < captures.length) {
      const captureId = captures[next++];
      try {
        const response = await adapter.getCapture(captureId);
        const state = response.ok && response.body?.id === captureId && typeof response.body.status === 'string' ? `HTTP ${response.status} ${response.body.status}` : `HTTP ${response.status} unverified`;
        states[state] = (states[state] || 0) + 1;
      } catch { states.unavailable = (states.unavailable || 0) + 1; }
    }
  }));
  console.log(JSON.stringify({ source: 'paypal-sandbox', batchId, checked: captures.length, captureStates: states, note: 'Read-only current capture statuses. No refund calls.' }, null, 2));
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
