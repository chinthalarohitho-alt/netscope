// Netscope — session and analysis features: HAR export/import, edit & resend, compare,
// timing waterfall, and GraphQL / gRPC labels. Loaded before the main script; everything
// here only runs from initFeatures() or from the main script's render calls.

/* global S, $, esc, toast, copy, fmtTime, fmtSize, parseUrl, tryJson, statusPill, pathHtml,
   devName, mimeOf, renderList, select, store */

(() => {
  const css = `
  .proto { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 5px; font: 600 10.5px/1.5 var(--sans); vertical-align: 1px; }
  .proto.gql { color: #e535ab; background: rgba(229, 53, 171, .12); }
  .proto.grpc { color: #2dace0; background: rgba(45, 172, 224, .13); }
  .proto.ws { color: var(--info); background: var(--info-soft); }
  .c-wf { width: 170px; }
  td.c-wf { padding-right: 16px; }
  .wf { position: relative; height: 8px; border-radius: 3px; background: var(--line-soft); }
  .wf i { position: absolute; top: 0; bottom: 0; min-width: 2px; border-radius: 3px; background: var(--accent); }
  .wf i.slow { background: var(--warn); } .wf i.vslow { background: var(--err); } .wf i.fail { background: var(--err); opacity: .5; }
  .wf i.pend { background: repeating-linear-gradient(90deg, var(--muted) 0 4px, transparent 4px 8px); }
  .hide-wf .c-wf { display: none; }
  .fx-modal .sheet { width: min(860px, 100%); }
  .fx-grid { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; }
  .fx-grid select, .fx-grid input { height: 36px; font: 13px var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; outline: none; }
  .fx-ta { width: 100%; min-height: 120px; resize: vertical; font: 12px/1.5 var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; outline: none; }
  .fx-grid select:focus, .fx-grid input:focus, .fx-ta:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .fx-lbl { font-size: 12px; color: var(--text-2); font-weight: 500; margin: 12px 0 5px; display: flex; justify-content: space-between; }
  .fx-row { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
  .fx-row .grow { flex: 1; }
  .diff { font: 12px/1.55 var(--mono); border: 1px solid var(--line-soft); border-radius: 9px; overflow: auto; max-height: 60vh; background: var(--surface-2); }
  .diff div { white-space: pre-wrap; word-break: break-all; padding: 0 10px 0 28px; position: relative; }
  .diff div::before { position: absolute; left: 10px; color: var(--muted); }
  .diff .a { background: var(--err-soft); } .diff .a::before { content: "−"; color: var(--err); }
  .diff .b { background: var(--ok-soft); } .diff .b::before { content: "+"; color: var(--ok); }
  .diff .same { color: var(--text-2); }
  .diff .gap { color: var(--muted); font-style: italic; padding: 2px 10px; background: var(--surface); }
  .cmp-head { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .cmp-card { border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px; background: var(--surface-2); min-width: 0; }
  .cmp-card .t { font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
  .cmp-card .t.a { color: var(--err); } .cmp-card .t.b { color: var(--ok); }
  .cmp-card .p { font: 12px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; }
  .cmp-card .m { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .iconbtn.pinned { color: var(--accent-text); border-color: var(--accent); background: var(--accent-soft); }
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
})();

// ---------- GraphQL / gRPC / WebSocket labels ----------
function protoOf(e) {
  if (e._proto !== undefined) return e._proto;
  let p = null;
  const ct = (e.reqHeaders || []).find(([k]) => /^content-type$/i.test(k))?.[1] || '';
  const u = parseUrl(e.url);
  if (/application\/grpc/i.test(ct) || /application\/grpc/i.test(mimeOf(e))) {
    const parts = (u?.pathname || '').split('/').filter(Boolean);
    p = { kind: 'grpc', label: parts.length >= 2 ? `${parts[parts.length - 2].split('.').pop()}/${parts[parts.length - 1]}` : 'gRPC' };
  } else if (u && /^wss?:/.test(u.protocol)) {
    p = { kind: 'ws', label: 'WebSocket' };
  } else if (e.reqBody && /graphql/i.test(e.url + ct)) {
    p = gqlOf(e.reqBody);
  } else if (e.reqBody && /^\s*[[{]/.test(e.reqBody) && /"query"\s*:/.test(e.reqBody)) {
    p = gqlOf(e.reqBody);
  }
  return (e._proto = p);
}
function gqlOf(body) {
  const j = tryJson(body);
  const one = Array.isArray(j) ? j[0] : j;
  if (!one || typeof one.query !== 'string') return null;
  const m = one.query.match(/\b(query|mutation|subscription)\s+([A-Za-z_]\w*)/);
  const name = one.operationName || m?.[2];
  const kind = m?.[1] || 'query';
  return { kind: 'gql', label: `${kind === 'mutation' ? 'mutation ' : kind === 'subscription' ? 'sub ' : ''}${name || 'GraphQL'}${Array.isArray(j) && j.length > 1 ? ` +${j.length - 1}` : ''}` };
}
function protoLabel(e) {
  const p = protoOf(e);
  return p ? `<span class="proto ${p.kind}" title="${p.kind === 'gql' ? 'GraphQL operation' : p.kind === 'grpc' ? 'gRPC method' : ''}">${esc(p.label)}</span>` : '';
}

// ---------- timing waterfall ----------
function startMs(e) {
  if (e._t !== undefined) return e._t;
  const m = String(e.started || '').match(/^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3})$/);
  if (!m) return (e._t = null);
  const y = new Date().getFullYear();
  return (e._t = new Date(y, m[1] - 1, m[2], m[3], m[4], m[5], m[6]).getTime());
}
const WF = {
  t0: 0,
  span: 1,
  frame(list) {
    let a = Infinity;
    let b = -Infinity;
    for (const e of list) {
      const t = startMs(e);
      if (t == null) continue;
      a = Math.min(a, t);
      b = Math.max(b, t + (e.durationMs || 0));
    }
    this.t0 = Number.isFinite(a) ? a : 0;
    this.span = Number.isFinite(b) ? Math.max(1, b - a) : 1;
  },
  cell(e) {
    const t = startMs(e);
    if (t == null) return '<td class="c-wf"></td>';
    const left = ((t - this.t0) / this.span) * 100;
    const dur = e.durationMs ?? (e.status == null && e.state === 'pending' ? Date.now() - t : 0);
    const width = Math.max(0.3, (dur / this.span) * 100);
    const cls = e.state === 'failed' ? 'fail' : e.status == null ? 'pend' : e.durationMs >= 5000 ? 'vslow' : e.durationMs >= 1500 ? 'slow' : '';
    return `<td class="c-wf" title="starts +${fmtTime(Math.round(t - this.t0)) || '0 ms'}${e.durationMs != null ? ` · ${fmtTime(e.durationMs)}` : ''}"><div class="wf"><i class="${cls}" style="left:${Math.min(99.7, left)}%;width:${Math.min(100 - Math.min(99.7, left), width)}%"></i></div></td>`;
  },
};

// ---------- HAR export / import (sessions) ----------
function isoOf(e) {
  const t = startMs(e);
  return new Date(t ?? Date.now()).toISOString();
}
function harHeaders(pairs) {
  return (pairs || []).map(([name, value]) => ({ name, value: String(value ?? '') }));
}
function toHar(list) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Netscope', version: '1.1.0' },
      pages: [],
      entries: list.map((e) => {
        const u = parseUrl(e.url);
        const reqCt = (e.reqHeaders || []).find(([k]) => /^content-type$/i.test(k))?.[1] || '';
        return {
          startedDateTime: isoOf(e),
          time: e.durationMs ?? 0,
          request: {
            method: e.method,
            url: e.url,
            httpVersion: 'HTTP/1.1',
            headers: harHeaders(e.reqHeaders),
            queryString: u ? [...u.searchParams.entries()].map(([name, value]) => ({ name, value })) : [],
            cookies: [],
            headersSize: -1,
            bodySize: e.reqBody ? e.reqBody.length : 0,
            ...(e.reqBody ? { postData: { mimeType: reqCt.split(';')[0] || 'application/octet-stream', text: e.reqBody } } : {}),
          },
          response: {
            status: e.status ?? 0,
            statusText: e.statusText || '',
            httpVersion: 'HTTP/1.1',
            headers: harHeaders(e.respHeaders),
            cookies: [],
            content: { size: e.size ?? (e.respBody ? e.respBody.length : 0), mimeType: mimeOf(e) || '', ...(e.respBody ? { text: e.respBody } : {}) },
            redirectURL: '',
            headersSize: -1,
            bodySize: e.transferSize ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: e.durationMs ?? 0, receive: 0 },
          _resourceType: e.resourceType,
          _netscope: { device: devName(e.device), app: e.app, source: e.source, error: e.error, truncated: !!e.truncated },
        };
      }),
    },
  };
}
function exportHar() {
  const list = visibleEntries();
  if (!list.length) { toast('Nothing to save'); return; }
  const blob = new Blob([JSON.stringify(toHar(list), null, 1)], { type: 'application/json' });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `netscope-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.har`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Saved ${list.length} request${list.length === 1 ? '' : 's'} as HAR`);
}
async function importHarFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const r = await (await fetch(`/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: text })).json();
    toast(r.ok ? `Opened ${r.count} request${r.count === 1 ? '' : 's'} from ${file.name}` : `Couldn't open: ${r.message}`);
  } catch (err) {
    toast(`Couldn't open: ${err.message}`);
  }
}

// ---------- modals ----------
function fxModal(id, title, body) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fx-modal" id="${id}" role="dialog" aria-modal="true">
      <div class="sheet">
        <div class="sheet-h"><h2>${esc(title)}</h2><button class="x" data-close title="Close (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="sheet-b">${body}</div>
      </div>
    </div>`);
  const m = $('#' + id);
  const close = () => m.classList.remove('open');
  m.querySelector('[data-close]').addEventListener('click', close);
  m.addEventListener('pointerdown', (ev) => { if (ev.target === m) close(); });
  m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
  return m;
}
function anyModalOpen() {
  return !!document.querySelector('.modal.open');
}

// ---------- edit & resend ----------
let resendModal;
function openResend(e) {
  if (!resendModal) {
    resendModal = fxModal('resendModal', 'Edit & resend', `
      <div class="fx-grid">
        <select id="rsMethod">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => `<option>${m}</option>`).join('')}</select>
        <input id="rsUrl" spellcheck="false" autocomplete="off">
      </div>
      <div class="fx-lbl"><span>Headers <small class="muted">— one per line, <code>Name: value</code></small></span></div>
      <textarea class="fx-ta" id="rsHeaders" spellcheck="false"></textarea>
      <div class="fx-lbl"><span>Body</span><button class="iconbtn" id="rsFormat" style="height:24px;font-size:11.5px">Format JSON</button></div>
      <textarea class="fx-ta" id="rsBody" spellcheck="false" style="min-height:160px"></textarea>
      <div class="fx-row">
        <span class="grow hint" style="margin:0">Sent from this Mac, not the phone — addresses like 10.0.2.2 or localhost on the device won't resolve here.</span>
        <button class="btn" id="rsSend">Send</button>
      </div>`);
    $('#rsFormat').addEventListener('click', () => {
      const j = tryJson($('#rsBody').value);
      if (j !== undefined) $('#rsBody').value = JSON.stringify(j, null, 2);
      else toast('Body is not valid JSON');
    });
    $('#rsSend').addEventListener('click', sendResend);
    resendModal.addEventListener('keydown', (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') sendResend(); });
  }
  $('#rsMethod').value = e.method;
  $('#rsUrl').value = e.url;
  $('#rsHeaders').value = (e.reqHeaders || []).filter(([k]) => !/^content-length$/i.test(k)).map(([k, v]) => `${k}: ${v}`).join('\n');
  const j = tryJson(e.reqBody);
  $('#rsBody').value = j !== undefined ? JSON.stringify(j, null, 2) : e.reqBody || '';
  resendModal.classList.add('open');
  setTimeout(() => $('#rsUrl').focus(), 0);
}
async function sendResend() {
  const btn = $('#rsSend');
  const headers = $('#rsHeaders').value.split('\n').map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
  }).filter(Boolean);
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const r = await (await fetch('/replay', {
      method: 'POST',
      body: JSON.stringify({ method: $('#rsMethod').value, url: $('#rsUrl').value.trim(), headers, body: $('#rsBody').value }),
    })).json();
    if (!r.ok) { toast(r.message || 'Send failed'); return; }
    resendModal.classList.remove('open');
    // Show the new call as soon as it arrives on the live feed.
    const t0 = Date.now();
    const pick = () => {
      if (S.byId.has(r.id)) {
        S.view === 'raw' || select(r.id);
        S.scrollToEntry?.(r.id);
      } else if (Date.now() - t0 < 5000) setTimeout(pick, 100);
    };
    pick();
    toast('Sent — shown as “This Mac (resend)”');
  } catch (err) {
    toast(`Send failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

// ---------- compare two calls ----------
let diffModal;
let cmpSide = 'response';
function pretty(text) {
  const j = tryJson(text);
  return j !== undefined ? JSON.stringify(j, null, 2) : String(text || '');
}
// Line diff (LCS); inputs are capped so the table stays small.
function diffLines(a, b) {
  const MAX = 3000;
  const A = a.split('\n').slice(0, MAX);
  const B = b.split('\n').slice(0, MAX);
  const n = A.length;
  const m = B.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(['same', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['a', A[i++]]);
    else out.push(['b', B[j++]]);
  }
  while (i < n) out.push(['a', A[i++]]);
  while (j < m) out.push(['b', B[j++]]);
  return { out, capped: a.split('\n').length > MAX || b.split('\n').length > MAX };
}
function diffHtml(ops) {
  // Collapse long unchanged runs, keeping 3 lines of context around changes.
  const keep = new Array(ops.length).fill(false);
  ops.forEach(([k], i) => { if (k !== 'same') for (let d = -3; d <= 3; d++) if (ops[i + d]) keep[i + d] = true; });
  let html = '';
  let skipped = 0;
  ops.forEach(([k, line], i) => {
    if (keep[i] || ops.length < 60) {
      if (skipped) { html += `<div class="gap">… ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`; skipped = 0; }
      html += `<div class="${k}">${esc(line) || ' '}</div>`;
    } else skipped++;
  });
  if (skipped) html += `<div class="gap">… ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`;
  return html;
}
function openCompare(aId, bId) {
  const A = S.byId.get(aId);
  const B = S.byId.get(bId);
  if (!A || !B) return;
  if (!diffModal) {
    diffModal = fxModal('diffModal', 'Compare calls', `
      <div class="cmp-head" id="cmpHead"></div>
      <div class="segs" id="cmpSide" style="margin-bottom:10px">
        <button data-s="response" class="on">Response body</button>
        <button data-s="request">Request body</button>
        <button data-s="headers">Response headers</button>
      </div>
      <div class="diff" id="cmpDiff"></div>
      <div class="hint" id="cmpNote"></div>`);
    $('#cmpSide').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      cmpSide = b.dataset.s;
      renderCompare();
    });
  }
  diffModal.dataset.a = aId;
  diffModal.dataset.b = bId;
  renderCompare();
  diffModal.classList.add('open');
}
function renderCompare() {
  const A = S.byId.get(Number(diffModal.dataset.a));
  const B = S.byId.get(Number(diffModal.dataset.b));
  if (!A || !B) return;
  document.querySelectorAll('#cmpSide button').forEach((x) => x.classList.toggle('on', x.dataset.s === cmpSide));
  const card = (e, side) => `<div class="cmp-card"><div class="t ${side}">${side === 'a' ? 'Pinned (−)' : 'Selected (+)'}</div>
    <div class="p">${statusPill(e)} <b>${esc(e.method)}</b> ${pathHtml(e)}</div>
    <div class="m">${esc(e.started)} · ${fmtTime(e.durationMs) || '—'} · ${fmtSize(e.size ?? e.transferSize)} · ${esc(devName(e.device))}</div></div>`;
  $('#cmpHead').innerHTML = card(A, 'a') + card(B, 'b');
  const pick = (e) => cmpSide === 'response' ? pretty(e.respBody)
    : cmpSide === 'request' ? pretty(e.reqBody)
      : (e.respHeaders || []).map(([k, v]) => `${k.toLowerCase()}: ${v}`).sort().join('\n');
  const a = pick(A);
  const b = pick(B);
  if (!a && !b) {
    $('#cmpDiff').innerHTML = '<div class="gap">Neither call has this part.</div>';
    $('#cmpNote').textContent = '';
    return;
  }
  const { out, capped } = diffLines(a, b);
  const changes = out.filter(([k]) => k !== 'same').length;
  $('#cmpDiff').innerHTML = changes ? diffHtml(out) : '<div class="gap">Identical.</div>';
  $('#cmpNote').textContent = `${changes} changed line${changes === 1 ? '' : 's'}${capped ? ' · compared the first 3,000 lines' : ''}`;
}

// ---------- detail actions ----------
function updateDetailActions() {
  const b = $('#cmpBtn');
  if (!b) return;
  const pinned = S.cmpPin != null && S.byId.has(S.cmpPin);
  const other = pinned && S.cmpPin !== S.sel;
  b.classList.toggle('pinned', pinned && !other);
  b.lastChild.textContent = other ? 'Compare with pinned' : pinned ? 'Pinned' : 'Compare';
  b.title = other ? 'Compare this call with the pinned one' : pinned ? 'Click to unpin' : 'Pin this call, then select another to compare';
}
function onCompareClick() {
  const pinned = S.cmpPin != null && S.byId.has(S.cmpPin);
  if (pinned && S.cmpPin !== S.sel) { openCompare(S.cmpPin, S.sel); return; }
  if (pinned) { S.cmpPin = null; toast('Unpinned'); } else { S.cmpPin = S.sel; toast('Pinned — select another call and click Compare'); }
  updateDetailActions();
}

// The calls currently shown (after every filter), for Save.
function visibleEntries() {
  return (S.shown || []).slice();
}

function initFeatures() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.har,.json,application/json';
  fileInput.hidden = true;
  document.body.append(fileInput);
  fileInput.addEventListener('change', () => { importHarFile(fileInput.files[0]); fileInput.value = ''; });
  $('#openHar')?.addEventListener('click', () => fileInput.click());
  $('#saveHar')?.addEventListener('click', exportHar);
  $('#resendBtn')?.addEventListener('click', () => { const e = S.byId.get(S.sel); if (e) openResend(e); });
  $('#cmpBtn')?.addEventListener('click', onCompareClick);
  // Drop a .har anywhere on the window to open it.
  document.addEventListener('dragover', (ev) => { if ([...(ev.dataTransfer?.items || [])].some((i) => i.kind === 'file')) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => {
    const f = ev.dataTransfer?.files?.[0];
    if (f && /\.(har|json)$/i.test(f.name)) { ev.preventDefault(); importHarFile(f); }
  });
  document.addEventListener('keydown', (ev) => {
    if (anyModalOpen() || S.view === 'client' || ev.target.matches?.('input, textarea, select')) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); exportHar(); }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'o') { ev.preventDefault(); fileInput.click(); }
    if (ev.key === 'r' && !ev.metaKey && !ev.ctrlKey && S.sel != null) { const e = S.byId.get(S.sel); if (e) openResend(e); }
  });
}

// ---------- themed <select> menus ----------
// Every <select> keeps its value, events and styling, but opens this menu instead of the native
// macOS one. HTTP-method selects get coloured items.
(() => {
  const css = `
  select { appearance: none; -webkit-appearance: none; cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a94a6' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 9px center; padding-right: 28px !important; }
  select.ns-open { border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-soft) !important; }
  .ns-menu { position: fixed; z-index: 200; background: var(--raised); border: 1px solid var(--line); border-radius: 11px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, .32), 0 2px 6px rgba(0, 0, 0, .12); padding: 5px; overflow: auto; max-height: 340px;
    opacity: 0; transform: translateY(-3px); transition: opacity .1s, transform .1s; }
  .ns-menu.show { opacity: 1; transform: none; }
  .ns-item { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; color: var(--text);
    text-align: left; padding: 7px 10px; border-radius: 7px; cursor: pointer; font: 13px var(--sans); white-space: nowrap; }
  .ns-item:hover, .ns-item.kb { background: var(--hover); }
  .ns-item.on { background: var(--accent-soft); }
  .ns-item .ck { width: 14px; flex: none; color: var(--accent-text); visibility: hidden; }
  .ns-item.on .ck { visibility: visible; }
  .ns-item .lb { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .ns-item.m .lb { font: 700 12.5px var(--mono); letter-spacing: .02em; }
  .ns-item[disabled] { opacity: .45; cursor: default; }
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  const METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
  const COLOR = { GET: 'var(--m-get)', POST: 'var(--m-post)', PUT: 'var(--m-put)', PATCH: 'var(--m-patch)', DELETE: 'var(--m-delete)' };
  const TICK = '<svg class="ck" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  let menu = null;
  let owner = null;
  let kb = -1;

  function close(refocus) {
    if (!menu) return;
    menu.remove();
    menu = null;
    owner?.classList.remove('ns-open');
    if (refocus) owner?.focus();
    owner = null;
  }
  function choose(i) {
    const sel = owner;
    const opt = sel.options[i];
    if (!opt || opt.disabled) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close(true);
    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function mark(i) {
    kb = i;
    menu.querySelectorAll('.ns-item').forEach((x, k) => x.classList.toggle('kb', k === i));
    menu.querySelectorAll('.ns-item')[i]?.scrollIntoView({ block: 'nearest' });
  }
  function open(sel) {
    close();
    owner = sel;
    const opts = [...sel.options];
    const isMethod = opts.length && opts.every((o) => METHOD_RE.test(o.value || o.text));
    menu = document.createElement('div');
    menu.className = 'ns-menu';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = opts.map((o, i) => {
      const c = isMethod ? COLOR[o.value || o.text] : '';
      return `<button class="ns-item ${isMethod ? 'm' : ''} ${i === sel.selectedIndex ? 'on' : ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''} role="option">${TICK}<span class="lb" ${c ? `style="color:${c}"` : ''}>${esc(o.text)}</span></button>`;
    }).join('');
    document.body.append(menu);
    const r = sel.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(r.width, isMethod ? 150 : 180)}px`;
    const h = menu.offsetHeight;
    const below = window.innerHeight - r.bottom - 12;
    const top = h <= below || r.top < h ? r.bottom + 6 : r.top - h - 6;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    sel.classList.add('ns-open');
    requestAnimationFrame(() => menu?.classList.add('show'));
    kb = sel.selectedIndex;
    menu.querySelectorAll('.ns-item')[kb]?.scrollIntoView({ block: 'nearest' });
    menu.addEventListener('pointerdown', (ev) => ev.preventDefault()); // keep focus on the select
    menu.addEventListener('click', (ev) => { const b = ev.target.closest('.ns-item'); if (b) choose(Number(b.dataset.i)); });
  }

  // Open ours instead of the native popup.
  document.addEventListener('mousedown', (ev) => {
    const sel = ev.target.closest?.('select');
    if (sel && !sel.disabled && !sel.multiple) {
      ev.preventDefault();
      sel.focus();
      if (owner === sel) close(); else open(sel);
      return;
    }
    if (menu && !menu.contains(ev.target)) close();
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (menu) {
      const n = owner.options.length;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        let i = kb;
        for (let step = 0; step < n; step++) {
          i = (i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
          if (!owner.options[i].disabled) break;
        }
        mark(i);
      } else if (ev.key === 'Enter' || ev.key === ' ') choose(kb);
      else if (ev.key === 'Escape' || ev.key === 'Tab') close(ev.key === 'Escape');
      else if (ev.key.length === 1) {
        const k = ev.key.toLowerCase();
        const opts = [...owner.options];
        const start = kb + 1;
        const hit = [...opts.slice(start), ...opts.slice(0, start)].find((o) => o.text.toLowerCase().startsWith(k));
        if (hit) mark(hit.index);
      } else return;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const sel = ev.target.closest?.('select');
    if (sel && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(ev.key) && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      ev.stopPropagation();
      open(sel);
    }
  }, true);
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', (ev) => { if (menu && !menu.contains(ev.target)) close(); }, true);
})();
