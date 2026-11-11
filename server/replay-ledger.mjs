import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { executeSandboxReplay } from './replay-executor.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const syncDir = async path => { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } };

/** The directory belongs to the server and must not be writable by clients. */
export async function createReplayLedger({ directory } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('A private ledger directory is required.');
  const root = resolve(directory);
  const keys = join(root, 'keys'), captures = join(root, 'captures'), receipts = join(root, 'receipts');
  try { await mkdir(root, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await syncDir(dirname(root));
  for (const path of [keys, captures, receipts]) await mkdir(path, { recursive: true, mode: 0o700 });
  await syncDir(root);

  async function claim(parent, value) {
    try { await mkdir(join(parent, digest(value)), { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    await syncDir(parent);
    return true;
  }

  async function execute(options = {}) {
    let claimed = false;
    const reserve = async ({ captureId, key }) => {
      if (!await claim(keys, key)) return false;
      if (!await claim(captures, captureId)) return false;
      claimed = true;
      return true;
    };
    const receipt = await executeSandboxReplay({ ...options, reserve });
    if (claimed) {
      const path = join(receipts, `${digest(receipt.key)}.json`);
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(receipt)); await file.sync(); } finally { await file.close(); }
      await syncDir(receipts);
    }
    return receipt;
  }

  async function evidence() {
    const records = [];
    for (const name of await readdir(receipts)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const record = JSON.parse(await readFile(join(receipts, name), 'utf8'));
        if (typeof record?.key === 'string' && name === `${digest(record.key)}.json`) records.push(record);
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    return records;
  }

  function verifyReceipt(receipt, item) {
    if (typeof receipt?.key !== 'string' || item?.key !== receipt.key) return false;
    try {
      const saved = JSON.parse(readFileSync(join(receipts, `${digest(receipt.key)}.json`), 'utf8'));
      return JSON.stringify(saved) === JSON.stringify(receipt);
    } catch { return false; }
  }

  return { execute, evidence, verifyReceipt };
}
