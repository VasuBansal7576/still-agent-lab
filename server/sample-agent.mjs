import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function createSampleAgent() {
  let child = null, endpoint = null, mode = null, changing = false, active = 0;
  const entry = fileURLToPath(new URL('../examples/trial-agent.mjs', import.meta.url));
  const status = () => ({ ready: Boolean(child?.connected && endpoint), endpoint, mode });
  async function start() {
    if (changing || active) throw new Error('The sample agent is busy.');
    if (child?.connected && endpoint) return status();
    changing = true;
    try {
      const owned = fork(entry, [], { env: { PATH: process.env.PATH || '', STILL_MANAGED_SAMPLE: '1', STILL_AGENT_MODE: 'unsafe', AGENT_PORT: '0' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child = owned;
      owned.on('exit', () => { if (child === owned) { child = null; endpoint = null; mode = null; } });
      const port = await new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => finish(new Error('The sample agent did not start.')), 5000);
        const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); owned.off('message', onMessage); owned.off('error', onError); owned.off('exit', onExit); error ? reject(error) : resolve(value); };
        const onMessage = message => { if (message?.type === 'ready' && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) finish(null, message.port); };
        const onError = () => finish(new Error('The sample agent could not start.'));
        const onExit = () => finish(new Error('The sample agent stopped before starting.'));
        owned.on('message', onMessage); owned.once('error', onError); owned.once('exit', onExit);
      }).catch(error => { owned.kill(); throw error; });
      endpoint = `http://127.0.0.1:${port}/agent`;
      mode = 'unsafe';
      return status();
    } finally { changing = false; }
  }
  async function setMode(next) {
    if (!['safe', 'unsafe'].includes(next) || !child?.connected || !endpoint) throw new Error('Start the sample agent first.');
    if (changing || active) throw new Error('Wait for the current sample run to finish.');
    changing = true;
    const owned = child, id = randomUUID();
    try {
      await new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => finish(new Error('The sample agent did not change mode.')), 5000);
        const finish = error => { if (done) return; done = true; clearTimeout(timer); owned.off('message', onMessage); owned.off('exit', onExit); error ? reject(error) : resolve(); };
        const onMessage = message => { if (message?.type === 'mode-set' && message.id === id && message.mode === next) finish(); };
        const onExit = () => finish(new Error('The sample agent stopped.'));
        owned.on('message', onMessage); owned.once('exit', onExit);
        owned.send({ type: 'set-mode', mode: next, id }, error => { if (error) finish(new Error('The sample agent could not change mode.')); });
      });
      mode = next;
      return status();
    } finally { changing = false; }
  }
  function begin(url) {
    if (url !== endpoint) return () => {};
    if (changing || !child?.connected) throw new Error('The sample agent is unavailable.');
    active++;
    return () => { active--; };
  }
  function stop() { if (child?.connected) child.disconnect(); }
  return { status, start, setMode, begin, stop };
}
