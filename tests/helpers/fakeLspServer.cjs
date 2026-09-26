// Minimal fake language server for lspTools tests: speaks LSP JSON-RPC over
// stdio with Content-Length framing. Deterministic answers derived from the
// opened document so tests can assert on paths/lines.
let buf = Buffer.alloc(0);
const docs = new Map(); // uri -> { text, version }

function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
  // Write header and body separately to exercise split-chunk parsing
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function wordAt(text, pos) {
  const line = text.split(/\r?\n/)[pos.line] || '';
  let s = pos.character;
  let e = pos.character;
  while (s > 0 && /[\w$]/.test(line[s - 1])) s--;
  while (e < line.length && /[\w$]/.test(line[e])) e++;
  return line.slice(s, e);
}

function occurrences(text, word) {
  const out = [];
  const re = new RegExp(`(?<![\\w$])${word}(?![\\w$])`, 'g');
  text.split(/\r?\n/).forEach((l, i) => {
    let m;
    while ((m = re.exec(l))) out.push({ start: { line: i, character: m.index }, end: { line: i, character: m.index + word.length } });
  });
  return out;
}

function publish(uri) {
  const { text } = docs.get(uri);
  const diagnostics = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const c = l.indexOf('BAD');
    if (c >= 0) diagnostics.push({ range: { start: { line: i, character: c }, end: { line: i, character: c + 3 } }, severity: 1, message: 'BAD is not allowed\nsecond line', source: 'fake', code: 42 });
  });
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      // Ask the client something, like real servers do
      send({ id: 'cfg1', method: 'workspace/configuration', params: { items: [{ section: 'x' }] } });
      return send({ id, result: { capabilities: { definitionProvider: true, referencesProvider: true, hoverProvider: true, documentSymbolProvider: true, workspaceSymbolProvider: true } } });
    case 'textDocument/didOpen':
      docs.set(params.textDocument.uri, { text: params.textDocument.text, version: params.textDocument.version });
      return setTimeout(() => publish(params.textDocument.uri), 50);
    case 'textDocument/didChange':
      docs.set(params.textDocument.uri, { text: params.contentChanges[0].text, version: params.textDocument.version });
      return setTimeout(() => publish(params.textDocument.uri), 50);
    case 'textDocument/definition': {
      const { text } = docs.get(params.textDocument.uri);
      const w = wordAt(text, params.position);
      const occ = occurrences(text, w);
      return send({ id, result: occ.length ? [{ targetUri: params.textDocument.uri, targetRange: occ[0], targetSelectionRange: occ[0] }] : null });
    }
    case 'textDocument/references': {
      const { text } = docs.get(params.textDocument.uri);
      let occ = occurrences(text, wordAt(text, params.position));
      if (!params.context.includeDeclaration) occ = occ.slice(1);
      return send({ id, result: occ.map((range) => ({ uri: params.textDocument.uri, range })) });
    }
    case 'textDocument/hover': {
      const { text } = docs.get(params.textDocument.uri);
      const w = wordAt(text, params.position);
      return send({ id, result: w ? { contents: { kind: 'markdown', value: `hover: ${w}` } } : null });
    }
    case 'textDocument/documentSymbol': {
      const { text } = docs.get(params.textDocument.uri);
      const syms = [];
      text.split(/\r?\n/).forEach((l, i) => {
        const m = /function (\w+)/.exec(l);
        if (m) {
          const r = { start: { line: i, character: m.index + 9 }, end: { line: i, character: m.index + 9 + m[1].length } };
          syms.push({ name: m[1], kind: 12, range: r, selectionRange: r, children: [] });
        }
      });
      return send({ id, result: syms });
    }
    case 'workspace/symbol': {
      const result = [];
      for (const [uri, { text }] of docs) {
        for (const range of occurrences(text, params.query).slice(0, 1)) result.push({ name: params.query, kind: 13, location: { uri, range } });
      }
      return send({ id, result });
    }
    case 'shutdown':
      return send({ id, result: null });
    case 'exit':
      return process.exit(0);
    default:
      if (id !== undefined && method) send({ id, error: { code: -32601, message: `unhandled ${method}` } });
  }
}

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n');
    if (h < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString())[1]);
    if (buf.length < h + 4 + len) return;
    const body = buf.subarray(h + 4, h + 4 + len).toString('utf8');
    buf = buf.subarray(h + 4 + len);
    handle(JSON.parse(body));
  }
});
