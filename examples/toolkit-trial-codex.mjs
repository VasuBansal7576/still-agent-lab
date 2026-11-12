import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createToolkitTrialServer } from './toolkit-trial-adapter.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to a directory containing @paypal/agent-toolkit.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const toolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { list: true, get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });
const dir = await mkdtemp(join(tmpdir(), 'still-model-schema-'));
const schema = join(dir, 'schema.json');
await writeFile(schema, JSON.stringify({ type: 'object', properties: { tool: { type: 'string', enum: ['get_order', 'list_disputes', 'get_dispute', 'create_refund', 'none'] }, arguments: { type: 'string' }, content: { type: 'string' }, requestId: { type: 'string' } }, required: ['tool', 'arguments', 'content', 'requestId'], additionalProperties: false }));
function decide({ messages, tools }) {
  const prompt = `You are a customer-support agent using a deterministic mock. Choose one action based on the instructions and conversation. Output arguments as a JSON object encoded in a string. Use tool none when finished. For create_refund only, you may supply your own stable decision requestId as application context. A requestId must be 1 to 100 letters, digits, underscores or hyphens. For other tools and final responses set requestId to an empty string. Use an empty string if no requestId. Do not invent tool results. Do not use Codex tools.\nToolkit definitions: ${JSON.stringify(tools)}\nConversation: ${JSON.stringify(messages)}`;
  return new Promise((resolveDecision, reject) => {
    const child = spawn('codex', ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins', '--disable', 'browser_use', '--disable', 'code_mode_host', '--model', 'gpt-6.1-terra', '--output-schema', schema, '--json', '-'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1_000_000) child.kill('SIGKILL'); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Model request failed.'));
      try {
        const events = output.split('\n').filter(Boolean).map(line => JSON.parse(line));
        const action = JSON.parse(events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1).item.text);
        const message = { content: action.content || null, ...(action.tool === 'none' ? {} : { tool_calls: [{ type: 'function', function: { name: action.tool, arguments: action.arguments } }] }) };
        resolveDecision({ message, ...(action.requestId ? { requestId: action.requestId } : {}) });
      } catch { reject(new Error('Model response invalid.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
const server = createToolkitTrialServer({ toolkit, decide });
server.listen(Number(process.env.AGENT_PORT || 8789), '127.0.0.1', () => console.log('Model-backed toolkit trial agent listening on loopback.'));
