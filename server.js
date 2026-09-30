#!/usr/bin/env node
// Netscope — live network inspector for Android apps over adb.
//
// The debug build logs every API call through OkHttp's HttpLoggingInterceptor
// (Level.BODY) to logcat under the tag `okhttp.OkHttpClient`. This script tails
// that tag over adb, stitches the lines back into request/response pairs, and
// serves a DevTools-style page that updates live.
//
//   node server.js            # include calls already in the logcat buffer
//   node server.js --fresh    # only calls made from now on
//   PORT=9500 node server.js  # different port (default 9400)
//
// No npm dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execFile } = require('child_process');

let ADB = process.env.ADB || 'adb';
const MAX_ENTRIES = 50000;
const BODY_BUDGET = 400 * 1024 * 1024; // keep at most this much body text; oldest bodies go first
let FRESH = process.argv.includes('--fresh');
const BACKLOG_LINES = 20000; // history read per device on first connect
let stopped = false;

const entries = [];
const active = new Map(); // "serial:pid:tid" -> in-flight entry (OkHttp runs one call per thread)
const clients = new Set();
let nextId = 1;
// adb address (serial) -> device. Only connected devices live here; `known` keeps each physical
// device's name and log position across disconnects, keyed by its hardware serial, so a phone
// reached over two addresses (mDNS name and ip:port) is read once and labelled consistently.
const devices = new Map();
const known = new Map(); // key -> { name, kind, lastStamp }
let adbStatus = 'starting'; // 'ok' | 'adb not found'

// Raw logcat lines, kept for the "Raw logs" view and each request's Raw tab.
const RAW_MAX_BYTES = 40 * 1024 * 1024;
const rawBuf = []; // { seq, device, stamp, pid, tid, msg }
const rawIndex = new Map(); // seq -> line
let rawBytes = 0;
let rawSeq = 0;
const rawClients = new Set();
let rawPending = [];

// 09-29 16:39:13.399 12047 15164 I okhttp.OkHttpClient: <message>
// 09-29 16:39:13.399 12047 15164 I okhttp.OkHttpClient: <message>
// Every tag is read: any app that logs through OkHttp's HttpLoggingInterceptor is picked up,
// whatever tag its logger writes under.
const LINE_RE = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:(?: (.*))?$/;
const REQ_RE = /^--> (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (https?:\/\/\S+)/;
const RESP_RE = /^<-- (\d{3})\b(.*?)\((\d+)ms/;
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+: /;

function joinBody(lines) {
  if (!lines.length) return '';
  // Android's logger chunks long messages at ~4000 chars; JSON bodies are one line,
  // so chunks rejoin with no separator. Fall back to newlines for anything else.
  const flat = lines.join('');
  try {
    JSON.parse(flat);
    return flat;
  } catch {
    return lines.join('\n');
  }
}

function lastParen(msg) {
  const m = msg.match(/\(([^()]*)\)\s*$/);
  return m ? m[1] : '';
}

function serialize(e) {
  return {
    id: e.id,
    device: e.device,
    app: e.app,
    pid: e.pid,
    started: e.started,
    method: e.method,
    url: e.url,
    state: e.state,
    status: e.status,
    statusText: e.statusText,
    durationMs: e.durationMs,
    error: e.error,
    reqHeaders: e.reqHeaders,
    reqBody: joinBody(e.reqBody),
    reqNote: e.reqNote,
    respHeaders: e.respHeaders,
    respBody: joinBody(e.respBody),
    respNote: e.respNote,
    size: e.size,
    transferSize: e.transferSize,
    truncated: e.truncated,
    basic: !!e.basic,
    source: e.source || 'okhttp',
    hidden: !!e.hidden,
    mime: e.mime,
    resourceType: e.resourceType,
  };
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of clients) send(res, event, data);
}

function publish(e) {
  broadcast('entry', serialize(e));
}

function deviceList() {
  return [...devices.values()]
    .filter((d) => d.online && d.active)
    .map((d) => ({ serial: d.key, addr: d.serial, name: d.name, kind: d.kind, online: true }))
    .concat([...localBrowsers.values()].map((b) => ({ serial: b.key, addr: `localhost:${b.port}`, name: b.name, kind: 'browser', online: true })));
}

function devicesPayload() {
  const names = {};
  for (const [k, v] of known) names[k] = { name: v.name, kind: v.kind };
  return { adb: adbStatus, devices: deviceList(), names };
}

function publishDevices() {
  broadcast('devices', devicesPayload());
}

function addHeader(list, msg) {
  const i = msg.indexOf(': ');
  if (i > 0) list.push([msg.slice(0, i), msg.slice(i + 2)]);
  else list.push([msg, '']);
}

function handle(serial, stamp, pid, tid, msg) {
  const key = `${serial}:${pid}:${tid}`;
  let m;

  if ((m = msg.match(REQ_RE))) {
    // A thread only starts a new call once its previous one is over, so a call still
    // open here lost its end line (big bodies can overflow the logcat ring buffer).
    const prev = active.get(key);
    if (prev) {
      if (prev.status != null) {
        prev.state = 'done';
        prev.truncated = true;
        prev.respNote = 'response body truncated — its end was dropped from logcat';
      } else {
        prev.state = 'failed';
        prev.error = 'No response logged (lines dropped from logcat)';
      }
      publish(prev);
    }
    const e = {
      id: nextId++,
      device: serial,
      pid: Number(pid),
      started: stamp,
      method: m[1],
      url: m[2],
      state: 'pending',
      phase: 'reqHeaders',
      status: null,
      statusText: '',
      durationMs: null,
      error: null,
      reqHeaders: [],
      reqBody: [],
      reqNote: lastParen(msg),
      respHeaders: [],
      respBody: [],
      respNote: '',
      size: null,
      transferSize: null,
      truncated: false,
    };
    active.set(key, e);
    entries.push(e);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    publish(e);
    return;
  }

  const e = active.get(key);
  if (!e) return;

  if (msg.startsWith('--> END ')) {
    e.reqNote = lastParen(msg) || e.reqNote;
    e.phase = 'waiting';
    return;
  }
  if ((m = msg.match(/^<-- HTTP FAILED: (.*)$/))) {
    e.state = 'failed';
    e.error = m[1];
    active.delete(key);
    publish(e);
    return;
  }
  if ((m = msg.match(RESP_RE))) {
    const tokens = m[2].trim().split(/\s+/).filter(Boolean);
    tokens.pop(); // the URL
    e.status = Number(m[1]);
    e.statusText = tokens.join(' ');
    e.durationMs = Number(m[3]);
    e.phase = 'respHeaders';
    // Level.BASIC (release builds) puts the size on this line — "(49ms, 192-byte body)" — and
    // logs no headers, body or END line, so the call is complete right here.
    const basic = msg.match(/\(\d+ms, ([^)]*)\)\s*$/);
    if (basic) {
      const n = basic[1].match(/(\d+)-byte/);
      e.size = e.transferSize = n ? Number(n[1]) : null;
      e.basic = true;
      e.respNote = 'Logged at Level.BASIC (release build): no headers or body were written to logcat';
      if (e.reqBody.length === 0 && /\(\d+-byte body\)$/.test(e.reqNote ? `(${e.reqNote})` : '')) {
        e.reqNote = `${e.reqNote} — not logged at Level.BASIC`;
      }
      e.state = 'done';
      active.delete(key);
    }
    publish(e);
    return;
  }
  if (msg.startsWith('<-- END HTTP')) {
    e.respNote = lastParen(msg);
    const nums = [...e.respNote.matchAll(/(\d+)-(?:gzipped-)?byte/g)].map((x) => Number(x[1]));
    if (nums.length) {
      e.size = nums[0];
      e.transferSize = nums[1] ?? nums[0];
    }
    const logged = joinBody(e.respBody).length;
    if (e.size && logged < e.size * 0.98) {
      e.truncated = true;
      e.respNote = `partial body — logcat dropped part of it (${logged} of ${e.size} bytes logged)`;
    }
    e.state = 'done';
    active.delete(key);
    publish(e);
    return;
  }

  // Android's logger drops the empty line OkHttp prints between headers and body,
  // so the body starts at the first line that isn't shaped like a header.
  switch (e.phase) {
    case 'reqHeaders':
      if (msg === '') e.phase = 'reqBody';
      else if (HEADER_RE.test(msg)) addHeader(e.reqHeaders, msg);
      else {
        e.phase = 'reqBody';
        e.reqBody.push(msg);
      }
      break;
    case 'reqBody':
      e.reqBody.push(msg);
      break;
    case 'respHeaders':
      if (msg === '') e.phase = 'respBody';
      else if (HEADER_RE.test(msg)) addHeader(e.respHeaders, msg);
      else {
        e.phase = 'respBody';
        e.respBody.push(msg);
      }
      break;
    case 'respBody':
      e.respBody.push(msg);
      break;
  }
}

// pid -> app package, per device, from `ps`. Refreshed (throttled) when an unknown pid shows up.
function appOf(d, pid) {
  const name = d.pids?.get(pid);
  if (name) return name;
  const now = Date.now();
  if (!d.psBusy && now - (d.psAt || 0) > 3000) {
    d.psBusy = true;
    adb(['-s', d.serial, 'shell', 'ps -A -o PID,NAME'], (err, out) => {
      d.psBusy = false;
      d.psAt = Date.now();
      if (err) return;
      const map = new Map();
      for (const l of out.split('\n').slice(1)) {
        const [p, n] = l.trim().split(/\s+/);
        if (p && n) map.set(Number(p), n);
      }
      d.pids = new Map([...(d.pids || []), ...map]);
      // Fill in calls that were waiting for their app name.
      for (const e of entries) {
        if (e.device === d.key && !e.app && map.has(e.pid)) {
          e.app = map.get(e.pid);
          publish(e);
        }
      }
    });
  }
  return null;
}

const START_PROC_RE = /Start proc (\d+):([\w.]+)/;

function ingest(d, stamp, pid, tid, level, tag, msg) {
  const serial = d.key;
  // ActivityManager announces every process start, which names pids even after they exit.
  if (tag === 'ActivityManager') {
    const sp = msg.match(START_PROC_RE);
    if (sp) (d.pids ||= new Map()).set(Number(sp[1]), sp[2]);
  }
  const key = `${serial}:${pid}:${tid}`;
  const before = active.get(key);
  const isReq = REQ_RE.test(msg) && !d.sdkPids?.has(Number(pid));
  // A continuation line only counts when it comes from the same tag as the call it continues.
  const http = isReq || (before && before.tag === tag);

  const r = { seq: ++rawSeq, device: serial, stamp, pid: Number(pid), tid: Number(tid), level, tag, msg, http: !!http };
  if (http) r.app = appOf(d, r.pid);
  rawBuf.push(r);
  rawIndex.set(r.seq, r);
  rawBytes += msg.length + tag.length + 64;
  while (rawBytes > RAW_MAX_BYTES && rawBuf.length) {
    const old = rawBuf.shift();
    rawIndex.delete(old.seq);
    rawBytes -= old.msg.length + old.tag.length + 64;
  }
  if (rawClients.size) rawPending.push(r);
  if (!http) return;

  handle(serial, stamp, pid, tid, msg);
  const owner = isReq ? active.get(key) : before;
  if (!owner) return;
  if (isReq) {
    owner.tag = tag;
    owner.app = r.app || appOf(d, owner.pid);
  }
  (owner.raw ||= []).push(r.seq);
}

setInterval(() => {
  if (!rawPending.length) return;
  const batch = `event: lines\ndata: ${JSON.stringify(rawPending)}\n\n`;
  rawPending = [];
  for (const res of rawClients) res.write(batch);
}, 150).unref();

function adb(args, cb) {
  execFile(ADB, args, { timeout: 8000 }, (err, stdout) => cb(err, String(stdout || '').trim()));
}

const WIRELESS_BACKLOG_MIN = 2;

// Wireless adb is slow, so a wireless device only replays its last few minutes on first connect.
function isWireless(d) {
  return /:\d+$/.test(d.serial) || d.serial.includes('._adb-tls-connect.');
}

// One `adb -s <serial> logcat` per connected device, so calls from each are tagged.
function startLogcat(d) {
  if (stopped || !d.active || d.child) return;
  if (!d.lastStamp && !FRESH && isWireless(d) && !d.sinceStamp) {
    // Ask the device for its clock (log stamps are in device local time).
    adb(['-s', d.serial, 'shell', 'date +%Y-%m-%dT%H:%M:%S'], (err, out) => {
      const t = new Date(String(out).trim());
      if (!err && !Number.isNaN(t.getTime())) {
        t.setMinutes(t.getMinutes() - WIRELESS_BACKLOG_MIN);
        const p = (n) => String(n).padStart(2, '0');
        d.sinceStamp = `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.000`;
      } else {
        d.sinceStamp = '1';
      }
      startLogcat(d);
    });
    return;
  }
  const args = ['-s', d.serial, 'logcat', '-v', 'threadtime'];
  // Resume after a reconnect; otherwise start from recent history only. A full 16 MiB buffer
  // takes minutes to stream (much longer over wireless adb), and live calls would queue behind it.
  if (d.lastStamp) args.push('-T', d.lastStamp);
  else if (FRESH) args.push('-T', '1');
  else if (d.sinceStamp) args.push('-T', d.sinceStamp);
  else args.push('-T', String(BACKLOG_LINES));

  const child = spawn(ADB, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  d.child = child;
  const resumeFrom = d.lastStamp;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const m = line.match(LINE_RE);
    if (!m) return;
    const [, stamp, pid, tid, level, tag, msg = ''] = m;
    if (resumeFrom && stamp <= resumeFrom) return; // -T replays the boundary line
    d.lastStamp = stamp;
    if (d.known) d.known.lastStamp = stamp;
    try {
      ingest(d, stamp, pid, tid, level, tag, msg);
    } catch (err) {
      logError('ingest', err); // one odd line must never stop the reader
    }
  });
  child.stderr.on('data', (x) => process.stderr.write(`[adb ${d.serial}] ${x}`));
  child.on('error', () => {});
  child.on('close', () => {
    d.child = null;
    // Still listed by `adb devices`? Then logcat died on its own — restart it.
    if (!stopped && d.active) setTimeout(() => startLogcat(d), 2000);
  });
}

// "Pixel_8_API_35_PlayStore" -> "Pixel 8 · API 35"
function prettyAvd(avd) {
  const words = avd.replace(/_/g, ' ').replace(/\s+(PlayStore|Play Store|Google APIs?)$/i, '').trim();
  return words.replace(/\s+API\s+(\d+)$/i, ' · API $1');
}

function describe(d) {
  const props = [
    'settings get global device_name',
    'getprop ro.boot.qemu.avd_name',
    'getprop ro.kernel.qemu.avd_name',
    'getprop ro.product.marketname',
    'getprop ro.product.brand',
    'getprop ro.product.model',
    'getprop ro.kernel.qemu',
    'getprop ro.serialno',
    'getprop ro.boot.serialno',
  ].join('; echo "|"; ');
  adb(['-s', d.serial, 'shell', props], (err, out) => {
    const [deviceName, avd1, avd2, market, brand, model, qemu, sn1, sn2] = (out || '').split('|').map((x) => x.trim());
    const hw = [sn1, sn2].find((x) => x && x !== 'unknown' && x !== 'null');
    d.key = hw ? `hw:${hw}` : d.serial;
    const avd = avd1 || avd2;
    d.kind = d.serial.startsWith('emulator-') || qemu === '1' || avd ? 'emulator' : 'phone';
    const clean = (v) => (v && v !== 'null' ? v : '');
    let name;
    if (d.kind === 'emulator') name = avd ? prettyAvd(avd) : clean(model);
    else {
      const byBrand = clean(model) && clean(brand) && !model.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${model}` : clean(model);
      name = clean(deviceName) || clean(market) || byBrand;
    }
    if (name) d.name = name;
    const k = known.get(d.key) || { lastStamp: null };
    k.name = d.name;
    k.kind = d.kind;
    known.set(d.key, k);
    d.known = k;
    d.lastStamp = k.lastStamp; // resume where we left off, so a reconnect doesn't re-read old lines
    d.described = true;
    assignRoles();
  });
}

// One reader per physical device: among the connected addresses that share a hardware serial,
// keep the one already reading (or the first) and leave the rest idle.
function assignRoles() {
  const groups = new Map();
  for (const d of devices.values()) {
    if (!d.online || !d.described) continue;
    if (!groups.has(d.key)) groups.set(d.key, []);
    groups.get(d.key).push(d);
  }
  for (const list of groups.values()) {
    const primary = list.find((d) => d.active) || list[0];
    for (const d of list) {
      if (d === primary && !d.active) activate(d);
      else if (d !== primary && d.active) deactivate(d);
    }
  }
  publishDevices();
}

function activate(d) {
  d.active = true;
  cdpTick(d);
  // The default 2 MiB buffer can't hold even a few large responses.
  spawn(ADB, ['-s', d.serial, 'logcat', '-G', '16M'], { stdio: 'ignore' })
    .on('close', () => startLogcat(d))
    .on('error', () => startLogcat(d));
}

function deactivate(d) {
  d.active = false;
  if (d.child) d.child.kill();
  cdpDropAll(d);
}

function pollDevices() {
  if (stopped) return;
  adb(['devices'], (err, out) => {
    if (err && err.code === 'ENOENT') {
      if (adbStatus !== 'adb not found') {
        adbStatus = 'adb not found';
        publishDevices();
      }
      return setTimeout(pollDevices, 5000);
    }
    adbStatus = 'ok';
    const online = new Set(
      out
        .split('\n')
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter(([serial, state]) => serial && state === 'device')
        .map(([serial]) => serial),
    );
    let changed = false;
    for (const serial of online) {
      if (devices.has(serial)) continue;
      const d = {
        serial, key: serial, name: serial, kind: serial.startsWith('emulator-') ? 'emulator' : 'phone',
        online: true, active: false, described: false, child: null, lastStamp: null,
      };
      devices.set(serial, d);
      describe(d);
    }
    for (const d of [...devices.values()]) {
      if (!online.has(d.serial)) {
        d.online = false;
        deactivate(d);
        devices.delete(d.serial);
        changed = true;
      }
    }
    if (changed) assignRoles(); // promotes another address of a device whose reader just went away
    setTimeout(pollDevices, 2000);
  });
}

// ---------- Chrome / WebView, over the DevTools protocol ----------
// Chrome (and any debuggable WebView) exposes a DevTools socket on the device; it never writes
// its traffic to logcat. `adb forward` it to a local port, attach to each open tab, and turn
// Network.* events into the same entries the OkHttp parser produces.
const CDP_SOCKET_RE = /@((?:chrome|webview)_devtools_remote(?:_\d+)?)\b/g;
const TEXT_TYPES = new Set(['XHR', 'Fetch', 'Document', 'EventSource', 'Script', 'Stylesheet']);
const MAX_CDP_BODY = 3 * 1024 * 1024;

function stampOf(wallTime) {
  const t = new Date(wallTime * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

function cdpTick(d) {
  clearTimeout(d.cdpTimer);
  if (stopped || !d.active) return;
  adb(['-s', d.serial, 'shell', 'cat /proc/net/unix'], (err, out) => {
    if (!err) {
      const names = new Set([...out.matchAll(CDP_SOCKET_RE)].map((m) => m[1]));
      for (const name of names) cdpEnsure(d, name);
      for (const name of [...(d.cdp?.keys() || [])]) if (!names.has(name)) cdpDrop(d, name);
      const sdk = new Set([...out.matchAll(SDK_SOCKET_RE)].map((m) => m[1]));
      for (const name of sdk) sdkEnsure(d, name);
      for (const name of [...(d.sdk?.keys() || [])]) if (!sdk.has(name)) sdkDrop(d, name);
    }
    d.cdpTimer = setTimeout(() => cdpTick(d), 3000);
  });
}

function cdpEnsure(d, name) {
  d.cdp ||= new Map();
  let c = d.cdp.get(name);
  if (!c) {
    c = { name, port: null, targets: new Map(), app: null, busy: false };
    d.cdp.set(name, c);
  }
  if (c.busy) return;
  c.busy = true;
  const run = async () => {
    try {
      const base = `http://127.0.0.1:${c.port}`;
      if (!c.app) {
        const v = await (await fetch(`${base}/json/version`)).json();
        const pid = name.match(/_(\d+)$/);
        c.app = v['Android-Package'] || (pid && d.pids?.get(Number(pid[1]))) || name;
      }
      const list = await (await fetch(`${base}/json/list`)).json();
      const ids = new Set();
      for (const t of list) {
        if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
        ids.add(t.id);
        if (!c.targets.has(t.id)) cdpAttach(d, c, t);
      }
      for (const [id, ws] of c.targets) {
        if (!ids.has(id)) {
          try { ws.close(); } catch {}
          c.targets.delete(id);
        }
      }
    } catch {
      c.port = null; // stale forward (app restarted); make a new one next tick
    }
    c.busy = false;
  };
  if (c.port) return run();
  adb(['-s', d.serial, 'forward', 'tcp:0', `localabstract:${name}`], (err, out) => {
    if (err || !/^\d+$/.test(out)) {
      c.busy = false;
      return;
    }
    c.port = Number(out);
    run();
  });
}

function cdpDrop(d, name) {
  const c = d.cdp?.get(name);
  if (!c) return;
  for (const ws of c.targets.values()) try { ws.close(); } catch {}
  if (c.port) adb(['-s', d.serial, 'forward', '--remove', `tcp:${c.port}`], () => {});
  d.cdp.delete(name);
}

function cdpDropAll(d) {
  clearTimeout(d.cdpTimer);
  for (const name of [...(d.cdp?.keys() || [])]) cdpDrop(d, name);
  for (const name of [...(d.sdk?.keys() || [])]) sdkDrop(d, name);
}

// ---------- Netscope Android library (netscope_<pid> socket) ----------
// Apps that add NetscopeInterceptor open an abstract socket and stream one JSON event per line:
// hello / req / resp / err. Full bodies and exact timings, nothing via logcat.
const SDK_SOCKET_RE = /@(netscope_(\d+))\b/g;
const net = require('net');

function sdkEnsure(d, name) {
  d.sdk ||= new Map();
  if (d.sdk.has(name)) return;
  const pid = Number(name.split('_')[1]);
  const c = { name, pid, port: null, sock: null, reqs: new Map() };
  d.sdk.set(name, c);
  adb(['-s', d.serial, 'forward', 'tcp:0', `localabstract:${name}`], (err, out) => {
    if (err || !/^\d+$/.test(out) || !d.sdk.has(name)) { d.sdk.delete(name); return; }
    c.port = Number(out);
    const sock = net.connect(c.port, '127.0.0.1');
    c.sock = sock;
    (d.sdkPids ||= new Set()).add(pid); // logcat copies of this app's calls are now duplicates
    // Calls logged before we connected are replayed from the library's backlog, complete —
    // hide the logcat copies already captured from this process.
    for (const e of entries) {
      if (e.device === d.key && e.pid === pid && (e.source || 'okhttp') === 'okhttp' && !e.hidden) {
        e.hidden = true;
        publish(e);
      }
    }
    readline.createInterface({ input: sock }).on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      try { sdkEvent(d, c, m); } catch (err) { logError('sdk', err); }
    });
    sock.on('error', () => {});
    sock.on('close', () => sdkDrop(d, name));
  });
}

function sdkDrop(d, name) {
  const c = d.sdk?.get(name);
  if (!c) return;
  d.sdk.delete(name);
  d.sdkPids?.delete(c.pid);
  try { c.sock?.destroy(); } catch {}
  if (c.port) adb(['-s', d.serial, 'forward', '--remove', `tcp:${c.port}`], () => {});
  for (const e of c.reqs.values()) {
    if (e.state === 'pending') { e.state = 'failed'; e.error = 'App disconnected before the response'; publish(e); }
  }
}

function sdkEvent(d, c, m) {
  const pairs = (h) => (Array.isArray(h) ? h.filter((x) => Array.isArray(x)).map(([k, v]) => [String(k), String(v)]) : []);
  if (m.t === 'req') {
    const e = {
      id: nextId++,
      device: d.key,
      app: appOf(d, c.pid),
      pid: c.pid,
      source: 'sdk',
      started: stampOf((m.ts || Date.now()) / 1000),
      method: m.method || 'GET',
      url: m.url || '',
      state: 'pending',
      status: null,
      statusText: '',
      durationMs: null,
      error: null,
      reqHeaders: pairs(m.headers),
      reqBody: m.body != null ? [String(m.body)] : [],
      reqNote: m.bodyNote || '',
      respHeaders: [],
      respBody: [],
      respNote: '',
      size: null,
      transferSize: null,
      truncated: false,
    };
    c.reqs.set(m.id, e);
    entries.push(e);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    publish(e);
    return;
  }
  const e = c.reqs.get(m.id);
  if (!e) return;
  if (!e.app) e.app = appOf(d, c.pid);
  if (m.t === 'resp') {
    e.status = m.status;
    e.statusText = m.message || '';
    e.durationMs = m.ms ?? null;
    e.respHeaders = pairs(m.headers);
    e.respBody = m.body != null ? [String(m.body)] : [];
    e.respNote = m.bodyNote || '';
    e.size = m.size >= 0 ? m.size : null;
    e.transferSize = e.size;
    e.truncated = !!m.truncated;
    e.mime = (e.respHeaders.find(([k]) => /^content-type$/i.test(k))?.[1] || '').split(';')[0];
    e.state = 'done';
  } else if (m.t === 'err') {
    e.state = 'failed';
    e.error = m.error || 'Failed';
    e.durationMs = m.ms ?? null;
  }
  c.reqs.delete(m.id);
  publish(e);
}

// Chrome DevTools Network events -> Netscope entries. `call(method, params)` sends a CDP command on
// the same target/session (used to fetch response bodies). Returns the event handler.
function cdpNetwork(key, getApp, call) {
  const reqs = new Map(); // CDP requestId -> entry
  const newEntry = (p) => {
    const e = {
      id: nextId++,
      device: key,
      app: getApp(),
      pid: null,
      source: 'chrome',
      resourceType: p.type,
      started: stampOf(p.wallTime),
      method: p.request.method,
      url: p.request.url + (p.request.urlFragment || ''),
      state: 'pending',
      status: null,
      statusText: '',
      durationMs: null,
      error: null,
      reqHeaders: Object.entries(p.request.headers || {}),
      reqBody: p.request.postData ? [p.request.postData] : [],
      reqNote: p.request.hasPostData && !p.request.postData ? 'request body not captured' : '',
      respHeaders: [],
      respBody: [],
      respNote: '',
      size: null,
      transferSize: null,
      truncated: false,
      _ts: p.timestamp,
    };
    entries.push(e);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    return e;
  };
  const setResponse = (e, r) => {
    e.status = r.status;
    e.statusText = r.statusText || '';
    e.respHeaders = Object.entries(r.headers || {});
    e.mime = r.mimeType;
  };
  return (method, p) => {
    switch (method) {
      case 'Network.requestWillBeSent': {
        if (/^(data|blob|chrome-extension|devtools|chrome):/.test(p.request.url)) return;
        const prev = reqs.get(p.requestId);
        if (prev && p.redirectResponse) {
          setResponse(prev, p.redirectResponse);
          prev.state = 'done';
          prev.durationMs = Math.round((p.timestamp - prev._ts) * 1000);
          prev.respNote = `redirected to ${p.request.url}`;
          publish(prev);
        }
        const e = newEntry(p);
        reqs.set(p.requestId, e);
        publish(e);
        break;
      }
      case 'Network.requestWillBeSentExtraInfo': {
        // The real headers sent on the wire (cookies included) arrive separately.
        const e = reqs.get(p.requestId);
        if (e && p.headers) { e.reqHeaders = Object.entries(p.headers); publish(e); }
        break;
      }
      case 'Network.responseReceived': {
        const e = reqs.get(p.requestId);
        if (!e) return;
        setResponse(e, p.response);
        publish(e);
        break;
      }
      case 'Network.loadingFinished': {
        const e = reqs.get(p.requestId);
        if (!e) return;
        reqs.delete(p.requestId);
        e.transferSize = p.encodedDataLength ?? null;
        e.durationMs = Math.round((p.timestamp - e._ts) * 1000);
        const textual = TEXT_TYPES.has(e.resourceType) || /json|text|xml|javascript/.test(e.mime || '');
        if (!textual || (p.encodedDataLength || 0) > MAX_CDP_BODY) {
          e.state = 'done';
          e.respNote = `${e.mime || e.resourceType || 'binary'} body not captured`;
          publish(e);
          return;
        }
        call('Network.getResponseBody', { requestId: p.requestId }).then((r) => {
          e.state = 'done';
          if (r && !r.base64Encoded) {
            e.respBody = [r.body];
            e.size = Buffer.byteLength(r.body);
          } else if (r) {
            e.respNote = 'binary body not shown';
            e.size = Math.floor((r.body.length * 3) / 4);
          } else {
            e.respNote = 'body no longer available';
          }
          publish(e);
        });
        break;
      }
      case 'Network.loadingFailed': {
        const e = reqs.get(p.requestId);
        if (!e) return;
        reqs.delete(p.requestId);
        e.state = 'failed';
        e.error = p.canceled ? 'Canceled' : p.blockedReason ? `Blocked (${p.blockedReason})` : p.errorText;
        e.durationMs = Math.round((p.timestamp - e._ts) * 1000);
        publish(e);
        break;
      }
    }
  };
}

// A phone's Chrome/WebView tab, one WebSocket per page (over adb forward).
function cdpAttach(d, c, target) {
  let ws;
  try {
    ws = new WebSocket(target.webSocketDebuggerUrl);
  } catch {
    return;
  }
  c.targets.set(target.id, ws);
  const waiting = new Map();
  let msgId = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = ++msgId;
      waiting.set(id, resolve);
      try { ws.send(JSON.stringify({ id, method, params })); } catch { resolve(null); }
    });
  const onNet = cdpNetwork(d.key, () => c.app, call);
  ws.onopen = () => call('Network.enable', { maxPostDataSize: 65536 });
  ws.onclose = () => c.targets.delete(target.id);
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id) {
      waiting.get(m.id)?.(m.result || null);
      waiting.delete(m.id);
      return;
    }
    if (m.method) onNet(m.method, m.params || {});
  };
}

// ---------- browsers on this Mac (Chrome, Edge, Brave, Chromium…) ----------
// Chrome only allows remote debugging on a non-default profile, so Netscope launches the browser
// with its own profile (kept between launches) and --remote-debugging-port. It then connects to
// the *browser* target and auto-attaches to every tab, frame and worker — new tabs included,
// paused until Network is enabled so their first request isn't missed. Any Chromium-based app
// already started with --remote-debugging-port can be attached by port instead.
const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', app: 'Google Chrome.app', bin: 'Google Chrome' },
  { id: 'edge', name: 'Microsoft Edge', app: 'Microsoft Edge.app', bin: 'Microsoft Edge' },
  { id: 'brave', name: 'Brave', app: 'Brave Browser.app', bin: 'Brave Browser' },
  { id: 'chromium', name: 'Chromium', app: 'Chromium.app', bin: 'Chromium' },
  { id: 'canary', name: 'Chrome Canary', app: 'Google Chrome Canary.app', bin: 'Google Chrome Canary' },
  { id: 'vivaldi', name: 'Vivaldi', app: 'Vivaldi.app', bin: 'Vivaldi' },
];
const CAPTURE_TYPES = new Set(['page', 'iframe', 'worker', 'service_worker', 'shared_worker']);
const localBrowsers = new Map(); // key -> session

function browserPath(b) {
  for (const dir of ['/Applications', path.join(require('os').homedir(), 'Applications')]) {
    const bin = path.join(dir, b.app, 'Contents/MacOS', b.bin);
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitForDebugPort(port, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (v.webSocketDebuggerUrl) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Nothing answered on port ${port}. Is the browser running with --remote-debugging-port=${port}?`);
}

// Turn the UI's sign-in options into cookies / storage entries / a header rule for one origin.
function buildInjection(url, inject) {
  if (!inject || !inject.preset || inject.preset === 'none' || !inject.token) return null;
  let origin;
  try { origin = new URL(url).origin; } catch { throw new Error('Enter the address to open, so the token knows which site it belongs to'); }
  const token = String(inject.token).trim().replace(/^bearer\s+/i, '');
  const out = { origin, cookies: [], local: [], session: [], header: null };
  const host = () => (inject.headerHost || new URL(url).host).trim().toLowerCase();
  if (inject.preset === 'storage') {
    // Web apps that keep their session in the browser: a cookie (seen by the server) and/or
    // localStorage (read by the page's own code), plus any extra values the app expects.
    if (inject.cookieName) out.cookies.push([String(inject.cookieName), token]);
    if (inject.storageKey) out.local.push([String(inject.storageKey), token]);
    for (const [k, v] of Array.isArray(inject.extras) ? inject.extras : []) {
      if (!k) continue;
      out.local.push([String(k), String(v ?? '')]);
      if (inject.alsoSession) out.session.push([String(k), String(v ?? '')]);
    }
    if (!out.cookies.length && !out.local.length) throw new Error('Enter a cookie name or a localStorage key for the token');
  } else if (inject.preset === 'bearer') {
    out.header = { host: host(), name: 'Authorization', value: `Bearer ${token}` };
  } else if (inject.preset === 'header') {
    if (!inject.headerName) throw new Error('Enter the header name');
    out.header = { host: host(), name: String(inject.headerName), value: token };
  } else {
    throw new Error(`Unknown sign-in type: ${inject.preset}`);
  }
  return out;
}

// Fetch interception rules (header injection), applied to every tab of a local browser.
function headerPatterns(sess) {
  return (sess.headerRules || []).map((r) => ({ urlPattern: `*://${r.host}/*`, requestStage: 'Request' }));
}

function runningPortFor(profile) {
  return new Promise((resolve) => {
    execFile('ps', ['-ax', '-o', 'command='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      for (const line of String(out).split('\n')) {
        if (!line.includes(`--user-data-dir=${profile}`) || /--type=/.test(line)) continue; // main process only
        const m = line.match(/--remote-debugging-port=(\d+)/);
        if (m) return resolve(Number(m[1]));
      }
      resolve(null);
    });
  });
}

async function launchBrowser(id, url, inject) {
  const b = BROWSERS.find((x) => x.id === id);
  const bin = b && browserPath(b);
  if (!bin) throw new Error(`${b?.name || id} is not installed`);
  const key = `mac:${id}`;
  const running = localBrowsers.get(key);
  const plan = url ? buildInjection(url, inject) : null;
  if (running) {
    if (url) await openInBrowser(running, url, false, plan);
    return running;
  }
  const profile = path.join(DATA_DIR, 'browser-profiles', id);
  fs.mkdirSync(profile, { recursive: true });
  // Still open from an earlier Netscope session? Reconnect instead of starting a second copy
  // (Chrome would hand the new launch to the running one and ignore our debugging port).
  const existing = await runningPortFor(profile);
  if (existing) {
    const v = await waitForDebugPort(existing, 3000);
    const sess = await attachLocalBrowser({ key, name: `${b.name} on this Mac`, port: existing, version: v, proc: { reattached: true }, app: b.name });
    if (url) await openInBrowser(sess, url, false, plan);
    return sess;
  }
  const port = await freePort();
  const proc = spawn(bin, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank', // the real URL is opened after capture starts, so its first request isn't missed
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
  const v = await waitForDebugPort(port);
  const sess = await attachLocalBrowser({ key, name: `${b.name} on this Mac`, port, version: v, proc, app: b.name });
  if (url) await openInBrowser(sess, url, true, plan);
  return sess;
}

// Open a URL so it is captured from its very first request: navigate a tab whose Network domain
// is already enabled (the blank start tab, or a new blank tab) instead of creating it with the URL.
async function openInBrowser(sess, url, reuseBlank, plan) {
  const readyFor = async (targetId) => {
    for (let i = 0; i < 60; i++) {
      const hit = [...sess.sessions.entries()].find(([, x]) => x.targetId === targetId);
      if (hit) { await hit[1].ready; return hit[0]; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  let sid = null;
  if (reuseBlank) {
    for (let i = 0; i < 60 && !sid; i++) {
      const hit = [...sess.sessions.entries()].find(([, x]) => x.type === 'page' && /^about:blank|^chrome:\/\/newtab/.test(x.url || ''));
      if (hit) { await hit[1].ready; sid = hit[0]; } else await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!sid) {
    const r = await sess.call('Target.createTarget', { url: 'about:blank' });
    sid = r?.targetId ? await readyFor(r.targetId) : null;
  }
  if (!sid) return;
  if (plan) await applyInjection(sess, sid, plan);
  await sess.call('Page.navigate', { url }, sid);
}

// Put the token where the site expects it *before* its first request and before its own scripts.
async function applyInjection(sess, sid, plan) {
  for (const [name, value] of plan.cookies) {
    await sess.call('Network.setCookie', { name, value, url: plan.origin, path: '/', sameSite: 'Lax', secure: plan.origin.startsWith('https:') }, sid);
  }
  if (plan.local.length || plan.session.length) {
    // Runs at the start of every document in this tab, but writes only once (per tab session),
    // so logging out inside the app still works.
    const flag = `__netscope_signin_${Date.now().toString(36)}`;
    const js = `(() => { if (location.origin !== ${JSON.stringify(plan.origin)}) return; try {
      if (sessionStorage.getItem(${JSON.stringify(flag)})) return;
      ${plan.local.map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}
      ${plan.session.map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}
      sessionStorage.setItem(${JSON.stringify(flag)}, '1');
    } catch (e) {} })();`;
    await sess.call('Page.enable', {}, sid); // without this Chrome accepts the script but never runs it
    await sess.call('Page.addScriptToEvaluateOnNewDocument', { source: js }, sid);
  }
  if (plan.header) {
    sess.headerRules = (sess.headerRules || []).filter((r) => !(r.host === plan.header.host && r.name.toLowerCase() === plan.header.name.toLowerCase()));
    sess.headerRules.push(plan.header);
    // Intercept only the chosen host, in every tab, so the token never goes to other sites.
    for (const tsid of sess.sessions.keys()) await sess.call('Fetch.enable', { patterns: headerPatterns(sess) }, tsid);
  }
}

async function attachPort(port) {
  const v = await waitForDebugPort(port, 3000);
  const product = String(v.Browser || 'Chromium').split('/')[0];
  const key = `mac:port:${port}`;
  if (localBrowsers.has(key)) return localBrowsers.get(key);
  return attachLocalBrowser({ key, name: `${product} (port ${port})`, port, version: v, proc: null, app: product });
}

function attachLocalBrowser({ key, name, port, version, proc, app }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const waiting = new Map();
    const sessions = new Map(); // sessionId -> { onNet, type, url }
    const byTarget = new Map(); // targetId -> sessionId (one session per target)
    let msgId = 0;
    const call = (method, params = {}, sessionId) =>
      new Promise((res) => {
        const id = ++msgId;
        waiting.set(id, res);
        try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); } catch { res(null); }
      });
    const sess = { key, name, port, proc, app, ws, call, sessions, launchedByUs: !!proc, browser: version.Browser };
    const autoAttach = (sessionId) => call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    ws.onopen = async () => {
      localBrowsers.set(key, sess);
      known.set(key, { name, kind: 'browser' });
      publishDevices();
      await call('Target.setDiscoverTargets', { discover: true });
      await autoAttach(); // attaches to every existing target, then to each new one (paused)
      resolve(sess);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      const was = localBrowsers.get(key) === sess;
      localBrowsers.delete(key);
      if (was) publishDevices();
      reject(new Error('closed'));
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id) {
        waiting.get(m.id)?.(m.result || null);
        waiting.delete(m.id);
        return;
      }
      const p = m.params || {};
      if (m.method === 'Target.attachedToTarget') {
        const sid = p.sessionId;
        const t = p.targetInfo || {};
        if (!CAPTURE_TYPES.has(t.type) || byTarget.has(t.targetId)) {
          // Not something we capture, or a second attachment to a target we already follow.
          if (p.waitingForDebugger) call('Runtime.runIfWaitingForDebugger', {}, sid);
          if (byTarget.has(t.targetId)) call('Target.detachFromTarget', { sessionId: sid });
          return;
        }
        byTarget.set(t.targetId, sid);
        const entry = { onNet: cdpNetwork(key, () => app, (mth, prm) => call(mth, prm, sid)), type: t.type, url: t.url, targetId: t.targetId };
        // Enable Network before letting a new tab run, then follow its frames and workers.
        entry.ready = Promise.all([
          call('Network.enable', { maxPostDataSize: 65536 }, sid),
          autoAttach(sid),
          sess.headerRules?.length ? call('Fetch.enable', { patterns: headerPatterns(sess) }, sid) : null,
        ]).then(() => {
          if (p.waitingForDebugger) call('Runtime.runIfWaitingForDebugger', {}, sid);
        });
        sessions.set(sid, entry);
        publishDevices();
        return;
      }
      if (m.method === 'Target.detachedFromTarget') {
        const x = sessions.get(p.sessionId);
        if (x && byTarget.get(x.targetId) === p.sessionId) byTarget.delete(x.targetId);
        sessions.delete(p.sessionId);
        publishDevices();
        return;
      }
      if (m.method === 'Target.targetInfoChanged') {
        const sid = byTarget.get(p.targetInfo?.targetId);
        if (sid && sessions.has(sid)) sessions.get(sid).url = p.targetInfo.url;
        return;
      }
      if (m.method === 'Fetch.requestPaused' && m.sessionId) {
        let host = '';
        try { host = new URL(p.request.url).host.toLowerCase(); } catch {}
        const headers = { ...(p.request.headers || {}) };
        for (const r of sess.headerRules || []) {
          if (r.host !== host) continue;
          for (const k of Object.keys(headers)) if (k.toLowerCase() === r.name.toLowerCase()) delete headers[k];
          headers[r.name] = r.value;
        }
        call('Fetch.continueRequest', { requestId: p.requestId, headers: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })) }, m.sessionId);
        return;
      }
      if (m.sessionId && m.method) sessions.get(m.sessionId)?.onNet(m.method, p);
    };
  });
}

// Find where a signed-in site keeps its token: look at its tab in a Netscope-launched browser.
function jwtPayload(v) {
  const m = String(v || '').replace(/^bearer\s+/i, '').match(/^[\w-]{8,}\.([\w-]{8,})\.[\w-]+$/);
  if (!m) return null;
  try { const o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
async function detectSignIn(url) {
  let origin;
  try { origin = new URL(url).origin; } catch { throw new Error('Enter a valid site address'); }
  const sess = [...localBrowsers.values()][0];
  if (!sess) throw new Error('Launch the browser first, sign in to the site once, then click Detect');
  const findTab = () => [...sess.sessions.entries()].find(([, x]) => x.type === 'page' && (() => { try { return new URL(x.url).origin === origin; } catch { return false; } })());
  let tab = findTab();
  if (!tab) {
    await openInBrowser(sess, url, false, null);
    for (let i = 0; i < 40 && !(tab = findTab()); i++) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 2500)); // let the app restore its session
    tab = findTab();
  }
  if (!tab) throw new Error(`Couldn't open ${origin} in Netscope's browser`);
  const [sid] = tab;
  const ev = await sess.call('Runtime.evaluate', {
    expression: 'JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), path: location.pathname })',
    returnByValue: true,
  }, sid);
  const data = JSON.parse(ev?.result?.value || '{}');
  const cookies = (await sess.call('Network.getCookies', { urls: [origin] }, sid))?.cookies || [];
  const pick = (pairs) => pairs.find(([, v]) => jwtPayload(v));
  const lc = pick(data.local || []);
  const sc = pick(data.session || []);
  const ck = cookies.find((c) => jwtPayload(decodeURIComponent(c.value)));
  const token = lc?.[1] || ck?.value || sc?.[1] || null;
  if (!token) throw new Error(`No token found for ${origin} — sign in to the site in Netscope's browser first (you're on ${data.path || '?'})`);
  // Other stored values that equal a claim of the token become {{jwt:claim}} lines.
  const claims = jwtPayload(token) || {};
  const byValue = new Map(Object.entries(claims).filter(([, v]) => typeof v === 'string' && v.length >= 4).map(([k, v]) => [v, k]));
  const extras = [];
  for (const [k, v] of [...(data.local || []), ...(data.session || [])]) {
    if (k === lc?.[0] || !byValue.has(v) || extras.some(([x]) => x === k)) continue;
    extras.push([k, `{{jwt:${byValue.get(v)}}}`]);
  }
  return { ok: true, token: decodeURIComponent(token), cookie: ck?.name || null, storageKey: lc?.[0] || null, extras, alsoSession: extras.some(([k]) => (data.session || []).some(([x]) => x === k)) };
}

function detachLocalBrowser(key, closeBrowser) {
  const s = localBrowsers.get(key);
  if (!s) return false;
  if (closeBrowser) s.call('Browser.close');
  setTimeout(() => { try { s.ws.close(); } catch {} }, closeBrowser ? 300 : 0);
  localBrowsers.delete(key);
  publishDevices();
  return true;
}

function browserStatus() {
  return {
    installed: BROWSERS.filter((b) => browserPath(b)).map((b) => ({ id: b.id, name: b.name, running: localBrowsers.has(`mac:${b.id}`) })),
    running: [...localBrowsers.values()].map((s) => ({
      key: s.key,
      name: s.name,
      port: s.port,
      tabs: [...s.sessions.values()].filter((x) => x.type === 'page').length,
      launchedByUs: s.launchedByUs,
    })),
  };
}

// ---------- wireless pairing (Android 11+ "Wireless debugging") ----------
// QR pairing works like Android Studio's: we show WIFI:T:ADB;S:<name>;P:<password>;; — the phone
// scans it and advertises an _adb-tls-pairing._tcp service with that name, which we find over
// mDNS and `adb pair`. After pairing the phone advertises _adb-tls-connect._tcp for `adb connect`.
let QRCode = null;
try { QRCode = require('qrcode'); } catch {}
const pairing = { name: null, pass: null, state: 'idle', message: '', timer: null, until: 0 };

function mdnsServices(cb) {
  adb(['mdns', 'services'], (err, out) => {
    const list = [];
    for (const l of (out || '').split('\n')) {
      const m = l.trim().match(/^(\S+)\s+(_adb-tls-(pairing|connect)\._tcp)\.?\s+([\d.]+):(\d+)/);
      if (m) list.push({ name: m[1], kind: m[3], host: m[4], port: Number(m[5]) });
    }
    cb(list);
  });
}

function setPair(state, message) {
  pairing.state = state;
  pairing.message = message || '';
}

// After a successful pair, wait for the phone's connect service on the same IP and connect to it.
function connectAfterPair(host, explicitPort, done) {
  const until = Date.now() + 20000;
  const tryOnce = () => {
    const go = (port) =>
      adb(['connect', `${host}:${port}`], (err, out) => {
        if (/connected to/i.test(out)) done(null, `Connected to ${host}:${port}`);
        else if (Date.now() < until) setTimeout(tryOnce, 1500);
        else done(new Error(out || 'Could not connect'));
      });
    if (explicitPort) return go(explicitPort);
    mdnsServices((list) => {
      const svc = list.find((x) => x.kind === 'connect' && x.host === host);
      if (svc) return go(svc.port);
      if (Date.now() < until) setTimeout(tryOnce, 1500);
      else done(new Error('Paired, but the phone is not advertising a connect port yet — use Nearby or type IP:port.'));
    });
  };
  tryOnce();
}

function startQrPairing(cb) {
  stopQrPairing();
  const rnd = (n, abc) => Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  pairing.name = `netscope-${rnd(6, 'abcdefghijkmnpqrstuvwxyz23456789')}`;
  pairing.pass = rnd(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  pairing.until = Date.now() + 3 * 60 * 1000;
  setPair('waiting', 'Waiting for the phone to scan the code…');
  const text = `WIFI:T:ADB;S:${pairing.name};P:${pairing.pass};;`;
  const poll = () => {
    if (pairing.state !== 'waiting') return;
    if (Date.now() > pairing.until) return setPair('error', 'Timed out — generate a new code and try again.');
    mdnsServices((list) => {
      if (pairing.state !== 'waiting') return;
      const svc = list.find((x) => x.kind === 'pairing' && x.name === pairing.name);
      if (!svc) {
        pairing.timer = setTimeout(poll, 1000);
        return;
      }
      setPair('pairing', `Pairing with ${svc.host}…`);
      adb(['pair', `${svc.host}:${svc.port}`, pairing.pass], (err, out) => {
        if (!/successfully paired/i.test(out)) return setPair('error', out || String(err?.message || 'Pairing failed'));
        setPair('connecting', 'Paired — connecting…');
        connectAfterPair(svc.host, null, (e, msg) => setPair(e ? 'error' : 'connected', e ? e.message : msg));
      });
    });
  };
  pairing.timer = setTimeout(poll, 1000);
  if (!QRCode) return cb(null, { name: pairing.name, pass: pairing.pass, text, svg: null });
  QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    .then((svg) => cb(null, { name: pairing.name, pass: pairing.pass, text, svg }))
    .catch((e) => cb(e));
}

function stopQrPairing() {
  clearTimeout(pairing.timer);
  if (pairing.state === 'waiting') setPair('idle');
}

function readJson(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 10 * 1024 * 1024) req.destroy(); });
  req.on('end', () => {
    try { cb(JSON.parse(body || '{}')); } catch { cb({}); }
  });
}

function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const HOSTPORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/;

function pairRoutes(req, res) {
  const url = req.url.split('?')[0];
  if (url === '/pair/qr/start' && req.method === 'POST') {
    startQrPairing((err, data) => (err ? sendJson(res, { error: err.message }, 500) : sendJson(res, data)));
    return true;
  }
  if (url === '/pair/qr/stop' && req.method === 'POST') {
    stopQrPairing();
    sendJson(res, { ok: true });
    return true;
  }
  if (url === '/pair/status') {
    sendJson(res, { state: pairing.state, message: pairing.message });
    return true;
  }
  if (url === '/pair/code' && req.method === 'POST') {
    readJson(req, ({ target, code, connect }) => {
      const t = String(target || '').trim().match(HOSTPORT_RE);
      const c = String(code || '').trim();
      if (!t || !/^\d{6}$/.test(c)) return sendJson(res, { ok: false, message: 'Enter the IP:port and the 6-digit code shown on the phone.' }, 400);
      const cp = String(connect || '').trim().match(HOSTPORT_RE);
      adb(['pair', `${t[1]}:${t[2]}`, c], (err, out) => {
        if (!/successfully paired/i.test(out)) return sendJson(res, { ok: false, message: out || err?.message || 'Pairing failed' });
        connectAfterPair(t[1], cp ? Number(cp[2]) : null, (e, msg) =>
          sendJson(res, { ok: !e, message: e ? e.message : msg }));
      });
    });
    return true;
  }
  if (url === '/connect' && req.method === 'POST') {
    readJson(req, ({ target }) => {
      const t = String(target || '').trim().match(HOSTPORT_RE);
      if (!t) return sendJson(res, { ok: false, message: 'Enter an address like 192.168.1.20:37123' }, 400);
      adb(['connect', `${t[1]}:${t[2]}`], (err, out) =>
        sendJson(res, { ok: /connected to/i.test(out), message: out || err?.message || 'Could not connect' }));
    });
    return true;
  }
  if (url === '/disconnect' && req.method === 'POST') {
    readJson(req, ({ serial }) => {
      const list = [...devices.values()].filter((d) => d.key === serial || d.serial === serial);
      if (!list.length) return sendJson(res, { ok: false, message: 'Unknown device' }, 400);
      for (const d of list) adb(['disconnect', d.serial], () => {});
      sendJson(res, { ok: true, message: `Disconnected ${list.length} address(es)` });
    });
    return true;
  }
  if (url === '/nearby') {
    mdnsServices((list) => {
      const connected = new Set([...devices.values()].filter((d) => d.online).map((d) => d.serial));
      const rows = list
        .filter((x) => x.kind === 'connect')
        .map((x) => ({
          ...x,
          connected: [...connected].some((sr) => sr === x.name || sr.startsWith(`${x.name}.`) || sr === `${x.host}:${x.port}`),
        }));
      sendJson(res, { services: rows });
    });
    return true;
  }
  return false;
}

const INDEX = path.join(__dirname, 'index.html');
const STATIC = {
  '/features.js': ['features.js', 'text/javascript; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
};

// ---------- API client workspace (collections + environments), saved on this Mac ----------
let DATA_DIR = path.join(require('os').homedir(), '.netscope');
const EMPTY_WS = { version: 1, collections: [], environments: [], activeEnv: null };
function wsFile() { return path.join(DATA_DIR, 'workspace.json'); }
function loadWorkspace() {
  try { return { ...EMPTY_WS, ...JSON.parse(fs.readFileSync(wsFile(), 'utf8')) }; } catch { return { ...EMPTY_WS }; }
}
function saveWorkspace(ws) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${wsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ws, null, 1));
  fs.renameSync(tmp, wsFile()); // atomic: a crash mid-write never corrupts the saved file
}

// ---------- sessions (HAR import) and replay ----------
function addEntry(e) {
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  publish(e);
  return e;
}

function stampFromIso(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '01-01 00:00:00.000';
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

// A HAR file (from Netscope, Chrome DevTools, Proxyman, Charles…) becomes a read-only "device".
function importHar(har, fileName) {
  const list = har?.log?.entries;
  if (!Array.isArray(list)) throw new Error('Not a HAR file (no log.entries)');
  const key = `file:${fileName || 'session.har'}:${Date.now()}`;
  known.set(key, { name: `${fileName || 'session.har'}`, kind: 'file' });
  let n = 0;
  for (const h of list) {
    const req = h.request || {};
    const resp = h.response || {};
    const ns = h._netscope || {};
    const status = Number(resp.status) || null;
    const failed = !status || status <= 0;
    addEntry({
      id: nextId++,
      device: key,
      app: ns.app || null,
      pid: null,
      source: 'har',
      resourceType: h._resourceType || ns.resourceType,
      started: stampFromIso(h.startedDateTime),
      method: req.method || 'GET',
      url: req.url || '',
      state: failed ? 'failed' : 'done',
      status: failed ? null : status,
      statusText: resp.statusText || '',
      durationMs: h.time != null ? Math.round(h.time) : null,
      error: failed ? ns.error || resp._error || 'No response' : null,
      reqHeaders: (req.headers || []).map((x) => [x.name, x.value]),
      reqBody: req.postData?.text ? [req.postData.text] : [],
      reqNote: '',
      respHeaders: (resp.headers || []).map((x) => [x.name, x.value]),
      respBody: resp.content?.text && resp.content?.encoding !== 'base64' ? [resp.content.text] : [],
      respNote: resp.content?.encoding === 'base64' ? 'binary body not shown' : '',
      size: resp.content?.size >= 0 ? resp.content.size : null,
      transferSize: resp.bodySize >= 0 ? resp.bodySize : null,
      truncated: false,
      mime: resp.content?.mimeType,
    });
    n++;
  }
  publishDevices();
  return n;
}

const HOP_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade']);
const MAX_REPLAY_BODY = 5 * 1024 * 1024;

// Re-send a request from this Mac (not the phone) and record it like any other call.
async function replay({ method, url, headers, body }) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('URL must start with http:// or https://');
  known.set('mac', { name: 'This Mac (resend)', kind: 'mac' });
  const now = new Date();
  const e = addEntry({
    id: nextId++,
    device: 'mac',
    app: 'Netscope resend',
    pid: null,
    source: 'replay',
    started: stampFromIso(now.toISOString()),
    method: (method || 'GET').toUpperCase(),
    url,
    state: 'pending',
    status: null,
    statusText: '',
    durationMs: null,
    error: null,
    reqHeaders: (headers || []).filter(([k]) => k),
    reqBody: body ? [body] : [],
    reqNote: '',
    respHeaders: [],
    respBody: [],
    respNote: '',
    size: null,
    transferSize: null,
    truncated: false,
  });
  publishDevices();
  const h = new Headers();
  for (const [k, v] of e.reqHeaders) if (!HOP_HEADERS.has(k.toLowerCase())) { try { h.append(k, v); } catch {} }
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(url, {
      method: e.method,
      headers: h,
      body: ['GET', 'HEAD'].includes(e.method) || !body ? undefined : body,
      redirect: 'manual',
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    clearTimeout(timer);
    e.durationMs = Math.round(performance.now() - t0);
    e.status = r.status;
    e.statusText = r.statusText;
    e.respHeaders = [...r.headers.entries()];
    e.mime = (r.headers.get('content-type') || '').split(';')[0];
    e.size = buf.length;
    const textual = /json|text|xml|javascript|html|x-www-form-urlencoded|graphql/i.test(e.mime) || !e.mime;
    if (buf.length > MAX_REPLAY_BODY) e.respNote = `body too large to show (${buf.length} bytes)`;
    else if (textual) e.respBody = [buf.toString('utf8')];
    else e.respNote = `${e.mime} body not shown`;
    e.state = 'done';
  } catch (err) {
    e.durationMs = Math.round(performance.now() - t0);
    e.state = 'failed';
    e.error = err.name === 'AbortError' ? 'Timed out after 60 s' : String(err.cause?.message || err.message);
  }
  publish(e);
  return e.id;
}

function logError(where, err) {
  const now = Date.now();
  if (now - (logError.last || 0) < 1000) return; // don't flood on repeated errors
  logError.last = now;
  console.error(`[netscope] ${where}: ${err?.stack || err}`);
}

// Drop bodies of the oldest calls once they add up past BODY_BUDGET (headers/status/timing stay).
setInterval(() => {
  let total = 0;
  for (const e of entries) total += (e._bodyBytes = (e.respBody?.reduce?.((a, x) => a + x.length, 0) || 0) + (e.reqBody?.reduce?.((a, x) => a + x.length, 0) || 0));
  for (let i = 0; total > BODY_BUDGET && i < entries.length; i++) {
    const e = entries[i];
    if (!e._bodyBytes || e.state === 'pending') continue;
    total -= e._bodyBytes;
    e.respBody = [];
    e.reqBody = [];
    e.respNote = 'body dropped to save memory (older call)';
    e._bodyBytes = 0;
    publish(e);
  }
}, 5000).unref();

function handler(req, res) {
  try {
    route(req, res);
  } catch (err) {
    logError(`request ${req.url}`, err);
    try { res.writeHead(500).end(); } catch {}
  }
}

// Only Netscope's own page may use this server. Without this, any website open in a browser on this
// Mac (or a script sandbox) could POST to 127.0.0.1 and make it resend requests or launch browsers.
function allowed(req) {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return false; // blocks DNS rebinding
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false; // cross-site request (incl. "null")
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return true;
}

function route(req, res) {
  if (!allowed(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  if (req.url.startsWith('/pair/') || req.url === '/connect' || req.url === '/disconnect' || req.url === '/nearby') {
    if (pairRoutes(req, res)) return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(INDEX).pipe(res);
    return;
  }
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    send(res, 'devices', devicesPayload());
    send(res, 'snapshot', entries.map(serialize));
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/raw') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify(rawBuf.slice(-20000))}\n\n`);
    rawClients.add(res);
    req.on('close', () => rawClients.delete(res));
    return;
  }
  const rm = req.url.match(/^\/entry-raw\?id=(\d+)$/);
  if (rm) {
    const e = entries.find((x) => x.id === Number(rm[1]));
    const seqs = e?.raw || [];
    const lines = seqs.map((q) => rawIndex.get(q)).filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ lines, dropped: seqs.length - lines.length }));
    return;
  }
  if (STATIC[req.url]) {
    const [file, type] = STATIC[req.url];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(__dirname, file)).pipe(res);
    return;
  }
  const im = req.url.match(/^\/import\?name=([^&]*)$/);
  if (im && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 200 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const n = importHar(JSON.parse(body), decodeURIComponent(im[1]));
        sendJson(res, { ok: true, count: n });
      } catch (err) {
        sendJson(res, { ok: false, message: err.message }, 400);
      }
    });
    return;
  }
  if (req.url === '/browsers') {
    sendJson(res, browserStatus());
    return;
  }
  if (req.url === '/browser/launch' && req.method === 'POST') {
    readJson(req, ({ id, url, inject }) => {
      launchBrowser(id, url, inject).then((b) => sendJson(res, { ok: true, key: b.key, name: b.name })).catch((err) => sendJson(res, { ok: false, message: err.message }));
    });
    return;
  }
  if (req.url === '/browser/attach' && req.method === 'POST') {
    readJson(req, ({ port }) => {
      const n = Number(port);
      if (!(n > 0 && n < 65536)) return sendJson(res, { ok: false, message: 'Enter a port number, e.g. 9222' }, 400);
      attachPort(n).then((b) => sendJson(res, { ok: true, key: b.key, name: b.name })).catch((err) => sendJson(res, { ok: false, message: err.message }));
    });
    return;
  }
  if (req.url === '/browser/detect' && req.method === 'POST') {
    readJson(req, ({ url }) => detectSignIn(url).then((r) => sendJson(res, r)).catch((err) => sendJson(res, { ok: false, message: err.message })));
    return;
  }
  if (req.url === '/browser/stop' && req.method === 'POST') {
    readJson(req, ({ key, close }) => sendJson(res, { ok: detachLocalBrowser(key, !!close) }));
    return;
  }
  if (req.url === '/workspace' && req.method === 'GET') {
    sendJson(res, loadWorkspace());
    return;
  }
  if (req.url === '/workspace' && req.method === 'PUT') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const ws = JSON.parse(body);
        if (!Array.isArray(ws.collections) || !Array.isArray(ws.environments)) throw new Error('bad workspace');
        saveWorkspace(ws);
        sendJson(res, { ok: true });
      } catch (err) {
        sendJson(res, { ok: false, message: err.message }, 400);
      }
    });
    return;
  }
  if (req.url === '/replay' && req.method === 'POST') {
    readJson(req, (p) => {
      replay(p).then((id) => sendJson(res, { ok: true, id })).catch((err) => sendJson(res, { ok: false, message: err.message }, 400));
    });
    return;
  }
  if (req.url === '/clear' && req.method === 'POST') {
    rawBuf.length = 0;
    rawIndex.clear();
    rawBytes = 0;
    for (const r of rawClients) r.write('event: clear\ndata: {}\n\n');
    entries.length = 0;
    broadcast('clear', {});
    res.writeHead(204).end();
    return;
  }
  res.writeHead(404).end();
}

/** Starts the page server and the adb reader; resolves with the bound port (0 = any free port). */
function start({ port = 9400, adb, fresh, dataDir } = {}) {
  if (adb) ADB = adb;
  if (dataDir) DATA_DIR = dataDir;
  if (fresh != null) FRESH = fresh;
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      pollDevices();
      setInterval(() => {
        for (const res of clients) res.write(': ping\n\n');
      for (const res of rawClients) res.write(': ping\n\n');
      }, 15000).unref();
      resolve(server.address().port);
    });
  });
}

function stop() {
  stopped = true;
  stopQrPairing();
  for (const k of [...localBrowsers.keys()]) detachLocalBrowser(k, false);
  for (const d of devices.values()) {
    if (d.child) d.child.kill();
    cdpDropAll(d);
  }
}

module.exports = {
  start,
  stop,
  // For tests only: drive the parsers without adb.
  _test: {
    ingest,
    sdkEvent,
    importHar,
    entries,
    serialize,
    reset() {
      entries.length = 0;
      active.clear();
      rawBuf.length = 0;
      rawIndex.clear();
      rawBytes = 0;
    },
  },
};

if (require.main === module) {
  process.on('uncaughtException', (err) => logError('uncaught', err));
  process.on('unhandledRejection', (err) => logError('unhandled', err));
  start({ port: Number(process.env.PORT || 9400) }).then((port) => {
    console.log(`Netscope → http://localhost:${port}`);
  });
}
