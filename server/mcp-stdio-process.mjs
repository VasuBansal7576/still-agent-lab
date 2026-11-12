import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('./mcp-stdio-proxy.mjs', import.meta.url));

// The agent is trusted local code. The private socket exists only for one trial.
export function createStdioProcessHost({ sdk, command, args = [], timeoutMs = 60000 } = {}) {
  if (!sdk?.Server || !sdk?.StdioServerTransport || !sdk?.ListToolsRequestSchema || !sdk?.CallToolRequestSchema || typeof command !== 'string' || !command || !Array.isArray(args) || args.some(x => typeof x !== 'string') || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Provide an MCP SDK, trusted executable, argument array and bounded timeout.');
  return async ({ client, customerRequest, orderId, policy }) => {
    const directory = await mkdtemp(join(tmpdir(), 'still-mcp-'));
    const socketPath = join(directory, 'trial.sock');
    const server = createServer();
    let peer, connected = false, invalid = false, mcpServer, child;
    try {
      server.on('connection', socket => {
        if (connected) { invalid = true; socket.destroy(); return; }
        connected = true; peer = socket;
        mcpServer = new sdk.Server({ name: 'still-mock-trial-stdio', version: '1.0.0' }, { capabilities: { tools: {} } });
        mcpServer.setRequestHandler(sdk.ListToolsRequestSchema, () => client.listTools());
        mcpServer.setRequestHandler(sdk.CallToolRequestSchema, request => client.callTool(request.params));
        mcpServer.connect(new sdk.StdioServerTransport(socket, socket)).catch(() => { invalid = true; socket.destroy(); });
        socket.on('error', () => { invalid = true; });
      });
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(socketPath, ok); });
      const payload = JSON.stringify({ customerRequest, orderId, policy, mcpServer: { command: process.execPath, args: [bridge, socketPath] } });
      const answer = await new Promise((ok, fail) => {
        child = spawn(command, args, { cwd: resolve('.'), env: { PATH: process.env.PATH || '', STILL_TOOLKIT_INSTALL: process.env.STILL_TOOLKIT_INSTALL || '' }, stdio: ['pipe', 'pipe', 'ignore'] });
        let output = '', settled = false;
        const timer = setTimeout(() => finish(new Error('Agent timed out.')), timeoutMs);
        function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); fail(error); } else ok(value); }
        child.on('error', () => finish(new Error('Agent could not start.')));
        child.stdin.on('error', () => finish(new Error('Agent input failed.')));
        child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 65536) finish(new Error('Agent output exceeded limit.')); });
        child.on('close', code => {
          if (code !== 0) return finish(new Error('Agent did not complete.'));
          try { const value = JSON.parse(output); if (Object.keys(value).join() !== 'answer' || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 2000 || !connected || invalid) throw new Error(); finish(null, value.answer); }
          catch { finish(new Error('Agent response invalid.')); }
        });
        child.stdin.end(payload + '\n');
      });
      return answer;
    } finally {
      child?.kill();
      peer?.destroy();
      await mcpServer?.close().catch(() => {});
      await new Promise(ok => server.close(() => ok()));
      await rm(directory, { recursive: true, force: true });
    }
  };
}
