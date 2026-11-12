# Sandbox merchant funding attempt

PayPal's [sandbox dispute guide](https://developer.paypal.com/platforms/disputes/test-go-live/) describes signing in to a sandbox personal account and using Send and Request to send simulated funds to the sandbox business account. This uses the sandbox environment and does not move real money.

On November 12, 2026, the available Chrome sandbox session was signed out. PayPal accepted the existing sandbox test buyer's account identifier and then presented a password field with no visible saved credential. The other previously available sandbox browser sessions were also signed out. The Developer Dashboard session needed to view the generated sandbox credentials was signed out as well. The test buyer and recipient could not both be confirmed in an authenticated sandbox session, so no transfer was attempted.

An automatic approval review rejected a targeted system Keychain lookup for the sandbox buyer credential as high-risk credential discovery and forbade indirect workarounds. No password was retrieved. Funding therefore remains blocked until an authorized existing sandbox buyer session or an approved credential source is available. A future successful simulated transfer would not resolve the outcomes of earlier uncertain refunds, and its effect on refund availability would need a fresh sandbox replay.

After the user explicitly approved access to the test-buyer credentials, a new targeted check for that exact sandbox account and domain completed without displaying any credential and found no matching saved login. The sandbox buyer and developer dashboard still showed password fields without a saved credential. No transfer was attempted.
