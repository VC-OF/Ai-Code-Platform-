#!/usr/bin/env node
// Minimal MCP server over stdio (newline-delimited JSON-RPC) for tests.
// Implements: initialize, tools/list, tools/call with one `echo` tool.

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function handle(msg) {
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo back the provided text',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params ?? {};
    if (name === 'echo') {
      reply(msg.id, {
        content: [{ type: 'text', text: `echo: ${args?.text ?? ''}` }],
      });
    } else {
      reply(msg.id, {
        content: [{ type: 'text', text: `unknown tool ${name}` }],
        isError: true,
      });
    }
  }
  // notifications (no id) are ignored
}
