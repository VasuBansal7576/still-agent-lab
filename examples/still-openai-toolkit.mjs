import { fileURLToPath } from 'node:url';
import { createStillToolkitAdapter } from './toolkit-openai-adapter.mjs';

/** Replace toolkit dispatch with the Still MCP gateway. No PayPal fallback is used. */
export async function connectStillToolkit(toolkit, { batchId, decisionId, sdk } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId || '')) {
    throw new Error('Supply a saved passing batch UUID.');
  }
  if (decisionId !== undefined && (typeof decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,127}$/.test(decisionId))) throw new Error('Supply a valid decision ID.');
  const Client = sdk?.Client ?? (await import('@modelcontextprotocol/sdk/client/index.js')).Client;
  const StdioClientTransport = sdk?.StdioClientTransport ?? (await import('@modelcontextprotocol/sdk/client/stdio.js')).StdioClientTransport;
  const client = new Client({ name: 'still-openai-toolkit', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../server/mcp-batch-binding.mjs', import.meta.url)), batchId, ...(decisionId === undefined ? [] : [decisionId])]
  });
  try {
    await client.connect(transport);
    const adapter = await createStillToolkitAdapter({ toolkit, client });
    return Object.freeze({
      getTools: () => adapter.tools,
      async handleToolCall(call) { return (await adapter.dispatch([call]))[0]; },
      close: () => client.close()
    });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
