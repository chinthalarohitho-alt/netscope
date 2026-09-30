// Parser tests: feed logcat lines through the same code the live reader uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test: T } = require('../server.js');

const TAG = 'okhttp.OkHttpClient';
function device(pids = { 100: 'com.example.app' }) {
  return { serial: 'emu-1', key: 'hw:TEST', pids: new Map(Object.entries(pids).map(([k, v]) => [Number(k), v])) };
}
// Feed lines as [tid, message] (or [tid, message, tag]) on pid 100.
function feed(d, lines, pid = 100) {
  let ms = 0;
  for (const [tid, msg, tag = TAG] of lines) {
    ms += 1;
    T.ingest(d, `09-30 10:00:00.${String(ms).padStart(3, '0')}`, String(pid), String(tid), 'I', tag, msg);
  }
}
const calls = () => T.entries.map(T.serialize);

test.beforeEach(() => T.reset());

test('BODY level GET: headers without the blank separator, JSON body, END line', () => {
  const d = device();
  feed(d, [
    [7, '--> GET https://api.example.com/v1/items?page=1'],
    [7, 'Authorization: Bearer abc'],
    [7, 'Accept: application/json'],
    [7, '--> END GET'],
    [7, '<-- 200 https://api.example.com/v1/items?page=1 (123ms)'],
    [7, 'content-type: application/json'],
    [7, 'x-request-id: r1'],
    [7, '{"items":[1,2,3]}'],
    [7, '<-- END HTTP (17-byte body)'],
  ]);
  const [c] = calls();
  assert.equal(c.state, 'done');
  assert.equal(c.method, 'GET');
  assert.equal(c.status, 200);
  assert.equal(c.durationMs, 123);
  assert.deepEqual(c.reqHeaders, [['Authorization', 'Bearer abc'], ['Accept', 'application/json']]);
  assert.equal(c.respHeaders.length, 2);
  assert.deepEqual(JSON.parse(c.respBody), { items: [1, 2, 3] });
  assert.equal(c.size, 17);
  assert.equal(c.app, 'com.example.app');
});

test('POST with a request body', () => {
  const d = device();
  feed(d, [
    [8, '--> POST https://api.example.com/v1/orders (21-byte body)'],
    [8, 'Content-Type: application/json'],
    [8, '{"sku":"A1","qty":2}'],
    [8, '--> END POST (21-byte body)'],
    [8, '<-- 201 Created https://api.example.com/v1/orders (40ms)'],
    [8, '{"id":42}'],
    [8, '<-- END HTTP (9-byte body)'],
  ]);
  const [c] = calls();
  assert.equal(c.status, 201);
  assert.equal(c.statusText, 'Created');
  assert.deepEqual(JSON.parse(c.reqBody), { sku: 'A1', qty: 2 });
  assert.deepEqual(JSON.parse(c.respBody), { id: 42 });
});

test('BASIC level (release builds): the call completes on the response line', () => {
  const d = device();
  feed(d, [
    [9, '--> POST https://api.example.com/v2/schemes/evaluate (252-byte body)'],
    [9, '<-- 201 https://api.example.com/v2/schemes/evaluate (69ms, 192-byte body)'],
    [9, '--> GET https://api.example.com/v1/feed'],
    [9, '<-- 200 https://api.example.com/v1/feed (49ms, unknown-length body)'],
  ]);
  const [a, b] = calls();
  assert.equal(a.state, 'done');
  assert.equal(a.basic, true);
  assert.equal(a.size, 192);
  assert.equal(a.truncated, false);
  assert.equal(b.state, 'done');
  assert.equal(b.size, null);
});

test('HTTP FAILED marks the call failed with the exception', () => {
  const d = device();
  feed(d, [
    [3, '--> GET https://api.example.com/ping'],
    [3, '--> END GET'],
    [3, '<-- HTTP FAILED: java.net.UnknownHostException: Unable to resolve host "api.example.com"'],
  ]);
  const [c] = calls();
  assert.equal(c.state, 'failed');
  assert.match(c.error, /UnknownHostException/);
});

test('a long JSON body split into ~4000-char chunks is joined back without separators', () => {
  const d = device();
  const body = JSON.stringify({ rows: Array.from({ length: 800 }, (_, i) => ({ i, name: `item-${i}` })) });
  const chunks = body.match(/.{1,4000}/g);
  assert.ok(chunks.length > 1);
  feed(d, [
    [4, '--> GET https://api.example.com/big'],
    [4, '--> END GET'],
    [4, '<-- 200 https://api.example.com/big (10ms)'],
    [4, 'content-type: application/json'],
    ...chunks.map((c) => [4, c]),
    [4, `<-- END HTTP (${body.length}-byte body)`],
  ]);
  const [c] = calls();
  assert.equal(c.respBody, body);
  assert.equal(c.truncated, false);
});

test('a body shorter than its END size is flagged partial', () => {
  const d = device();
  feed(d, [
    [5, '--> GET https://api.example.com/big'],
    [5, '--> END GET'],
    [5, '<-- 200 https://api.example.com/big (10ms)'],
    [5, '{"rows":[1,2'],
    [5, '<-- END HTTP (5000-byte body)'],
  ]);
  const [c] = calls();
  assert.equal(c.truncated, true);
  assert.match(c.respNote, /partial/);
});

test('a missing END line is closed when the same thread starts its next call', () => {
  const d = device();
  feed(d, [
    [6, '--> GET https://api.example.com/a'],
    [6, '--> END GET'],
    [6, '<-- 200 https://api.example.com/a (5ms)'],
    [6, '{"partial":'],
    [6, '--> GET https://api.example.com/b'],
    [6, '--> END GET'],
  ]);
  const [a, b] = calls();
  assert.equal(a.state, 'done');
  assert.equal(a.truncated, true);
  assert.equal(b.url, 'https://api.example.com/b');
  assert.equal(b.state, 'pending');
});

test('calls on different threads interleave without mixing', () => {
  const d = device();
  feed(d, [
    [11, '--> GET https://api.example.com/one'],
    [12, '--> GET https://api.example.com/two'],
    [11, '--> END GET'],
    [12, '--> END GET'],
    [12, '<-- 404 https://api.example.com/two (7ms)'],
    [11, '<-- 200 https://api.example.com/one (9ms)'],
    [11, '{"n":1}'],
    [12, '{"error":"missing"}'],
    [11, '<-- END HTTP (7-byte body)'],
    [12, '<-- END HTTP (19-byte body)'],
  ]);
  const byUrl = Object.fromEntries(calls().map((c) => [c.url.split('/').pop(), c]));
  assert.equal(byUrl.one.status, 200);
  assert.deepEqual(JSON.parse(byUrl.one.respBody), { n: 1 });
  assert.equal(byUrl.two.status, 404);
  assert.deepEqual(JSON.parse(byUrl.two.respBody), { error: 'missing' });
});

test('lines from another tag on the same thread are not taken as body', () => {
  const d = device();
  feed(d, [
    [13, '--> GET https://api.example.com/x'],
    [13, '--> END GET'],
    [13, '<-- 200 https://api.example.com/x (3ms)'],
    [13, 'this is some other log line', 'MyActivity'],
    [13, '{"ok":true}'],
    [13, '<-- END HTTP (11-byte body)'],
  ]);
  const [c] = calls();
  assert.deepEqual(JSON.parse(c.respBody), { ok: true });
});

test('non-HTTP lines that merely start with an arrow do not create calls', () => {
  const d = device();
  feed(d, [[14, '--> GET not-a-url'], [14, '--> nothing here', 'Other']]);
  assert.equal(calls().length, 0);
});
