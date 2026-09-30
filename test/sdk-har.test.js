// Library (netscope_<pid> socket) events and HAR import.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test: T } = require('../server.js');

test.beforeEach(() => T.reset());

test('library events map to a complete call', () => {
  const d = { serial: 'emu-1', key: 'hw:TEST', pids: new Map([[200, 'com.example.sdk']]) };
  const c = { name: 'netscope_200', pid: 200, reqs: new Map() };
  T.sdkEvent(d, c, { t: 'req', id: 1, ts: Date.now(), method: 'POST', url: 'https://api.example.com/v1/login', headers: [['Content-Type', 'application/json']], body: '{"u":"a"}' });
  T.sdkEvent(d, c, { t: 'resp', id: 1, status: 200, message: 'OK', ms: 88, headers: [['content-type', 'application/json; charset=utf-8']], body: '{"token":"t"}', size: 13 });
  T.sdkEvent(d, c, { t: 'req', id: 2, ts: Date.now(), method: 'GET', url: 'https://api.example.com/down', headers: [] });
  T.sdkEvent(d, c, { t: 'err', id: 2, ms: 12, error: 'java.net.SocketTimeoutException: timeout' });
  const [a, b] = T.entries.map(T.serialize);
  assert.equal(a.source, 'sdk');
  assert.equal(a.app, 'com.example.sdk');
  assert.equal(a.state, 'done');
  assert.equal(a.status, 200);
  assert.equal(a.durationMs, 88);
  assert.equal(a.mime, 'application/json');
  assert.equal(a.reqBody, '{"u":"a"}');
  assert.equal(a.respBody, '{"token":"t"}');
  assert.equal(b.state, 'failed');
  assert.match(b.error, /SocketTimeout/);
  assert.equal(c.reqs.size, 0, 'finished calls are released');
});

test('HAR import turns entries into calls, keeping bodies and failures', () => {
  const har = {
    log: {
      entries: [
        {
          startedDateTime: '2026-09-30T10:00:00.000Z',
          time: 120,
          request: { method: 'GET', url: 'https://api.example.com/a', headers: [{ name: 'Accept', value: '*/*' }] },
          response: { status: 200, statusText: 'OK', headers: [{ name: 'content-type', value: 'application/json' }], content: { size: 7, mimeType: 'application/json', text: '{"a":1}' } },
        },
        {
          startedDateTime: '2026-09-30T10:00:01.000Z',
          time: 5,
          request: { method: 'POST', url: 'https://api.example.com/b', headers: [], postData: { mimeType: 'text/plain', text: 'hi' } },
          response: { status: 0, headers: [], content: { size: 0 } },
          _netscope: { error: 'Canceled' },
        },
      ],
    },
  };
  assert.equal(T.importHar(har, 'session.har'), 2);
  const [a, b] = T.entries.map(T.serialize);
  assert.equal(a.source, 'har');
  assert.equal(a.status, 200);
  assert.equal(a.respBody, '{"a":1}');
  assert.equal(a.durationMs, 120);
  assert.equal(b.state, 'failed');
  assert.equal(b.error, 'Canceled');
  assert.equal(b.reqBody, 'hi');
  assert.throws(() => T.importHar({ nope: true }, 'x.har'), /Not a HAR/);
});
