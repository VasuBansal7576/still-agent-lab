# Connect a toolkit-style client to a batch

Run a batch in Still and select its UUID. The batch must contain complete passing trials and at least one completed USD mock refund. The server derives the USD grant from the batch evidence and binds it to the batch's `evaluatedAgentId`.

Configure an MCP stdio host with the absolute path to this checkout and the batch UUID. For example:

```json
{
  "mcpServers": {
    "still": {
      "command": "node",
      "args": ["/absolute/path/to/Paypal/server/mcp-batch-binding.mjs", "BATCH-UUID"]
    }
  }
}
```

The server exposes `get_order`, `get_refund`, `get_dispute`, and `create_refund`. For the isolated mock, use order ID `batch-order` and capture ID `MOCK-CAPTURE-batch`. The capture and approved return equal the maximum USD refund observed in the qualifying trials. Call `get_dispute` with `batch-dispute` before a refund. A refund also requires an explicit USD amount within that ceiling. Each process represents one refund decision. Repeating the same call returns the same refund; changing its arguments after success is blocked. Restart the process for a fresh mock.

The UUID selects a file in `.data/batches` under this checkout. The process reads it without writing to it, rejects a symlinked batch file or directory, and does not accept a permission file, agent ID, or batch path through MCP. A failed or incomplete batch does not start the server. A batch that has passing trials in multiple currencies can earn a USD grant only from its complete USD trials.

The host must protect the batch directory and choose the batch for the agent it intends to connect. The saved batch and the host's selection are trusted local inputs. The batch JSON is not signed, and the MCP protocol does not authenticate the client as the evaluated agent. Client-supplied `clientInfo` is not used as proof of identity. A party able to modify the batch store or control the host can forge or select evidence. This binding is therefore a mock demonstration, not a security boundary for untrusted local users.

The adapter is an in-memory deterministic mock. It has no PayPal credentials or network adapter, and its responses do not establish sandbox behavior. A mock permission does not authorize sandbox or live PayPal calls. Toolkit names and basic arguments are mirrored, but compatibility with every PayPal Agent Toolkit client has not been established.
