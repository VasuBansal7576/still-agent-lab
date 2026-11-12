import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { planSandboxReplays, reconcileSandboxReplays } from './sandbox-replay.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyFor = (batchId, result) => JSON.stringify([batchId, String(result.personaId), result.trial]);

export async function summarizeFreshReplays({ batchId, batch, evidence, verifyReceipt, directory } = {}) {
  if (!uuid.test(batchId || '') || !Array.isArray(batch?.results) || !Array.isArray(evidence) || typeof verifyReceipt !== 'function' || typeof directory !== 'string') throw new TypeError('A source batch, authenticated ledger and batch directory are required.');
  const originalResults = new Map(batch.results.map(result => [keyFor(batchId, result), result]));
  const originalKeys = new Set();
  const linked = [];
  let unreadable = 0, invalid = 0;
  for (const name of (await readdir(directory)).sort()) {
    if (!uuid.test(name.replace(/\.json$/, '')) || !name.endsWith('.json')) continue;
    let replacement;
    try { replacement = JSON.parse(await readFile(join(directory, name), 'utf8')); }
    catch { unreadable++; continue; }
    if (replacement.replacementOf?.batchId !== batchId) continue;
    if (replacement.id !== name.slice(0, -5) || !Array.isArray(replacement.results)) { invalid++; continue; }
    const declared = replacement.replacementOf.originalKeys || (replacement.replacementOf.personaId && Number.isSafeInteger(replacement.replacementOf.trial) ? [JSON.stringify([batchId, replacement.replacementOf.personaId, replacement.replacementOf.trial])] : null);
    if (!Array.isArray(declared) || declared.length !== replacement.results.length || new Set(declared).size !== declared.length) { invalid++; continue; }
    const mapped = new Map();
    for (const result of replacement.results) {
      const originalKey = keyFor(batchId, result);
      const original = originalResults.get(originalKey);
      if (!declared.includes(originalKey) || !original || JSON.stringify(original) !== JSON.stringify(result) || originalKeys.has(originalKey)) { invalid++; continue; }
      originalKeys.add(originalKey);
      mapped.set(keyFor(replacement.id, result), originalKey);
    }
    if (!mapped.size) continue;
    let comparison;
    try {
      const plan = planSandboxReplays({ batchId: replacement.id, batch: replacement, maxRuns: replacement.results.length, samplePasses: 0 });
      comparison = reconcileSandboxReplays({ plan, evidence, verifyReceipt });
    } catch { invalid += mapped.size; continue; }
    for (const result of comparison.results) {
      const originalKey = mapped.get(result.key);
      if (!originalKey) continue;
      linked.push({ originalKey, replacementBatchId: replacement.id, comparison: result });
    }
  }
  const agreed = linked.filter(item => item.comparison.status === 'agreed').length;
  const disagreed = linked.filter(item => item.comparison.status === 'disagreed').length;
  const unverified = linked.filter(item => item.comparison.status !== 'agreed' && item.comparison.status !== 'disagreed').length;
  return { source: 'authenticated-sandbox-replay-comparisons', timing: 'fresh-replacement', linked: linked.length, compared: agreed + disagreed, agreed, disagreed, unverified, invalidMappings: invalid, unreadableBatches: unreadable, examples: linked.filter(item => item.comparison.status === 'agreed' || item.comparison.status === 'disagreed').slice(0, 5), limitation: 'Fresh sandbox attempts of saved mock traces. Original claims and immediate scores are unchanged. Provider history and exclusive access are not established.' };
}
