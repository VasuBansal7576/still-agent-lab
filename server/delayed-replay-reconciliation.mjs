import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { comparePendingContinuation, pendingComparisonContext } from './compare-pending-continuation.mjs';

export async function summarizeDelayedReplays(batchId) {
  const context = await pendingComparisonContext(batchId);
  const directory = resolve('.data/pending-refund-continuations');
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') names = []; else throw error; }
  const counts = { recorded: 0, compared: 0, agreed: 0, disagreed: 0, unverified: 0 };
  const reasons = new Map();
  const examples = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.jsonl$/.test(name)) continue;
    let key;
    try {
      const first = JSON.parse((await readFile(`${directory}/${name}`, 'utf8')).split('\n')[0]);
      key = first.key;
      if (typeof key !== 'string' || createHash('sha256').update(key).digest('hex') !== name.slice(0, 64)) continue;
      const identity = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length !== 3 || identity[0] !== batchId) continue;
      counts.recorded++;
      const result = await comparePendingContinuation({ batchId, personaId: identity[1], trial: identity[2], context });
      counts.compared++;
      counts[result.status]++;
      if (examples.length < 5) examples.push(result);
    } catch (error) {
      if (!key || !context.items.has(key)) continue;
      counts.unverified++;
      const reason = error.message || 'Could not verify the delayed journal.';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }
  return { batchId, source: 'paypal-sandbox', timing: 'delayed-continuation', ...counts, agreement: counts.compared ? counts.agreed / counts.compared : null, unverifiedReasons: [...reasons].map(([reason, count]) => ({ reason, count })), examples, limitation: 'The second refund call was delayed relative to the mock. These comparisons do not replace the original receipts or their immediate agreement score. Pending refunds are not completed.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await summarizeDelayedReplays(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
