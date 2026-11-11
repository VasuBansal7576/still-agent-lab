# Persistent sandbox credentials

`server/sandbox-credentials.mjs` stores one PayPal sandbox client ID and secret in the current macOS user's default Keychain. It never writes credentials to the repository or a file. The Keychain may prompt for access. A locked, unavailable, or unsupported Keychain produces an error rather than silently falling back to plaintext storage.

The server uses this storage after it authenticates the sandbox connection with PayPal. The integration follows this contract:

```js
import { saveSandboxCredentials, loadSandboxCredentials, deleteSandboxCredentials } from './sandbox-credentials.mjs';

// On an explicit connect, validate with PayPal first, then persist before reporting success.
await saveSandboxCredentials({ clientId, clientSecret });

// On startup, load once and build the PayPal client if a stored connection exists.
const saved = await loadSandboxCredentials(); // null means no item exists
if (saved) createPayPalSandbox(saved);

// The module provides a deletion operation for a future disconnect control.
await deleteSandboxCredentials();
```

Each operation can reject with a sanitized error. A missing item is `null`; an inaccessible Keychain is an error, not a missing connection. Do not log the returned credentials or send them to the browser. Save a new connection only after PayPal authentication succeeds. Do not report persistent connection success if saving fails. Decide explicitly whether configured environment credentials take precedence over a saved connection; do not overwrite either silently.

On non-macOS systems there is no persistent fallback. Supply `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the server process environment for each launch, or reconnect each time, and clearly indicate that connection is not persistent. An operating-system secret store integration is needed for persistence there.

To verify on a Mac with an available, unlocked default Keychain, call save with synthetic values matching the accepted ID and secret format, terminate that process, and call load from another process. Compare the fields in memory and print only whether they match. Then call delete and confirm a subsequent load returns `null`. Use an isolated macOS user or Keychain for this check because the module manages the application's one connection. Never use real credentials in command arguments or output.
