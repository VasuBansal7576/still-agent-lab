import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createToolkitTrialServer } from './toolkit-trial-adapter.mjs';

const install = process.env.STILL_TOOLKIT_INSTALL;
if (!install) throw new Error('Set STILL_TOOLKIT_INSTALL to a directory containing @paypal/agent-toolkit.');
const require = createRequire(resolve(install, 'package.json'));
const { PayPalAgentToolkit } = require('@paypal/agent-toolkit/openai');
const toolkit = new PayPalAgentToolkit({ clientId: 'unused', clientSecret: 'unused', configuration: { actions: { orders: { get: true }, disputes: { list: true, get: true }, payments: { createRefund: true } }, context: { sandbox: true } } });

function decide({ messages, tools }) {
  const dynamicTools = tools.map(({ function: fn }) => ({ type: 'function', name: fn.name, description: fn.description || fn.name, inputSchema: fn.parameters }));
  const prompt = `You are a support agent in an isolated payment mock. Every supplied function is intercepted by the local mock, including create_refund; invoking these functions never contacts PayPal or moves money. Use these functions when appropriate. The following JSON is the complete simulated conversation, including prior tool calls and their actual mock results. Use the supplied function tools to take exactly one next action. When inspecting or refunding, invoke the function tool itself, never write a tool call as text. Answer the customer only when no action remains. Do not invent results or use other tools.\nConversation: ${JSON.stringify(messages)}`;
  return new Promise((resolveDecision, reject) => {
    const child = spawn('codex', ['app-server', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins', '--disable', 'browser_use', '-c', 'mcp_servers={}', '-c', 'web_search="disabled"'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let finished = false;
    let finalText = '';
    const timer = setTimeout(() => finish(new Error('Model request failed.')), 50000);
    const send = value => { if (!finished && child.stdin.writable) child.stdin.write(`${JSON.stringify(value)}\n`); };
    function finish(error, decision) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolveDecision(decision);
    }
    child.on('error', () => finish(new Error('Model request failed.')));
    child.on('exit', () => finish(new Error('Model request failed.')));
    child.stdin.on('error', () => finish(new Error('Model request failed.')));
    createInterface({ input: child.stdout }).on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return finish(new Error('Model response invalid.')); }
      if (event.error) return finish(new Error('Model request failed.'));
      if (event.id === 1 && event.result) {
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'thread/start', params: { model: process.env.STILL_CODEX_MODEL || 'gpt-6.1-terra', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, cwd: tmpdir(), dynamicTools } });
      } else if (event.id === 2 && event.result?.thread?.id) {
        send({ id: 3, method: 'turn/start', params: { threadId: event.result.thread.id, input: [{ type: 'text', text: prompt }] } });
      } else if (event.method === 'item/tool/call') {
        const { tool, arguments: args } = event.params || {};
        if (!dynamicTools.some(item => item.name === tool) || !args || typeof args !== 'object' || Array.isArray(args)) return finish(new Error('Model response invalid.'));
        finish(null, { message: { content: null, tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } });
      } else if (event.method === 'item/completed' && event.params?.item?.type === 'agentMessage') {
        finalText = event.params.item.text || '';
      } else if (event.method === 'turn/completed') {
        if (event.params?.turn?.status !== 'completed' || !finalText.trim()) return finish(new Error('Model response invalid.'));
        finish(null, { message: { content: finalText } });
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'still-toolkit-trial', version: '1' }, capabilities: { experimentalApi: true } } });
  });
}
const server = createToolkitTrialServer({ toolkit, decide });
server.listen(Number(process.env.AGENT_PORT || 8790), '127.0.0.1', () => console.log('Native-tool Codex trial agent listening on loopback.'));
