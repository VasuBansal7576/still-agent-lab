import { sdk, toolkit } from './mcp-scripted-host.mjs';
import { decide } from './toolkit-trial-codex-native.mjs';

export { sdk, toolkit };

export async function runAgent({ client, customerRequest, orderId, policy, recordAgentMessage }) {
  const { tools } = await client.listTools();
  const definitions = tools.map(tool => ({ function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
  const messages = [
    { role: 'system', content: `You are a support agent in an isolated mock. Store policy: ${policy}\nThe synthetic order ID is ${orderId}. Check disputes by listing for the capture ID. Never invent results.` },
    { role: 'user', content: customerRequest }
  ];
  for (let step = 0; step < 16; step++) {
    const { message, requestId } = await decide({ messages, tools: definitions });
    messages.push(requestId ? { ...message, requestId } : message);
    if (message.content) recordAgentMessage?.(message.content);
    const call = message.tool_calls?.[0];
    if (!call) return message.content;
    const result = await client.callTool({ name: call.function.name, arguments: JSON.parse(call.function.arguments), ...(requestId ? { _meta: { stillRequestId: requestId } } : {}) });
    if (result.isError || result.content?.[0]?.type !== 'text') throw new Error('Mock tool failed.');
    messages.push({ role: 'tool', content: result.content[0].text });
    const data = JSON.parse(result.content[0].text);
    if (call.function.name === 'request_refund_confirmation' && data.customerReply) messages.push({ role: 'user', content: data.customerReply });
  }
  throw new Error('Model exceeded the action limit.');
}
