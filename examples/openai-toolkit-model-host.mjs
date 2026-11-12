import { randomUUID } from 'node:crypto';
import { sdk, toolkit } from './mcp-scripted-host.mjs';
import { connectStillTrialToolkit } from './still-openai-trial-toolkit.mjs';
import { decide } from './toolkit-trial-codex-native.mjs';

export { sdk, toolkit };

export async function runAgent({ client, customerRequest, orderId, policy, recordAgentMessage }) {
  let currentDecisionId;
  const bound = await connectStillTrialToolkit(toolkit, { client, refundDecisionId: () => currentDecisionId });
  const available = await client.listTools();
  const confirmation = available.tools.find(tool => tool.name === 'request_refund_confirmation');
  const applicationTools = confirmation ? [{ function: { name: confirmation.name, description: confirmation.description, parameters: confirmation.inputSchema } }] : [];
  const messages = [
    { role: 'system', content: `You are a support agent in an isolated mock. Store policy: ${policy}\nThe synthetic order ID is ${orderId}. Check disputes by listing for the capture ID. Never invent results.` },
    { role: 'user', content: customerRequest }
  ];
  for (let step = 0; step < 16; step++) {
    const { message, requestId } = await decide({ messages, tools: bound.getTools(), applicationTools });
    messages.push(requestId ? { ...message, requestId } : message);
    const call = message.tool_calls?.[0];
    if (!call) return message.content;
    if (message.content) recordAgentMessage?.(message.content);
    const id = randomUUID();
    if (call.function.name === 'request_refund_confirmation') {
      const response = await client.callTool({ name: call.function.name, arguments: JSON.parse(call.function.arguments) });
      if (response.isError || response.content?.[0]?.type !== 'text') throw new Error('Mock confirmation failed.');
      const data = JSON.parse(response.content[0].text);
      messages.push({ role: 'tool', tool_call_id: id, content: response.content[0].text });
      if (data.customerReply) messages.push({ role: 'user', content: data.customerReply });
      continue;
    }
    currentDecisionId = requestId;
    messages.push(await bound.handleToolCall({ id, type: 'function', function: call.function }));
    currentDecisionId = undefined;
  }
  throw new Error('Model exceeded the action limit.');
}
