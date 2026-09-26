import http from 'http';
import type { AddressInfo } from 'net';

/**
 * In-process MCP servers over HTTP for tests.
 *
 * - Streamable HTTP at /mcp: POST JSON-RPC; replies as a JSON body
 *   (mode "json") or a one-shot SSE stream (mode "sse"). Assigns an
 *   Mcp-Session-Id on initialize and rejects later requests without it.
 * - Legacy SSE at /sse: GET opens the event stream and sends an `endpoint`
 *   event; POST /messages?sessionId=… gets 202 and the reply is pushed as a
 *   `message` event on the stream.
 *
 * Same surface as mockMcpServer.cjs: an `echo` tool, one resource, one prompt.
 */

interface RpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

export interface MockHttpServer {
  url: string;
  mode: 'json' | 'sse';
  /** Every request's headers, oldest first */
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body?: RpcMessage }[];
  close: () => Promise<void>;
}

function handleRpc(msg: RpcMessage): unknown {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'mock-http-mcp', version: '1.0.0' },
      };
    case 'tools/list':
      return {
        tools: [{
          name: 'echo',
          description: 'Echo back the provided text',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        }],
      };
    case 'tools/call': {
      const args = (msg.params?.arguments ?? {}) as { text?: string };
      return { content: [{ type: 'text', text: `http echo: ${args.text ?? ''}` }] };
    }
    case 'resources/list':
      return { resources: [{ uri: 'mem://doc', name: 'Doc', mimeType: 'text/markdown' }] };
    case 'resources/read':
      return { contents: [{ uri: msg.params?.uri, text: '# remote doc' }] };
    case 'prompts/list':
      return { prompts: [{ name: 'review', description: 'Review a file', arguments: [{ name: 'file', required: true }] }] };
    case 'prompts/get': {
      const a = (msg.params?.arguments ?? {}) as { file?: string };
      return {
        messages: [
          { role: 'user', content: { type: 'text', text: `Review ${a.file}` } },
          { role: 'assistant', content: { type: 'text', text: 'Sure.' } },
        ],
      };
    }
    default:
      return undefined;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
  });
}

export async function startMockHttpServer(mode: 'json' | 'sse' = 'json'): Promise<MockHttpServer> {
  const requests: MockHttpServer['requests'] = [];
  const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
  const sseClients = new Map<string, http.ServerResponse>();
  let nextSse = 1;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const raw = req.method === 'POST' ? await readBody(req) : '';
    const body = raw ? (JSON.parse(raw) as RpcMessage) : undefined;
    requests.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body });

    // ── Streamable HTTP ──
    if (url.pathname === '/mcp') {
      if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
      if (req.method !== 'POST' || !body) { res.writeHead(405).end(); return; }
      if (body.method !== 'initialize' && req.headers['mcp-session-id'] !== sessionId) {
        res.writeHead(400).end('missing session');
        return;
      }
      if (body.id === undefined) { res.writeHead(202).end(); return; }
      const reply = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: handleRpc(body) });
      const headers: Record<string, string> = { 'Mcp-Session-Id': sessionId };
      if (mode === 'sse') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream' });
        // A server notification first, then the reply, split across writes
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\n`);
        res.write(`: keep-alive\n\nevent: message\ndata: ${reply.slice(0, 10)}`);
        res.end(`${reply.slice(10)}\n\n`);
      } else {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        res.end(reply);
      }
      return;
    }

    // ── Legacy SSE ──
    if (url.pathname === '/sse' && req.method === 'GET') {
      const id = String(nextSse++);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`event: endpoint\ndata: /messages?sessionId=${id}\n\n`);
      sseClients.set(id, res);
      req.on('close', () => sseClients.delete(id));
      return;
    }
    if (url.pathname === '/messages' && req.method === 'POST' && body) {
      const stream = sseClients.get(url.searchParams.get('sessionId') ?? '');
      if (!stream) { res.writeHead(404).end(); return; }
      res.writeHead(202).end('Accepted');
      if (body.id !== undefined) {
        const reply = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: handleRpc(body) });
        stream.write(`event: message\ndata: ${reply}\n\n`);
      }
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    mode,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sseClients.values()) s.end();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
