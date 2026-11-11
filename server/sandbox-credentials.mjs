import { spawn } from 'node:child_process';

const service = 'dev.still.paypal-sandbox';
const account = 'sandbox-credentials-v1';
const unavailable = 'Secure sandbox credential storage is unavailable. Unlock or configure the macOS keychain, or supply credentials through the process environment.';

function credentials(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !/^[A-Za-z0-9_-]{10,256}$/.test(value.clientId || '') ||
      !/^[A-Za-z0-9_-]{10,256}$/.test(value.clientSecret || '')) {
    throw new TypeError('Invalid PayPal sandbox credentials.');
  }
  return { clientId: value.clientId, clientSecret: value.clientSecret };
}

function security(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let errorSize = 0;
    let tooLarge = false;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size <= 4096) stdout.push(chunk);
      else { tooLarge = true; child.kill(); }
    });
    child.stderr.on('data', chunk => {
      errorSize += chunk.length;
      if (errorSize <= 4096) stderr.push(chunk);
      else { tooLarge = true; child.kill(); }
    });
    child.on('error', () => reject(new Error(unavailable)));
    child.on('close', code => {
      if (tooLarge || code === null) return reject(new Error(unavailable));
      resolve({ code, output: Buffer.concat(stdout).toString('utf8'), error: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function missing(result) {
  return result.code === 44 && /^security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain\.\s*$/.test(result.error);
}

async function ensureKeychain() {
  if (process.platform !== 'darwin') throw new Error(unavailable);
  const result = await security(['show-keychain-info']);
  if (result.code !== 0) throw new Error(unavailable);
}

export async function saveSandboxCredentials(value) {
  const validated = credentials(value);
  await ensureKeychain();
  // The secret is passed through stdin, never in a process argument.
  const hex = Buffer.from(JSON.stringify(validated), 'utf8').toString('hex');
  const result = await security(['-i'], `add-generic-password -a ${account} -s ${service} -X ${hex} -U\n`);
  if (result.code !== 0) throw new Error(unavailable);
}

export async function loadSandboxCredentials() {
  await ensureKeychain();
  const result = await security(['find-generic-password', '-a', account, '-s', service, '-w']);
  if (missing(result)) return null;
  if (result.code !== 0) throw new Error(unavailable);
  try { return credentials(JSON.parse(result.output.trim())); }
  catch { throw new Error('Stored sandbox credentials are invalid. Reconnect the sandbox account.'); }
}

export async function deleteSandboxCredentials() {
  await ensureKeychain();
  const result = await security(['delete-generic-password', '-a', account, '-s', service]);
  if (result.code !== 0 && !missing(result)) throw new Error(unavailable);
}
