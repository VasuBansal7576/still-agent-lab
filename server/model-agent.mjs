import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function createModelAgent() {
  let child = null, endpoint = null, starting = false;
  const entry = fileURLToPath(new URL('../examples/codex-agent.mjs', import.meta.url));
  const status = () => ({ ready: Boolean(child?.connected && endpoint), endpoint });
  async function start() {
    if (starting) throw new Error('The model agent is starting.');
    if (child?.connected && endpoint) return status();
    starting = true;
    try {
      const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', STILL_MANAGED_MODEL: '1', AGENT_PORT: '0' };
      if (process.env.CODEX_HOME) env.CODEX_HOME = process.env.CODEX_HOME;
      const owned = fork(entry, [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child = owned;
      owned.on('exit', () => { if (child === owned) { child = null; endpoint = null; } });
      const port = await new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => finish(new Error('The model agent did not start.')), 5000);
        const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); owned.off('message', onMessage); owned.off('error', onError); owned.off('exit', onExit); error ? reject(error) : resolve(value); };
        const onMessage = message => { if (message?.type === 'ready' && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) finish(null, message.port); };
        const onError = () => finish(new Error('The model agent could not start.'));
        const onExit = () => finish(new Error('The model agent stopped before starting.'));
        owned.on('message', onMessage); owned.once('error', onError); owned.once('exit', onExit);
      }).catch(error => { owned.kill(); throw error; });
      endpoint = `http://127.0.0.1:${port}/agent`;
      return status();
    } finally { starting = false; }
  }
  function stop() { if (child?.connected) child.disconnect(); }
  return { status, start, stop };
}
