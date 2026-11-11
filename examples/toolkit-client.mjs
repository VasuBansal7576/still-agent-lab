import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const demo = process.argv.includes('--demo');
const child = spawn(process.execPath, [fileURLToPath(new URL('../server/toolkit-mcp.mjs', import.meta.url)), ...(demo ? ['--demo'] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });
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
const args = { capture_id: demo ? 'MOCK-CAPTURE-toolkit' : 'demo-capture', amount: { value: '50.00', currency_code: 'USD' } };
for (const arguments_ of demo ? [{ ...args, amount: { value: '60.00', currency_code: 'USD' } }, args, args] : [args]) {
  console.log(JSON.stringify(await request('tools/call', { name: 'create_refund', arguments: arguments_ })));
}
child.stdin.end();
