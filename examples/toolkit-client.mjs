import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const demo = process.argv.includes('--demo');
const batchAt = process.argv.indexOf('--batch');
const batch = batchAt >= 0 ? process.argv[batchAt + 1] : null;
const script = batch ? '../server/mcp-batch-binding.mjs' : '../server/toolkit-mcp.mjs';
const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...(batch ? [batch] : demo ? ['--demo'] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const replies = new Map();
lines.on('line', line => {
  const message = JSON.parse(line);
  replies.get(message.id)?.(message);
  replies.delete(message.id);
});
let id = 0;
function request(method, params = {}) {
  return new Promise(resolve => {
    const requestId = ++id;
    replies.set(requestId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
}
console.log(JSON.stringify(await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'still-example', version: '1' } })));
console.log(JSON.stringify(await request('tools/list')));
if (demo || batch) console.log(JSON.stringify(await request('tools/call', { name: 'get_dispute', arguments: { dispute_id: batch ? 'batch-dispute' : 'demo-dispute' } }))); 
const args = { capture_id: batch ? 'MOCK-CAPTURE-batch' : demo ? 'MOCK-CAPTURE-toolkit' : 'demo-capture', amount: { value: batch ? '1.00' : '50.00', currency_code: 'USD' } };
for (const arguments_ of demo ? [{ ...args, amount: { value: '60.00', currency_code: 'USD' } }, args, args] : batch ? [args, args] : [args]) {
  console.log(JSON.stringify(await request('tools/call', { name: 'create_refund', arguments: arguments_ })));
}
child.stdin.end();
