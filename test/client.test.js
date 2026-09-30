// Page logic that doesn't need a browser: API client (cURL, Postman, variables) and features
// (HAR export, GraphQL labels, diff). The browser files are loaded into a sandbox with stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  S: { byId: new Map() },
  $: () => null,
  // Same escaping as the page, so the HTML-safety tests mean something.
  esc: (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  toast() {},
  copy() {},
  fmtTime: (x) => `${x} ms`,
  fmtSize: (x) => `${x} B`,
  parseUrl: (u) => { try { return new URL(u); } catch { return null; } },
  tryJson: (t) => { if (!t) return undefined; try { return JSON.parse(t); } catch { return undefined; } },
  statusPill: () => '',
  pathHtml: () => '',
  devName: (x) => x,
  mimeOf: (e) => e.mime || '',
  store: { get: () => null, set() {}, del() {} },
  document: { head: { insertAdjacentHTML() {} }, querySelector: () => null, addEventListener() {} },
  window: { addEventListener() {} },
  requestAnimationFrame: (f) => f(),
  URL, Date, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent, decodeURIComponent,
};
vm.createContext(ctx);
for (const f of ['features.js', 'client.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
const run = (code) => vm.runInContext(code, ctx);

test('cURL import: method, headers, bearer auth and JSON body', () => {
  const r = run(`fromCurl("curl -X POST 'https://api.example.com/v1/items?x=1' -H 'Content-Type: application/json' -H 'Authorization: Bearer tok.123' --data-raw '{\\"a\\":1}'")`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.example.com/v1/items?x=1');
  assert.deepEqual(JSON.parse(JSON.stringify(r.auth)), { type: 'bearer', token: 'tok.123' });
  assert.equal(r.body.mode, 'json');
  assert.deepEqual(JSON.parse(r.body.text), { a: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(r.params.map((p) => p.key))), ['x']);
  assert.equal(r.headers.some((h) => /authorization/i.test(h.key)), false, 'the token moves to Auth');
});

test('cURL import: -d defaults to POST, -u becomes basic auth', () => {
  const r = run(`fromCurl("curl https://example.com/form -u alice:s3cret -d 'a=1&b=2'")`);
  assert.equal(r.method, 'POST');
  assert.equal(r.auth.type, 'basic');
  assert.equal(r.auth.username, 'alice');
  assert.equal(r.body.text, 'a=1&b=2');
});

test('variables resolve from the environment, with the environment beating collection vars', () => {
  run(`
    C.ws = { collections: [{ id: 'c1', type: 'collection', name: 'API', vars: [{ key: 'baseUrl', value: 'https://col.example', enabled: true }, { key: 'v', value: '1' }], items: [
      { id: 'r1', type: 'request', name: 'x', method: 'GET', url: '{{baseUrl}}/v{{v}}/me', params: [], headers: [{ key: 'X-Id', value: '{{userId}}', enabled: true }], body: { mode: 'none' }, auth: { type: 'inherit' } } ],
      auth: { type: 'bearer', token: '{{token}}' } }],
      environments: [{ id: 'e1', name: 'dev', vars: [{ key: 'baseUrl', value: 'https://dev.example', enabled: true }, { key: 'token', value: 'T', enabled: true }] }],
      activeEnv: 'e1' };
    C.openId = 'r1';
  `);
  const b = run(`buildRequest(findNode('r1').node)`);
  assert.equal(b.url, 'https://dev.example/v1/me');
  assert.deepEqual(JSON.parse(JSON.stringify(b.headers)), [['X-Id', '{{userId}}'], ['Authorization', 'Bearer T']]);
  assert.deepEqual(JSON.parse(JSON.stringify([...b.missing])), ['userId']);
});

test('params table and URL stay in sync, keeping {{vars}} readable', () => {
  const url = run(`urlWithParams('https://x.example/p?old=1', [{ key: 'q', value: 'a b', enabled: true }, { key: 'id', value: '{{id}}', enabled: true }, { key: 'off', value: '1', enabled: false }])`);
  assert.equal(url, 'https://x.example/p?q=a%20b&id={{id}}');
  const params = run(`paramsFromUrl('https://x.example/p?q=a%20b&flag')`);
  assert.deepEqual(JSON.parse(JSON.stringify(params)), [{ key: 'q', value: 'a b', enabled: true }, { key: 'flag', value: '', enabled: true }]);
});

test('Postman v2.1 round trip keeps folders, bodies, auth and variables', () => {
  const pm = {
    info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'host', value: 'https://shop.example' }],
    auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: '{{k}}' }, { key: 'in', value: 'header' }] },
    item: [
      { name: 'Orders', item: [{ name: 'Create', request: { method: 'POST', header: [{ key: 'X-A', value: '1', disabled: true }], url: { raw: '{{host}}/orders' }, body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } } } }] },
      { name: 'Login', request: { method: 'POST', url: '{{host}}/login', body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'u' }] }, auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] } } },
    ],
  };
  const col = run(`(${JSON.stringify(pm)}).item.map(pmItemIn)`);
  assert.equal(col[0].type, 'folder');
  assert.equal(col[0].items[0].body.mode, 'json');
  assert.equal(col[0].items[0].headers[0].enabled, false);
  assert.equal(col[1].body.mode, 'urlencoded');
  assert.equal(col[1].auth.type, 'basic');
  ctx.__col = { id: 'c', name: 'Shop', items: col, vars: [{ key: 'host', value: 'https://shop.example', enabled: true }], auth: run(`pmAuthIn(${JSON.stringify(pm.auth)})`) };
  const out = run(`toPostman(__col)`);
  assert.equal(out.item[0].item[0].request.body.options.raw.language, 'json');
  assert.equal(out.item[1].request.body.urlencoded[0].key, 'user');
  assert.equal(out.item[1].request.auth.type, 'basic');
  assert.equal(out.auth.type, 'apikey');
  assert.equal(out.variable[0].key, 'host');
});

test('GraphQL operations are labelled by name', () => {
  const p = run(`gqlOf(JSON.stringify({ query: 'mutation AddItem($id: ID!) { add(id: $id) { ok } }' }))`);
  assert.equal(p.kind, 'gql');
  assert.equal(p.label, 'mutation AddItem');
  assert.equal(run(`gqlOf('{"hello":1}')`), null);
});

test('line diff finds exactly the changed lines', () => {
  const { out } = run(`diffLines('a\\nb\\nc\\nd', 'a\\nB\\nc\\nd\\ne')`);
  // (JSON round trip: arrays made inside the sandbox have a different Array prototype.)
  assert.deepEqual(JSON.parse(JSON.stringify(out.filter(([k]) => k !== 'same'))), [['a', 'b'], ['b', 'B'], ['b', 'e']]);
});

test('HAR export has the fields other tools expect', () => {
  const har = run(`toHar([{ method: 'POST', url: 'https://a.example/x?q=1', started: '09-30 10:00:00.000', durationMs: 50, status: 201, statusText: 'Created',
    reqHeaders: [['Content-Type', 'application/json']], reqBody: '{"a":1}', respHeaders: [['content-type', 'application/json']], respBody: '{"ok":true}', size: 11, mime: 'application/json' }])`);
  const e = har.log.entries[0];
  assert.equal(har.log.version, '1.2');
  assert.equal(e.request.postData.mimeType, 'application/json');
  assert.deepEqual(JSON.parse(JSON.stringify(e.request.queryString)), [{ name: 'q', value: '1' }]);
  assert.equal(e.response.content.text, '{"ok":true}');
  assert.equal(e.time, 50);
});

test('Markdown renderer: headings, code, tables, lists, links — and no raw HTML', () => {
  const html = run(`mdRender('# Title\\n\\nSome **bold** and \\\`code\\\`.\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |\\n\\n- one\\n- [x] done\\n\\n\\\`\\\`\\\`json\\n{"a":1}\\n\\\`\\\`\\\`\\n\\n[site](https://example.com) <script>alert(1)</script>')`);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<table class="md-table">.*<th>a<\/th>.*<td>2<\/td>/s);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /☑/);
  assert.match(html, /<pre class="md-code" data-lang="json"><code>\{(&quot;|")a(&quot;|"):1\}<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(run(`mdRender('[x](javascript:alert(1))')`), /href="javascript/);
});

test('Postman scripts and descriptions survive import and export', () => {
  const item = { name: 'Login', description: 'Signs a user in', event: [{ listen: 'prerequest', script: { exec: ['pm.variables.set("a", 1);'] } }, { listen: 'test', script: { exec: ['pm.test("ok", () => {});', 'console.log(1);'] } }], request: { method: 'POST', url: 'https://x.example/login' } };
  const r = run(`pmItemIn(${JSON.stringify(item)})`);
  assert.equal(r.docs, 'Signs a user in');
  assert.equal(r.scripts.pre, 'pm.variables.set("a", 1);');
  assert.equal(r.scripts.post, 'pm.test("ok", () => {});\nconsole.log(1);');
  const out = JSON.parse(JSON.stringify(run(`pmItemOut(${JSON.stringify(r)})`)));
  assert.deepEqual(out.event.map((e) => e.listen), ['prerequest', 'test']);
  assert.deepEqual(out.event[1].script.exec, ['pm.test("ok", () => {});', 'console.log(1);']);
  assert.equal(out.request.description, 'Signs a user in');
});
