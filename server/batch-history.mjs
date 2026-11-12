import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';

const filename = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const maxScan = 5000, maxCandidates = 20, maxFileBytes = 32 * 1024 * 1024, maxTotalBytes = 128 * 1024 * 1024;

// Only whitelisted metadata leaves the server. Raw traces and account records stay in batch files.
export async function recentBatches(directory) {
  let dir;
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid batch directory.');
    dir = await opendir(directory);
  }
  catch (error) { if (error.code === 'ENOENT') return { batches: [], limited: false }; throw error; }
  const candidates = [];
  let scanned = 0, limited = false;
  for await (const entry of dir) {
    if (++scanned > maxScan) { limited = true; break; }
    const match = filename.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    try {
      const stat = await lstat(join(directory, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      candidates.push({ id: match[1], name: entry.name, mtime: stat.mtimeMs });
      candidates.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id));
      if (candidates.length > maxCandidates) candidates.pop();
    } catch (error) { if (error.code !== 'ENOENT') limited = true; }
  }
  const batches = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    let file;
    try {
      file = await open(join(directory, candidate.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxFileBytes || totalBytes + stat.size > maxTotalBytes) { limited = true; continue; }
      totalBytes += stat.size;
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
      const after = await file.stat();
      if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { limited = true; continue; }
      const batch = JSON.parse(buffer.toString('utf8'));
      const counts = batch.counts;
      if (batch.id !== candidate.id || batch.provenance !== 'deterministic-mock' || !Number.isFinite(Date.parse(batch.createdAt)) || !Number.isSafeInteger(batch.personaCount) || batch.personaCount < 1 || !Number.isSafeInteger(batch.trials) || batch.trials < 1 || !counts || !['pass','fail','unverified'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) || counts.pass + counts.fail + counts.unverified !== batch.personaCount * batch.trials) { limited = true; continue; }
      const agent = ['safe', 'buggy', 'external', 'mcp'].includes(batch.agent) ? batch.agent : 'unknown';
      const source = ['public', 'sandbox-account'].includes(batch.personaSource) ? batch.personaSource : 'unknown';
      batches.push({ id: candidate.id, createdAt: new Date(batch.createdAt).toISOString(), agent, source, personaCount: batch.personaCount, trials: batch.trials, counts: { pass: counts.pass, fail: counts.fail, unverified: counts.unverified }, verdict: counts.fail ? 'fail' : counts.unverified ? 'unverified' : 'pass' });
    } catch (error) { limited = true; }
    finally { await file?.close(); }
  }
  return { batches, limited };
}
