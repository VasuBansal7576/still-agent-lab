import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = new URL('../.data/runs/', import.meta.url);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveRun(agent, result) {
  const run = { ...result, id: randomUUID(), agent, createdAt: new Date().toISOString() };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(fileURLToPath(directory), `${run.id}.json`);
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(run), { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
  return run;
}

export async function readRun(id) {
  if (!idPattern.test(id)) return null;
  try { return JSON.parse(await readFile(new URL(`${id}.json`, directory), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function listRuns() {
  let files;
  try { files = await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const runs = await Promise.all(files.filter(name => idPattern.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).map(name => readRun(name.slice(0, -5))));
  return runs.filter(Boolean).map(({ id, agent, status, createdAt }) => ({ id, agent, status, createdAt })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
