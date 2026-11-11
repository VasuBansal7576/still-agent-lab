import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const schema = fileURLToPath(new URL('./codex-output-schema.json', import.meta.url));
const maxOutput = 1_000_000;

function invoke(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let diagnostics = '';
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Codex model request timed out.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > maxOutput) {
        child.kill('SIGKILL');
        finish(new Error('Codex model output exceeded the limit.'));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-20000); });
    child.on('error', () => finish(new Error('Could not start the Codex CLI.')));
    child.on('close', code => finish(code === 0 ? null : new Error('The Codex CLI request failed.'), { output, diagnostics }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function codexReady() {
  try {
    const result = await invoke(['login', 'status'], '', 10000);
    return /logged in using chatgpt/i.test(result.output + result.diagnostics);
  } catch {
    return false;
  }
}

export async function codexChat({ messages, explain = false, model = 'gpt-6.1-terra' } = {}) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('A conversation is required.');
  if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw new Error('Invalid model name.');
  const prompt = [
    'Respond as the simulated support agent, using the supplied conversation as the complete record.',
    'Do not use any Codex tools, shell, filesystem, network, or browser. Output only the structured response.',
    explain
      ? 'Explain the supplied evidence. Set tool to none and put the explanation in content.'
      : 'Choose exactly one next action. Use get_order to inspect the order and refund history; use cancel_order to cancel the simulated order; use refund_order to request a refund with amount and currency; use propose_fulfillment to propose shipping; use none when replying to the customer. Cancellation is simulated and separate from refunding. Calls are proposals: the host executes them and returns the result in the next conversation. Do not invent results. Set unused string fields to empty strings.',
    `Conversation: ${JSON.stringify(messages)}`
  ].join('\n');
  const args = ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins', '--disable', 'browser_use', '--disable', 'code_mode_host', '--model', model, '--output-schema', schema, '--json', '-'];
  const { output } = await invoke(args, prompt, 120000);
  let text;
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
  }
  if (!text) throw new Error('Codex did not return a model response.');
  let response;
  try { response = JSON.parse(text); } catch { throw new Error('Codex returned invalid structured output.'); }
  if (typeof response.content !== 'string' || !['none', 'get_order', 'cancel_order', 'refund_order', 'propose_fulfillment'].includes(response.tool) || typeof response.amount !== 'string' || typeof response.currency !== 'string') throw new Error('Codex returned an invalid action.');
  if (explain && response.tool !== 'none') throw new Error('Codex requested a tool while explaining a result.');
  const message = { role: 'assistant', content: response.content || null };
  if (response.tool !== 'none') {
    const args = response.tool === 'refund_order' ? { amount: response.amount, currency: response.currency } : {};
    message.tool_calls = [{ id: randomUUID(), type: 'function', function: { name: response.tool, arguments: JSON.stringify(args) } }];
  }
  return message;
}
