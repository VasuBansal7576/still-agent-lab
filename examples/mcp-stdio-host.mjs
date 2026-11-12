import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { sdk as base, toolkit } from './mcp-scripted-host.mjs';
import { createStdioProcessHost } from '../server/mcp-stdio-process.mjs';

const require = createRequire(resolve(process.env.STILL_TOOLKIT_INSTALL, 'package.json'));
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
export const sdk = { ...base, StdioServerTransport };
export { toolkit };
const command = process.env.STILL_STDIO_AGENT_COMMAND;
let args;
try { args = JSON.parse(process.env.STILL_STDIO_AGENT_ARGS || '[]'); } catch { throw new Error('STILL_STDIO_AGENT_ARGS must be a JSON string array.'); }
const timeoutMs = Number(process.env.STILL_STDIO_AGENT_TIMEOUT_MS || 60000);
export const runAgent = createStdioProcessHost({ sdk, command, args, timeoutMs });
