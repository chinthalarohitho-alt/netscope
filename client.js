// Netscope — API client (Postman-style): collections and folders of saved requests, an editor
// (params, headers, body, auth), environments with {{variables}}, a response viewer, and
// Postman v2.1 / cURL import and export. Requests are sent from this Mac through /replay, so
// every send also shows up in the Requests list.

/* global S, $, esc, toast, copy, tryJson, parseUrl, jsonNode, fmtTime, fmtSize, statusPill,
   store, curlOf, mimeOf, setView */

(() => {
  const css = `
  #clientCard { display: none; flex: 1; min-width: 0; }
  .client-mode #clientCard { display: flex; }
  .client-mode #listCard, .client-mode #split, .client-mode #detail, .client-mode #rawCard { display: none !important; }
  .client-mode .search, .client-mode #rec, .client-mode #clear, .client-mode #openHar, .client-mode #saveHar { display: none; }
  .cl-side { width: 280px; flex: none; border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .cl-side-h { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px 14px; }
  .cl-side-h b { flex: 1; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .cl-side-h .iconbtn { height: 26px; min-width: 26px; padding: 0 7px; font-size: 12px; }
  .cl-env { padding: 0 10px 8px; display: flex; gap: 6px; }
  .cl-env select { flex: 1; min-width: 0; height: 30px; font: inherit; font-size: 12.5px; color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; }
  .cl-env .iconbtn { height: 30px; font-size: 12px; }
  .cl-tree { flex: 1; overflow: auto; padding: 2px 6px 12px; font-size: 12.5px; }
  .cl-node { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 7px; cursor: pointer; color: var(--text); position: relative; user-select: none; }
  .cl-node:hover { background: var(--hover); }
  .cl-node.on { background: var(--sel); box-shadow: inset 3px 0 0 var(--accent); }
  .cl-node .tw { width: 14px; color: var(--muted); flex: none; transition: transform .1s; display: grid; place-items: center; }
  .cl-node.open > .tw { transform: rotate(90deg); }
  .cl-node .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl-node .mb { font: 700 9.5px/1 var(--mono); width: 38px; flex: none; text-align: right; }
  .cl-node .more { opacity: 0; border: 0; background: transparent; color: var(--muted); width: 22px; height: 22px; border-radius: 5px; cursor: pointer; flex: none; }
  .cl-node:hover .more, .cl-node .more.open { opacity: 1; }
  .cl-node .more:hover { background: var(--surface-2); color: var(--text); }
  .cl-node input.rn { flex: 1; min-width: 0; height: 24px; font: inherit; color: var(--text); background: var(--surface-2); border: 1px solid var(--accent); border-radius: 5px; padding: 0 6px; outline: none; }
  .cl-kids { padding-left: 14px; }
  .cl-empty { color: var(--muted); padding: 18px 12px; line-height: 1.6; font-size: 12.5px; }
  .cl-menu { position: fixed; z-index: 120; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.3); padding: 5px; min-width: 190px; }
  .cl-menu button { display: flex; width: 100%; text-align: left; padding: 7px 10px; border: 0; background: transparent; color: var(--text); border-radius: 7px; cursor: pointer; font-size: 12.5px; }
  .cl-menu button:hover { background: var(--hover); }
  .cl-menu button.danger { color: var(--err); }
  .cl-menu hr { border: 0; border-top: 1px solid var(--line-soft); margin: 4px 2px; }
  .cl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .cl-top { padding: 12px 14px 0; }
  .cl-name { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .cl-name input { flex: 1; min-width: 0; height: 30px; font: 600 14px var(--sans); color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 7px; padding: 0 8px; outline: none; }
  .cl-name input:hover { border-color: var(--line); }
  .cl-name input:focus { border-color: var(--accent); background: var(--surface-2); }
  .cl-name .crumb { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
  .cl-dirty { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); flex: none; }
  .cl-urlrow { display: flex; gap: 8px; }
  .cl-urlrow select { height: 38px; font: 700 12.5px var(--mono); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; outline: none; }
  .cl-urlrow input { flex: 1; min-width: 0; height: 38px; font: 13px var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; outline: none; }
  .cl-urlrow input:focus, .cl-urlrow select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .cl-urlrow .btn { height: 38px; min-width: 84px; }
  .cl-resolved { font: 11.5px var(--mono); color: var(--muted); margin: 6px 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl-resolved .miss { color: var(--warn); }
  .cl-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin-top: 8px; padding: 0 4px; }
  .cl-tabs .tab .n { color: var(--muted); font-size: 11px; margin-left: 4px; }
  .cl-split { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .cl-req { flex: 0 0 auto; max-height: 45%; overflow: auto; padding: 12px 14px; }
  .cl-req.tall { max-height: 68%; }
  .cl-resp { flex: 1; min-height: 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; }
  .cl-resp-h { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--line-soft); color: var(--muted); font-size: 12px; }
  .cl-resp-h b { color: var(--text-2); font-weight: 500; }
  .cl-resp-b { flex: 1; overflow: auto; padding: 12px 14px 24px; }
  .kvt { width: 100%; border-collapse: collapse; font: 12.5px var(--mono); table-layout: fixed; }
  .kvt th:first-child, .kvt th:last-child, .kvt td.ck, .kvt td.rm { width: 34px; }
  .kvt td { border-bottom: 1px solid var(--line-soft); padding: 0; }
  .kvt td.ck { width: 30px; text-align: center; }
  .kvt td.rm { width: 30px; text-align: center; }
  .kvt input[type=text] { width: 100%; height: 32px; font: inherit; color: var(--text); background: transparent; border: 0; padding: 0 8px; outline: none; }
  .kvt input[type=text]:focus { background: var(--surface-2); }
  .kvt tr.off input[type=text] { color: var(--muted); text-decoration: line-through; }
  .kvt .x2 { opacity: .5; border: 0; background: transparent; color: var(--muted); cursor: pointer; width: 22px; height: 22px; border-radius: 5px; }
  .kvt tr:hover .x2 { opacity: 1; }
  .kvt th { text-align: left; font: 600 10.5px var(--sans); text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .cl-body-modes { display: flex; gap: 14px; margin-bottom: 10px; font-size: 12.5px; color: var(--text-2); flex-wrap: wrap; align-items: center; }
  .cl-body-modes label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
  .cl-body-modes .grow { flex: 1; }
  .cl-ta { width: 100%; min-height: 180px; resize: vertical; font: 12.5px/1.55 var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; outline: none; tab-size: 2; }
  .cl-ta:focus { border-color: var(--accent); }
  .cl-auth { display: grid; grid-template-columns: 110px 1fr; gap: 10px; align-items: center; max-width: 640px; font-size: 12.5px; color: var(--text-2); }
  .cl-auth select, .cl-auth input { height: 32px; font: 12.5px var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 7px; padding: 0 9px; outline: none; }
  .cl-auth select { font-family: var(--sans); }
  .cl-hint { color: var(--muted); font-size: 12px; margin-top: 10px; line-height: 1.5; }
  .cl-hint code { font: 11.5px var(--mono); color: var(--text-2); }
  .cl-blank { flex: 1; display: grid; place-items: center; color: var(--muted); text-align: center; padding: 30px; }
  .cl-blank b { color: var(--text); font-size: 15px; display: block; margin-bottom: 6px; }
  .cl-blank .btn { margin: 14px 6px 0; }
  .env-grid { display: grid; grid-template-columns: 200px 1fr; gap: 16px; min-height: 320px; }
  .env-list { border-right: 1px solid var(--line-soft); padding-right: 12px; display: flex; flex-direction: column; gap: 4px; }
  .env-list button.e { text-align: left; padding: 7px 10px; border-radius: 7px; border: 0; background: transparent; color: var(--text); cursor: pointer; font-size: 12.5px; display: flex; gap: 6px; align-items: center; }
  .env-list button.e:hover { background: var(--hover); }
  .env-list button.e.on { background: var(--sel); }
  .env-list button.e .act { margin-left: auto; font-size: 10.5px; color: var(--ok); }
  .save-grid { display: grid; gap: 12px; }
  .md { font-size: 13.5px; line-height: 1.65; color: var(--text); max-width: 860px; }
  .md h1 { font-size: 20px; margin: 4px 0 12px; } .md h2 { font-size: 16px; margin: 20px 0 8px; } .md h3 { font-size: 14px; margin: 16px 0 6px; }
  .md h1, .md h2, .md h3, .md h4 { font-weight: 650; letter-spacing: -.01em; }
  .md p { margin: 0 0 10px; } .md ul, .md ol { margin: 0 0 10px; padding-left: 22px; } .md li { margin: 2px 0; }
  .md li.task { list-style: none; margin-left: -18px; } .md li.task .done { color: var(--ok); }
  .md code { font: 12px var(--mono); background: var(--surface-2); border: 1px solid var(--line-soft); border-radius: 5px; padding: 1px 5px; }
  .md pre.md-code { background: var(--surface-2); border: 1px solid var(--line-soft); border-radius: 9px; padding: 10px 12px; overflow: auto; margin: 0 0 12px; }
  .md pre.md-code code { background: none; border: 0; padding: 0; white-space: pre; }
  .md blockquote { margin: 0 0 10px; padding: 6px 12px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 7px 7px 0; color: var(--text-2); }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }
  .md a { color: var(--accent-text); }
  .md table.md-table { border-collapse: collapse; margin: 0 0 12px; font-size: 12.5px; }
  .md table.md-table th, .md table.md-table td { border: 1px solid var(--line); padding: 5px 10px; text-align: left; }
  .md table.md-table th { background: var(--surface-2); font-weight: 600; }
  .md-empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
  .sc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .sc-grid .lbl { font-size: 12px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .sc-grid .lbl small { font-weight: 400; color: var(--muted); }
  .sc-ta { width: 100%; min-height: 200px; resize: vertical; font: 12.5px/1.55 var(--mono); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; outline: none; tab-size: 2; }
  .sc-ta:focus { border-color: var(--accent); }
  .sc-snips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .sc-snips button { height: 24px; font-size: 11.5px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2); cursor: pointer; }
  .sc-snips button:hover { color: var(--text); border-color: var(--muted); }
  .tst { display: flex; gap: 10px; align-items: flex-start; padding: 7px 4px; border-bottom: 1px solid var(--line-soft); font-size: 13px; }
  .tst .b { font: 700 11px var(--sans); padding: 2px 7px; border-radius: 5px; flex: none; }
  .tst .b.p { color: var(--ok); background: var(--ok-soft); } .tst .b.f { color: var(--err); background: var(--err-soft); }
  .tst .e { color: var(--err); font: 12px var(--mono); margin-top: 3px; }
  .cons { font: 12px/1.6 var(--mono); }
  .cons div { padding: 2px 4px; border-bottom: 1px solid var(--line-soft); white-space: pre-wrap; word-break: break-all; }
  .cons .warn { color: var(--warn); } .cons .error { color: var(--err); }
  .docs-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
  .docs-bar .grow { flex: 1; }
  .save-grid select, .save-grid input { height: 36px; font: 13px var(--sans); color: var(--text); background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 10px; outline: none; }
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
})();

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_COLOR = { GET: 'var(--m-get)', POST: 'var(--m-post)', PUT: 'var(--m-put)', PATCH: 'var(--m-patch)', DELETE: 'var(--m-delete)' };

function blankRequest(name = 'New request') {
  return {
    id: uid(), type: 'request', name, method: 'GET', url: '', params: [], headers: [],
    body: { mode: 'none', text: '', form: [] }, auth: { type: 'inherit' },
    docs: '', scripts: { pre: '', post: '' },
  };
}

const C = {
  ws: { version: 1, collections: [], environments: [], activeEnv: null },
  loaded: false,
  openId: null, // saved request being edited, or null for an unsaved draft
  draft: null, // the editor's working copy
  dirty: false,
  expanded: new Set(), // filled in initClient(); the main script's `store` isn't defined yet at load
  tab: 'params',
  rtab: 'body',
  resp: null, // { entryId } of the last send from the editor
  saveT: null,
};

// ---------- persistence ----------
async function clLoad() {
  try {
    C.ws = await (await fetch('/workspace')).json();
  } catch {
    toast('Could not load collections');
  }
  C.loaded = true;
}
function clPersist() {
  clearTimeout(C.saveT);
  C.saveT = setTimeout(async () => {
    try {
      const r = await (await fetch('/workspace', { method: 'PUT', body: JSON.stringify(C.ws) })).json();
      if (!r.ok) toast(`Save failed: ${r.message}`);
    } catch {
      toast('Save failed');
    }
  }, 300);
}
function saveExpanded() { store.set('cl.expanded', JSON.stringify([...C.expanded])); }

// ---------- tree helpers ----------
function walk(items, fn, parent = null, col = null) {
  for (const it of items) {
    if (fn(it, parent, col) === false) return false;
    if (it.items && walk(it.items, fn, it, col) === false) return false;
  }
  return true;
}
function findNode(id) {
  let hit = null;
  for (const col of C.ws.collections) {
    if (col.id === id) return { node: col, parent: null, col };
    walk(col.items, (it, parent) => {
      if (it.id === id) { hit = { node: it, parent: parent || col, col }; return false; }
      return true;
    }, null, col);
    if (hit) return hit;
  }
  return null;
}
function crumbOf(id) {
  const f = findNode(id);
  if (!f) return '';
  const path = [];
  let cur = f;
  while (cur && cur.parent) {
    path.unshift(cur.parent.name);
    cur = findNode(cur.parent.id);
  }
  return path.join(' / ');
}

// ---------- variables ----------
function activeEnv() { return C.ws.environments.find((e) => e.id === C.ws.activeEnv) || null; }
function varMap() {
  const m = new Map();
  const col = C.openId ? findNode(C.openId)?.col : null;
  for (const v of col?.vars || []) if (v.enabled !== false && v.key) m.set(v.key, v.value ?? '');
  for (const v of activeEnv()?.vars || []) if (v.enabled !== false && v.key) m.set(v.key, v.value ?? ''); // env wins
  return m;
}
function subst(str, vars, missing) {
  return String(str ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, k) => {
    if (vars.has(k)) return vars.get(k);
    missing?.add(k);
    return all;
  });
}

// ---------- building the request to send ----------
function effectiveAuth(req) {
  if (req.auth?.type && req.auth.type !== 'inherit') return req.auth;
  const f = findNode(req.id);
  // Walk up folders to the collection for an inherited auth.
  let cur = f?.parent;
  while (cur) {
    if (cur.auth?.type && cur.auth.type !== 'inherit') return cur.auth;
    cur = cur.id === f?.col?.id ? null : findNode(cur.id)?.parent;
  }
  return f?.col?.auth || { type: 'none' };
}
function buildRequest(req, extraVars) {
  const vars = varMap();
  for (const [k, v] of Object.entries(extraVars || {})) vars.set(k, v);
  const missing = new Set();
  const s = (x) => subst(x, vars, missing);
  let url = s(req.url).trim();
  const headers = [];
  for (const h of req.headers || []) if (h.enabled !== false && h.key) headers.push([s(h.key), s(h.value)]);
  const has = (name) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());
  const auth = effectiveAuth(req);
  const extraQuery = [];
  if (auth.type === 'bearer' && auth.token) { if (!has('authorization')) headers.push(['Authorization', `Bearer ${s(auth.token)}`]); }
  if (auth.type === 'basic' && (auth.username || auth.password)) {
    if (!has('authorization')) headers.push(['Authorization', `Basic ${btoa(unescape(encodeURIComponent(`${s(auth.username)}:${s(auth.password)}`)))}`]);
  }
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') extraQuery.push([s(auth.key), s(auth.value)]);
    else if (!has(s(auth.key))) headers.push([s(auth.key), s(auth.value)]);
  }
  if (extraQuery.length) {
    const qs = extraQuery.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  let body = '';
  const b = req.body || { mode: 'none' };
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (b.mode === 'json') {
      body = s(b.text);
      if (!has('content-type')) headers.push(['Content-Type', 'application/json']);
    } else if (b.mode === 'raw') {
      body = s(b.text);
    } else if (b.mode === 'urlencoded') {
      body = (b.form || []).filter((f) => f.enabled !== false && f.key)
        .map((f) => `${encodeURIComponent(s(f.key))}=${encodeURIComponent(s(f.value))}`).join('&');
      if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    }
  }
  if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  return { method: req.method, url, headers, body, missing };
}

// URL <-> params table
function paramsFromUrl(url) {
  const q = url.indexOf('?');
  if (q < 0) return [];
  return url.slice(q + 1).split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
    return { key: dec(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : dec(p.slice(i + 1)), enabled: true };
  });
}
function urlWithParams(url, params) {
  const base = url.split('?')[0];
  // Keep {{vars}} readable instead of percent-encoding their braces.
  const enc = (x) => encodeURIComponent(x).replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}');
  const qs = params.filter((p) => p.enabled !== false && p.key).map((p) => `${enc(p.key)}${p.value !== '' ? `=${enc(p.value)}` : ''}`).join('&');
  return qs ? `${base}?${qs}` : base;
}

// ---------- cURL import ----------
function shellSplit(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  const s = cmd.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === "'" || c === '"') { q = c; has = true; } else if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; } else if (/\s/.test(c)) {
      if (cur || has) { out.push(cur); cur = ''; has = false; }
    } else { cur += c; has = true; }
  }
  if (cur || has) out.push(cur);
  return out;
}
function fromCurl(cmd) {
  const a = shellSplit(cmd.trim());
  if (a[0] !== 'curl') return null;
  const req = blankRequest('Imported from cURL');
  let data = null;
  for (let i = 1; i < a.length; i++) {
    const t = a[i];
    const next = () => a[++i];
    if (t === '-X' || t === '--request') req.method = (next() || 'GET').toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = next() || '';
      const k = h.indexOf(':');
      if (k > 0) req.headers.push({ key: h.slice(0, k).trim(), value: h.slice(k + 1).trim(), enabled: true });
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(t)) data = (data ? `${data}&` : '') + (next() || '');
    else if (t === '--url') req.url = next() || '';
    else if (t === '-u' || t === '--user') {
      const [u, p = ''] = (next() || '').split(':');
      req.auth = { type: 'basic', username: u, password: p };
    } else if (!t.startsWith('-') && !req.url) req.url = t;
    else if (['-o', '--output', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--connect-timeout', '-m', '--max-time'].includes(t)) next();
  }
  if (data != null) {
    if (req.method === 'GET') req.method = 'POST';
    const ct = req.headers.find((h) => /^content-type$/i.test(h.key))?.value || '';
    const isJson = /json/i.test(ct) || tryJson(data) !== undefined;
    req.body = { mode: isJson ? 'json' : 'raw', text: isJson && tryJson(data) !== undefined ? JSON.stringify(tryJson(data), null, 2) : data, form: [] };
  }
  const auth = req.headers.find((h) => /^authorization$/i.test(h.key) && /^bearer /i.test(h.value));
  if (auth) {
    req.auth = { type: 'bearer', token: auth.value.replace(/^bearer\s+/i, '') };
    req.headers = req.headers.filter((h) => h !== auth);
  }
  req.params = paramsFromUrl(req.url);
  try { req.name = `${req.method} ${new URL(req.url).pathname}`; } catch {}
  return req;
}

// ---------- captured call -> editable request ----------
function fromEntry(e) {
  const req = blankRequest();
  req.method = e.method;
  req.url = e.url;
  req.params = paramsFromUrl(e.url);
  let token = null;
  for (const [k, v] of e.reqHeaders || []) {
    if (/^(content-length|host|connection|accept-encoding)$/i.test(k)) continue;
    if (/^authorization$/i.test(k) && /^bearer /i.test(v)) { token = v.replace(/^bearer\s+/i, ''); continue; }
    req.headers.push({ key: k, value: v, enabled: true });
  }
  if (token) req.auth = { type: 'bearer', token };
  if (e.reqBody) {
    const j = tryJson(e.reqBody);
    const ct = (e.reqHeaders || []).find(([k]) => /^content-type$/i.test(k))?.[1] || '';
    if (j !== undefined) {
      req.body = { mode: 'json', text: JSON.stringify(j, null, 2), form: [] };
      req.headers = req.headers.filter((h) => !/^content-type$/i.test(h.key) || !/json/i.test(h.value));
    } else if (/x-www-form-urlencoded/i.test(ct)) {
      req.body = { mode: 'urlencoded', text: '', form: paramsFromUrl(`?${e.reqBody}`) };
      req.headers = req.headers.filter((h) => !/^content-type$/i.test(h.key));
    } else req.body = { mode: 'raw', text: e.reqBody, form: [] };
  }
  try { req.name = `${e.method} ${new URL(e.url).pathname}`; } catch { req.name = `${e.method} request`; }
  return req;
}

// ---------- Postman v2.1 ----------
function pmKV(list) { return (list || []).map((x) => ({ key: x.key ?? '', value: x.value ?? '', enabled: !x.disabled })); }
function pmAuthIn(a) {
  if (!a || !a.type || a.type === 'noauth') return a?.type === 'noauth' ? { type: 'none' } : { type: 'inherit' };
  const get = (arr, k) => (a[arr] || []).find((x) => x.key === k)?.value ?? '';
  if (a.type === 'bearer') return { type: 'bearer', token: get('bearer', 'token') };
  if (a.type === 'basic') return { type: 'basic', username: get('basic', 'username'), password: get('basic', 'password') };
  if (a.type === 'apikey') return { type: 'apikey', key: get('apikey', 'key'), value: get('apikey', 'value'), in: get('apikey', 'in') === 'query' ? 'query' : 'header' };
  return { type: 'inherit' };
}
function pmAuthOut(a) {
  if (!a || a.type === 'inherit') return undefined;
  if (a.type === 'none') return { type: 'noauth' };
  const kv = (o) => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }));
  if (a.type === 'bearer') return { type: 'bearer', bearer: kv({ token: a.token || '' }) };
  if (a.type === 'basic') return { type: 'basic', basic: kv({ username: a.username || '', password: a.password || '' }) };
  if (a.type === 'apikey') return { type: 'apikey', apikey: kv({ key: a.key || '', value: a.value || '', in: a.in || 'header' }) };
  return undefined;
}
function pmDesc(d) { return typeof d === 'string' ? d : d?.content || ''; }
function pmScriptsIn(events) {
  const get = (listen) => {
    const ev = (events || []).find((e) => e.listen === listen);
    const exec = ev?.script?.exec;
    return Array.isArray(exec) ? exec.join('\n') : exec || '';
  };
  return { pre: get('prerequest'), post: get('test') };
}
function pmScriptsOut(sc) {
  const out = [];
  const lines = (t) => String(t).split('\n');
  if (sc?.pre?.trim()) out.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(sc.pre) } });
  if (sc?.post?.trim()) out.push({ listen: 'test', script: { type: 'text/javascript', exec: lines(sc.post) } });
  return out.length ? { event: out } : {};
}
function pmItemIn(it) {
  if (Array.isArray(it.item)) {
    return { id: uid(), type: 'folder', name: it.name || 'Folder', items: it.item.map(pmItemIn), auth: pmAuthIn(it.auth), docs: pmDesc(it.description), scripts: pmScriptsIn(it.event) };
  }
  const r = it.request || {};
  const req = blankRequest(it.name || 'Request');
  req.method = (r.method || 'GET').toUpperCase();
  req.url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
  req.params = paramsFromUrl(req.url);
  req.headers = pmKV(r.header);
  req.auth = pmAuthIn(r.auth);
  req.docs = pmDesc(r.description) || pmDesc(it.description);
  req.scripts = pmScriptsIn(it.event);
  const b = r.body;
  if (b?.mode === 'raw') {
    const lang = b.options?.raw?.language;
    const isJson = lang === 'json' || tryJson(b.raw) !== undefined;
    req.body = { mode: isJson ? 'json' : 'raw', text: b.raw || '', form: [] };
  } else if (b?.mode === 'urlencoded') req.body = { mode: 'urlencoded', text: '', form: pmKV(b.urlencoded) };
  else if (b?.mode === 'graphql') req.body = { mode: 'json', text: JSON.stringify({ query: b.graphql?.query || '', variables: tryJson(b.graphql?.variables) ?? {} }, null, 2), form: [] };
  else if (b?.mode === 'formdata') req.body = { mode: 'urlencoded', text: '', form: pmKV((b.formdata || []).filter((f) => f.type !== 'file')) };
  return req;
}
function pmItemOut(it) {
  if (it.type === 'folder') {
    return {
      name: it.name, item: (it.items || []).map(pmItemOut),
      ...(it.docs ? { description: it.docs } : {}), ...pmScriptsOut(it.scripts),
      ...(pmAuthOut(it.auth) ? { auth: pmAuthOut(it.auth) } : {}),
    };
  }
  const b = it.body || {};
  const body = b.mode === 'json' ? { mode: 'raw', raw: b.text || '', options: { raw: { language: 'json' } } }
    : b.mode === 'raw' ? { mode: 'raw', raw: b.text || '' }
      : b.mode === 'urlencoded' ? { mode: 'urlencoded', urlencoded: (b.form || []).map((f) => ({ key: f.key, value: f.value, ...(f.enabled === false ? { disabled: true } : {}) })) }
        : undefined;
  return {
    name: it.name,
    ...pmScriptsOut(it.scripts),
    request: {
      ...(it.docs ? { description: it.docs } : {}),
      method: it.method,
      header: (it.headers || []).map((h) => ({ key: h.key, value: h.value, ...(h.enabled === false ? { disabled: true } : {}) })),
      url: { raw: it.url },
      ...(body ? { body } : {}),
      ...(pmAuthOut(it.auth) ? { auth: pmAuthOut(it.auth) } : {}),
    },
  };
}
function toPostman(col) {
  return {
    info: { name: col.name, _postman_id: col.id, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', ...(col.docs ? { description: col.docs } : {}) },
    ...pmScriptsOut(col.scripts),
    item: (col.items || []).map(pmItemOut),
    variable: (col.vars || []).map((v) => ({ key: v.key, value: v.value, ...(v.enabled === false ? { disabled: true } : {}) })),
    ...(pmAuthOut(col.auth) ? { auth: pmAuthOut(col.auth) } : {}),
  };
}
function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function clImportFile(file) {
  if (!file) return;
  let j;
  try { j = JSON.parse(await file.text()); } catch { toast('Not a JSON file'); return; }
  if (j?.info && Array.isArray(j.item)) {
    const col = { id: uid(), type: 'collection', name: j.info.name || file.name.replace(/\.json$/i, ''), items: j.item.map(pmItemIn), vars: pmKV(j.variable), auth: pmAuthIn(j.auth), docs: pmDesc(j.info.description), scripts: pmScriptsIn(j.event) };
    C.ws.collections.push(col);
    C.expanded.add(col.id);
    saveExpanded();
    clPersist();
    renderTree();
    let n = 0;
    walk(col.items, (it) => { if (it.type === 'request') n++; });
    toast(`Imported “${col.name}” — ${n} request${n === 1 ? '' : 's'}`);
  } else if (Array.isArray(j?.values) && j.name) {
    const env = { id: uid(), name: j.name, vars: pmKV(j.values) };
    C.ws.environments.push(env);
    if (!C.ws.activeEnv) C.ws.activeEnv = env.id;
    clPersist();
    renderEnvSelect();
    toast(`Imported environment “${env.name}”`);
  } else toast('Not a Postman collection or environment (v2.1)');
}

// ---------- layout ----------
function clMount() {
  const main = document.querySelector('main');
  main.insertAdjacentHTML('beforeend', `
  <section class="card" id="clientCard">
    <aside class="cl-side">
      <div class="cl-side-h">
        <b>Collections</b>
        <button class="iconbtn" id="clNewReq" title="New request (⌘N)">+ Request</button>
        <button class="iconbtn" id="clMoreTop" title="New collection, import, export">⋯</button>
      </div>
      <div class="cl-env">
        <select id="clEnv" title="Environment"></select>
        <button class="iconbtn" id="clEnvEdit" title="Manage environments">Edit</button>
      </div>
      <div class="cl-tree" id="clTree"></div>
    </aside>
    <div class="cl-main" id="clMain"></div>
  </section>`);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fileInput.id = 'clFile';
  document.body.append(fileInput);
  fileInput.addEventListener('change', () => { clImportFile(fileInput.files[0]); fileInput.value = ''; });

  $('#clNewReq').addEventListener('click', () => clOpenDraft(blankRequest()));
  $('#clMoreTop').addEventListener('click', (ev) => clMenu(ev.currentTarget, [
    ['New collection', () => clNewCollection()],
    ['Import Postman collection / environment…', () => fileInput.click()],
    ['Paste a cURL command…', () => { clOpenDraft(blankRequest()); setTimeout(() => { const u = $('#clUrl'); u.placeholder = 'Paste a cURL command here…'; u.focus(); }, 0); }],
  ]));
  $('#clEnv').addEventListener('change', (ev) => {
    C.ws.activeEnv = ev.target.value || null;
    clPersist();
    renderResolved();
  });
  $('#clEnvEdit').addEventListener('click', () => openEnvModal());
  $('#clTree').addEventListener('click', onTreeClick);
  $('#clTree').addEventListener('contextmenu', (ev) => {
    const n = ev.target.closest('.cl-node');
    if (!n) return;
    ev.preventDefault();
    nodeMenu(n.dataset.id, { x: ev.clientX, y: ev.clientY });
  });
  $('#clTree').addEventListener('dblclick', (ev) => {
    const n = ev.target.closest('.cl-node');
    if (n && !ev.target.closest('.more')) startRename(n.dataset.id);
  });
  document.addEventListener('keydown', (ev) => {
    if (S.view !== 'client' || document.querySelector('.modal.open')) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); clSave(); }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); clSend(); }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'n') { ev.preventDefault(); clOpenDraft(blankRequest()); }
  });
}

// ---------- sidebar ----------
function renderEnvSelect() {
  const sel = $('#clEnv');
  sel.innerHTML = `<option value="">No environment</option>` + C.ws.environments.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  sel.value = C.ws.activeEnv || '';
}
const CHEV = '<svg width="9" height="9" viewBox="0 0 16 16"><path d="M5 3l6 5-6 5z" fill="currentColor"/></svg>';
const FOLDER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="color:var(--muted);flex:none"><path d="M3 7.5V18a2 2 0 002 2h14a2 2 0 002-2V9.5a2 2 0 00-2-2h-7L10 5H5a2 2 0 00-2 2.5z"/></svg>';
const BOX = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="color:var(--accent-text);flex:none"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/></svg>';
function renderTree() {
  const tree = $('#clTree');
  if (!C.ws.collections.length) {
    tree.innerHTML = `<div class="cl-empty">No collections yet.<br>Create one, import a Postman collection, or open any captured call with <b>Open in client</b> and save it.</div>`;
    return;
  }
  const node = (it, depth) => {
    const open = C.expanded.has(it.id);
    if (it.type === 'request') {
      return `<div class="cl-node ${C.openId === it.id ? 'on' : ''}" data-id="${esc(it.id)}"><span class="mb" style="color:${METHOD_COLOR[it.method] || 'var(--text-2)'}">${esc(it.method === 'DELETE' ? 'DEL' : it.method === 'OPTIONS' ? 'OPT' : it.method)}</span><span class="nm" title="${esc(it.name)}">${esc(it.name)}</span><button class="more" title="More">⋯</button></div>`;
    }
    const icon = it.type === 'folder' ? FOLDER : BOX;
    return `<div class="cl-node ${open ? 'open' : ''}" data-id="${esc(it.id)}" data-group="1"><span class="tw">${CHEV}</span>${icon}<span class="nm" title="${esc(it.name)}">${esc(it.name)}</span><button class="more" title="More">⋯</button></div>`
      + (open ? `<div class="cl-kids">${(it.items || []).map((x) => node(x, depth + 1)).join('') || '<div class="cl-empty" style="padding:6px 8px">Empty</div>'}</div>` : '');
  };
  tree.innerHTML = C.ws.collections.map((c) => node(c, 0)).join('');
}
function onTreeClick(ev) {
  const n = ev.target.closest('.cl-node');
  if (!n || n.querySelector('input.rn')) return;
  const id = n.dataset.id;
  if (ev.target.closest('.more')) { nodeMenu(id, ev.target.closest('.more')); return; }
  const f = findNode(id);
  if (!f) return;
  if (f.node.type === 'request') clOpenSaved(id);
  else {
    if (C.expanded.has(id)) C.expanded.delete(id); else C.expanded.add(id);
    saveExpanded();
    renderTree();
  }
}
function clMenu(anchor, items) {
  document.querySelector('.cl-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'cl-menu';
  m.innerHTML = items.map((x) => (x === '-' ? '<hr>' : `<button class="${x[2] || ''}">${esc(x[0])}</button>`)).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, right: anchor.x };
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.min(r.left, window.innerWidth - w - 10)}px`;
  m.style.top = `${Math.min(r.bottom + 4, window.innerHeight - h - 10)}px`;
  const acts = items.filter((x) => x !== '-');
  m.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => { m.remove(); acts[i][1](); }));
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) {
    if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off); }
  }), 0);
}
function nodeMenu(id, anchor) {
  const f = findNode(id);
  if (!f) return;
  const n = f.node;
  const isCol = !f.parent;
  if (n.type === 'request') {
    clMenu(anchor, [
      ['Open', () => clOpenSaved(id)],
      ['Rename', () => startRename(id)],
      ['Duplicate', () => duplicateNode(id)],
      ['Copy as cURL', () => { const b = buildRequest(n); copy(curlOf({ method: b.method, url: b.url, reqHeaders: b.headers, reqBody: b.body }), 'cURL'); }],
      '-',
      ['Delete', () => deleteNode(id), 'danger'],
    ]);
    return;
  }
  clMenu(anchor, [
    ['Add request', () => addChild(id, blankRequest())],
    ['Add folder', () => addChild(id, { id: uid(), type: 'folder', name: 'New folder', items: [] }, true)],
    ['Rename', () => startRename(id)],
    ['Auth for everything inside…', () => openGroupAuth(id)],
    ['Scripts…', () => openGroupScripts(id)],
    ['Docs…', () => openGroupDocs(id)],
    ...(isCol ? [['Collection variables…', () => openEnvModal({ collectionId: id })], ['Export as Postman v2.1', () => download(`${n.name.replace(/[^\w.-]+/g, '_')}.postman_collection.json`, toPostman(n))]] : []),
    '-',
    ['Delete', () => deleteNode(id), 'danger'],
  ]);
}
function clNewCollection() {
  const col = { id: uid(), type: 'collection', name: 'New collection', items: [], vars: [], auth: { type: 'none' } };
  C.ws.collections.push(col);
  C.expanded.add(col.id);
  saveExpanded();
  clPersist();
  renderTree();
  startRename(col.id);
  return col;
}
function addChild(parentId, child, rename) {
  const f = findNode(parentId);
  if (!f) return;
  (f.node.items ||= []).push(child);
  C.expanded.add(parentId);
  saveExpanded();
  clPersist();
  renderTree();
  if (child.type === 'request') clOpenSaved(child.id);
  if (rename) startRename(child.id);
}
function duplicateNode(id) {
  const f = findNode(id);
  if (!f?.parent) return;
  const copyOf = JSON.parse(JSON.stringify(f.node));
  const reid = (x) => { x.id = uid(); (x.items || []).forEach(reid); };
  reid(copyOf);
  copyOf.name = `${f.node.name} copy`;
  const list = f.parent.items;
  list.splice(list.indexOf(f.node) + 1, 0, copyOf);
  clPersist();
  renderTree();
}
function deleteNode(id) {
  const f = findNode(id);
  if (!f) return;
  let count = 0;
  walk([f.node], (it) => { if (it.type === 'request') count++; });
  const what = f.node.type === 'request' ? `request “${f.node.name}”` : `“${f.node.name}”${count ? ` and its ${count} request${count === 1 ? '' : 's'}` : ''}`;
  if (!confirm(`Delete ${what}?`)) return;
  if (!f.parent) C.ws.collections = C.ws.collections.filter((c) => c !== f.node);
  else f.parent.items = f.parent.items.filter((x) => x !== f.node);
  let openGone = false;
  walk([f.node], (it) => { if (it.id === C.openId) openGone = true; });
  if (openGone) { C.openId = null; C.dirty = true; }
  clPersist();
  renderTree();
  renderEditor();
}
function startRename(id) {
  const el = $(`#clTree .cl-node[data-id="${CSS.escape(id)}"] .nm`);
  const f = findNode(id);
  if (!el || !f) return;
  const inp = document.createElement('input');
  inp.className = 'rn';
  inp.value = f.node.name;
  el.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    if (ok && inp.value.trim()) {
      f.node.name = inp.value.trim();
      if (C.openId === id && C.draft) C.draft.name = f.node.name;
      clPersist();
    }
    renderTree();
    renderEditor(true);
  };
  inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}

// ---------- opening requests ----------
function confirmDiscard() {
  return !C.dirty || !C.draft || confirm('Discard unsaved changes to this request?');
}
function clOpenSaved(id) {
  if (C.openId === id) return;
  if (!confirmDiscard()) return;
  const f = findNode(id);
  if (!f) return;
  C.openId = id;
  C.draft = JSON.parse(JSON.stringify(f.node));
  C.dirty = false;
  C.resp = null;
  renderTree();
  renderEditor();
}
function clOpenDraft(req) {
  if (!confirmDiscard()) return;
  C.openId = null;
  C.draft = req;
  C.dirty = true;
  C.resp = null;
  C.tab = req.body?.mode && req.body.mode !== 'none' ? 'body' : 'params';
  renderTree();
  renderEditor();
  setTimeout(() => $('#clUrl')?.focus(), 0);
}
// From the Requests view: take a captured call into the client.
function openInClient(e) {
  if (!C.loaded) return;
  setView('client');
  clOpenDraft(fromEntry(e));
  toast('Opened as an unsaved request — ⌘S to save it to a collection');
}

// ---------- editor ----------
function kvTable(list, kind, withHead = true) {
  const rows = [...list, { key: '', value: '', enabled: true, _new: true }];
  return `<table class="kvt" data-kv="${kind}">${withHead ? '<tr><th></th><th>Key</th><th>Value</th><th></th></tr>' : ''}${rows.map((r, i) => `
    <tr class="${r.enabled === false ? 'off' : ''}" data-i="${i}">
      <td class="ck">${r._new ? '' : `<input type="checkbox" ${r.enabled !== false ? 'checked' : ''}>`}</td>
      <td><input type="text" data-f="key" value="${esc(r.key)}" placeholder="${r._new ? 'Add key' : ''}" spellcheck="false"></td>
      <td><input type="text" data-f="value" value="${esc(r.value)}" placeholder="${r._new ? 'value' : ''}" spellcheck="false"></td>
      <td class="rm">${r._new ? '' : '<button class="x2" title="Remove">✕</button>'}</td>
    </tr>`).join('')}</table>`;
}
function kvListFor(kind) {
  const d = C.draft;
  if (kind === 'params') return d.params;
  if (kind === 'headers') return d.headers;
  if (kind === 'form') return d.body.form;
  return [];
}
function renderEditor(keepFocus) {
  const box = $('#clMain');
  if (!box) return;
  const d = C.draft;
  if (!d) {
    box.innerHTML = `<div class="cl-blank"><div><b>Build and send API requests</b>Pick a saved request, start a new one, or bring in a captured call with <b>Open in client</b>.<br>
      <button class="btn" id="clBlankNew">New request</button><button class="btn ghost" id="clBlankImport">Import Postman collection</button></div></div>`;
    $('#clBlankNew').addEventListener('click', () => clOpenDraft(blankRequest()));
    $('#clBlankImport').addEventListener('click', () => $('#clFile').click());
    return;
  }
  const active = keepFocus ? document.activeElement : null;
  const focusSel = active?.id ? `#${active.id}` : null;
  const counts = {
    params: d.params.filter((p) => p.key && p.enabled !== false).length,
    headers: d.headers.filter((p) => p.key && p.enabled !== false).length,
  };
  const crumb = C.openId ? crumbOf(C.openId) : 'Unsaved';
  box.innerHTML = `
    <div class="cl-top">
      <div class="cl-name">
        <input id="clName" value="${esc(d.name)}" spellcheck="false" title="Request name">
        ${C.dirty ? '<span class="cl-dirty" title="Unsaved changes"></span>' : ''}
        <span class="crumb" title="${esc(crumb)}">${esc(crumb)}</span>
        <button class="iconbtn" id="clSaveBtn" title="Save (⌘S)">Save</button>
        <button class="iconbtn" id="clCurlBtn" title="Copy as cURL">cURL</button>
      </div>
      <div class="cl-urlrow">
        <select id="clMethod" style="color:${METHOD_COLOR[d.method] || 'var(--text)'}">${METHODS.map((m) => `<option ${m === d.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input id="clUrl" value="${esc(d.url)}" placeholder="https://api.example.com/v1/items  — or paste a cURL command" spellcheck="false" autocomplete="off">
        <button class="btn" id="clSendBtn" title="Send (⌘↵)">Send</button>
      </div>
      <div class="cl-resolved" id="clResolved"></div>
      <div class="cl-tabs" id="clTabs">
        ${[['params', 'Params', counts.params], ['headers', 'Headers', counts.headers], ['body', 'Body', d.body.mode !== 'none' ? '●' : ''], ['auth', 'Auth', d.auth?.type && !['none', 'inherit'].includes(d.auth.type) ? '●' : ''], ['scripts', 'Scripts', d.scripts?.pre?.trim() || d.scripts?.post?.trim() ? '●' : ''], ['docs', 'Docs', d.docs?.trim() ? '●' : '']]
    .map(([k, l, n]) => `<button class="tab ${C.tab === k ? 'on' : ''}" data-t="${k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}
      </div>
    </div>
    <div class="cl-split">
      <div class="cl-req ${['docs', 'scripts'].includes(C.tab) ? 'tall' : ''}" id="clReq">${reqPane()}</div>
      <div class="cl-resp" id="clResp"></div>
    </div>`;
  bindEditor();
  renderResolved();
  renderResponse();
  if (focusSel) { const el = $(focusSel); if (el) { el.focus(); if (el.setSelectionRange && typeof active.selectionStart === 'number') try { el.setSelectionRange(active.selectionStart, active.selectionEnd); } catch {} } }
}
const SNIPPETS = {
  pre: [
    ['Set a variable', "pm.environment.set('requestId', Date.now().toString());"],
    ['Add a header', "pm.request.headers.upsert({ key: 'X-Request-Id', value: pm.variables.replaceIn('{{requestId}}') });"],
    ['Timestamp', "pm.variables.set('now', new Date().toISOString());"],
    ['Log the request', 'console.log(pm.request.method, pm.request.url);'],
  ],
  post: [
    ['Status is 200', "pm.test('Status is 200', () => {\n  pm.response.to.have.status(200);\n});"],
    ['Fast response', "pm.test('Responds in under 1s', () => {\n  pm.expect(pm.response.responseTime).to.be.below(1000);\n});"],
    ['Save token', "const body = pm.response.json();\npm.environment.set('token', body.data?.token || body.token);"],
    ['Check a field', "pm.test('Has an id', () => {\n  pm.expect(pm.response.json()).to.have.property('id');\n});"],
    ['Log the body', 'console.log(pm.response.json());'],
  ],
};
function scriptsPane(sc, idPrefix) {
  const box = (phase, title, hint) => `<div><div class="lbl"><span>${title}</span><small>${hint}</small></div>
    <textarea class="sc-ta" id="${idPrefix}${phase}" spellcheck="false" placeholder="${phase === 'pre' ? '// runs before the request is sent' : '// runs after the response arrives'}">${esc(sc?.[phase] || '')}</textarea>
    <div class="sc-snips">${SNIPPETS[phase].map(([l], i) => `<button data-snip="${phase}:${i}">${esc(l)}</button>`).join('')}</div></div>`;
  return `<div class="sc-grid">${box('pre', 'Pre-request', 'change the request · set variables')}${box('post', 'Post-response', 'tests · save values from the response')}</div>
    <div class="cl-hint">Postman-compatible <code>pm</code> API: <code>pm.environment</code> / <code>pm.collectionVariables</code> / <code>pm.variables</code> get·set, <code>pm.request</code>, <code>pm.response.json()</code>, <code>pm.test()</code> + <code>pm.expect()</code>, <code>console.log</code>. Scripts run in an isolated sandbox. Collection and folder scripts (⋯ → Scripts…) run first.</div>`;
}
function bindScripts(root, sc, onChange, idPrefix) {
  for (const phase of ['pre', 'post']) {
    const ta = root.querySelector(`#${idPrefix}${phase}`);
    ta?.addEventListener('input', () => { sc[phase] = ta.value; onChange(); });
    ta?.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') { ev.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); sc[phase] = ta.value; onChange(); } });
  }
  root.querySelectorAll('[data-snip]').forEach((b) => b.addEventListener('click', () => {
    const [phase, i] = b.dataset.snip.split(':');
    const ta = root.querySelector(`#${idPrefix}${phase}`);
    const code = SNIPPETS[phase][Number(i)][1];
    ta.value = (ta.value.trim() ? `${ta.value.replace(/\s*$/, '')}\n\n` : '') + code + '\n';
    sc[phase] = ta.value;
    onChange();
    ta.focus();
  }));
}
function docsPane(text, mode, idPrefix, template) {
  return `<div class="docs-bar">
      <div class="segs"><button data-dm="write" class="${mode === 'write' ? 'on' : ''}">Write</button><button data-dm="preview" class="${mode === 'preview' ? 'on' : ''}">Preview</button></div>
      <span class="grow"></span>
      ${template ? '<button class="iconbtn" data-dtpl style="height:28px;font-size:12px">Insert template</button>' : ''}
    </div>
    ${mode === 'write'
    ? `<textarea class="cl-ta" id="${idPrefix}docs" spellcheck="true" style="min-height:220px" placeholder="# What this endpoint does\n\nMarkdown: **bold**, \`code\`, lists, tables, \`\`\`json code blocks\`\`\`, links…">${esc(text || '')}</textarea>
       <div class="cl-hint">Markdown. Saved with the request, and exported to Postman as its description.</div>`
    : `<div class="md">${text?.trim() ? mdRender(text) : '<div class="md-empty">No docs yet — switch to <b>Write</b>, or use <b>Insert template</b> to start from this request.</div>'}</div>`}`;
}
function reqPane() {
  const d = C.draft;
  if (C.tab === 'scripts') { d.scripts ||= { pre: '', post: '' }; return scriptsPane(d.scripts, 'clSc'); }
  if (C.tab === 'docs') return docsPane(d.docs, C.docsMode || (d.docs?.trim() ? 'preview' : 'write'), 'cl', true);
  if (C.tab === 'params') return kvTable(d.params, 'params') + '<div class="cl-hint">Editing here updates the URL, and the other way round. Use <code>{{name}}</code> for variables.</div>';
  if (C.tab === 'headers') return kvTable(d.headers, 'headers') + '<div class="cl-hint">Content-Type is added automatically for JSON and form bodies, and Authorization from the Auth tab.</div>';
  if (C.tab === 'body') {
    const m = d.body.mode;
    const radio = (v, l) => `<label><input type="radio" name="clBodyMode" value="${v}" ${m === v ? 'checked' : ''}>${l}</label>`;
    const editor = m === 'none' ? '<div class="cl-hint">This request has no body.</div>'
      : m === 'urlencoded' ? kvTable(d.body.form, 'form')
        : `<textarea class="cl-ta" id="clBodyText" spellcheck="false" placeholder="${m === 'json' ? '{\n  "key": "value"\n}' : ''}">${esc(d.body.text)}</textarea>`;
    return `<div class="cl-body-modes">${radio('none', 'None')}${radio('json', 'JSON')}${radio('raw', 'Raw text')}${radio('urlencoded', 'Form (x-www-form-urlencoded)')}<span class="grow"></span>${m === 'json' ? '<button class="iconbtn" id="clFmt" style="height:26px;font-size:12px">Format</button>' : ''}</div>${editor}`;
  }
  const a = d.auth || { type: 'inherit' };
  const inp = (f, ph, t = 'text') => `<input type="${t}" data-a="${f}" value="${esc(a[f] || '')}" placeholder="${ph}" spellcheck="false">`;
  return `<div class="cl-auth">
    <span>Type</span>
    <select id="clAuthType">${[['inherit', 'Inherit from folder / collection'], ['none', 'No auth'], ['bearer', 'Bearer token'], ['basic', 'Basic auth'], ['apikey', 'API key']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${a.type === 'bearer' ? `<span>Token</span>${inp('token', '{{token}}')}` : ''}
    ${a.type === 'basic' ? `<span>Username</span>${inp('username', '')}<span>Password</span>${inp('password', '', 'password')}` : ''}
    ${a.type === 'apikey' ? `<span>Key</span>${inp('key', 'X-API-Key')}<span>Value</span>${inp('value', '{{apiKey}}')}<span>Add to</span><select id="clAuthIn"><option value="header" ${a.in !== 'query' ? 'selected' : ''}>Header</option><option value="query" ${a.in === 'query' ? 'selected' : ''}>Query params</option></select>` : ''}
  </div>
  ${a.type === 'inherit' ? `<div class="cl-hint">Uses the auth set on the folder or collection (⋯ → Auth for everything inside). Currently: <b>${esc(effectiveAuthLabel())}</b>.</div>` : ''}
  <div class="cl-hint">Tip: keep secrets in an environment variable, e.g. token <code>{{token}}</code>, so they're not saved inside the request.</div>`;
}
function effectiveAuthLabel() {
  const a = effectiveAuth(C.draft);
  return { none: 'no auth', bearer: 'Bearer token', basic: 'Basic auth', apikey: 'API key' }[a.type] || 'no auth';
}
function markDirty() {
  if (!C.dirty) {
    C.dirty = true;
    const nm = $('.cl-name');
    if (nm && !nm.querySelector('.cl-dirty')) $('#clName').insertAdjacentHTML('afterend', '<span class="cl-dirty" title="Unsaved changes"></span>');
  }
}
function bindEditor() {
  const d = C.draft;
  $('#clName').addEventListener('input', (ev) => { d.name = ev.target.value; markDirty(); });
  $('#clMethod').addEventListener('change', (ev) => { d.method = ev.target.value; ev.target.style.color = METHOD_COLOR[d.method] || 'var(--text)'; markDirty(); });
  const url = $('#clUrl');
  url.addEventListener('input', () => {
    const v = url.value;
    if (/^\s*curl\s/i.test(v)) {
      const r = fromCurl(v);
      if (r) {
        Object.assign(d, { method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body, auth: r.auth });
        if (!C.openId || d.name === 'New request') d.name = r.name;
        markDirty();
        C.tab = r.body.mode !== 'none' ? 'body' : 'params';
        renderEditor();
        toast('Imported from cURL');
        return;
      }
    }
    d.url = v;
    d.params = paramsFromUrl(v);
    markDirty();
    if (C.tab === 'params') refreshReq();
    renderResolved();
    updateTabCounts();
  });
  url.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); clSend(); } });
  $('#clSendBtn').addEventListener('click', clSend);
  $('#clSaveBtn').addEventListener('click', clSave);
  $('#clCurlBtn').addEventListener('click', () => { const b = buildRequest(d); copy(curlOf({ method: b.method, url: b.url, reqHeaders: b.headers, reqBody: b.body }), 'cURL'); });
  $('#clTabs').addEventListener('click', (ev) => { const t = ev.target.closest('.tab'); if (!t) return; C.tab = t.dataset.t; renderEditor(); });
  bindReqPane();
}
function refreshReq() {
  const el = $('#clReq');
  if (!el) return;
  el.innerHTML = reqPane();
  bindReqPane();
}
function updateTabCounts() {
  const d = C.draft;
  const set = (k, n) => { const t = $(`#clTabs .tab[data-t="${k}"]`); if (t) t.innerHTML = `${t.textContent.replace(/\d+|●/g, '').trim()}${n ? `<span class="n">${n}</span>` : ''}`; };
  set('params', d.params.filter((p) => p.key && p.enabled !== false).length);
  set('headers', d.headers.filter((p) => p.key && p.enabled !== false).length);
}
function bindReqPane() {
  const d = C.draft;
  const pane = $('#clReq');
  const tabDot = (k, on) => { const t = $(`#clTabs .tab[data-t="${k}"]`); if (t) t.innerHTML = `${t.textContent.replace(/●/g, '').trim()}${on ? '<span class="n">●</span>' : ''}`; };
  if (C.tab === 'scripts') {
    bindScripts(pane, d.scripts, () => { markDirty(); tabDot('scripts', d.scripts.pre.trim() || d.scripts.post.trim()); }, 'clSc');
    return;
  }
  if (C.tab === 'docs') {
    pane.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', () => { C.docsMode = b.dataset.dm; refreshReq(); }));
    pane.querySelector('[data-dtpl]')?.addEventListener('click', () => {
      d.docs = (d.docs?.trim() ? `${d.docs.trim()}\n\n` : '') + docsTemplate(d);
      C.docsMode = 'write';
      markDirty();
      refreshReq();
      tabDot('docs', true);
    });
    const ta = $('#cldocs');
    ta?.addEventListener('input', () => { d.docs = ta.value; markDirty(); tabDot('docs', ta.value.trim()); });
    return;
  }
  pane.querySelectorAll('table.kvt').forEach((t) => {
    const kind = t.dataset.kv;
    t.addEventListener('input', (ev) => {
      const tr = ev.target.closest('tr[data-i]');
      if (!tr) return;
      const list = kvListFor(kind);
      const i = Number(tr.dataset.i);
      if (i >= list.length) {
        list.push({ key: '', value: '', enabled: true });
        tr.insertAdjacentHTML('afterend', kvTable([], kind, false).replace(/^<table[^>]*>|<\/table>$/g, '').replace('data-i="0"', `data-i="${list.length}"`));
        tr.querySelector('.ck').innerHTML = '<input type="checkbox" checked>';
        tr.querySelector('.rm').innerHTML = '<button class="x2" title="Remove">✕</button>';
        tr.querySelectorAll('input[type=text]').forEach((x) => { x.placeholder = ''; });
      }
      if (ev.target.type === 'checkbox') {
        list[i].enabled = ev.target.checked;
        tr.classList.toggle('off', !ev.target.checked);
      } else list[i][ev.target.dataset.f] = ev.target.value;
      afterKv(kind);
    });
    t.addEventListener('click', (ev) => {
      const b = ev.target.closest('.x2');
      if (!b) return;
      const i = Number(b.closest('tr').dataset.i);
      kvListFor(kind).splice(i, 1);
      afterKv(kind);
      refreshReq();
    });
  });
  pane.querySelectorAll('input[name=clBodyMode]').forEach((r) => r.addEventListener('change', () => {
    d.body.mode = r.value;
    if (r.value === 'json' && !d.body.text) d.body.text = '{\n  \n}';
    markDirty();
    refreshReq();
    const t = $('#clTabs .tab[data-t="body"]');
    if (t) t.innerHTML = `Body${d.body.mode !== 'none' ? '<span class="n">●</span>' : ''}`;
  }));
  const ta = $('#clBodyText');
  if (ta) {
    ta.addEventListener('input', () => { d.body.text = ta.value; markDirty(); renderResolved(); });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab') { ev.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); d.body.text = ta.value; }
    });
  }
  $('#clFmt')?.addEventListener('click', () => {
    const j = tryJson(subst(d.body.text, new Map()));
    if (j === undefined) { toast('Body is not valid JSON'); return; }
    d.body.text = JSON.stringify(j, null, 2);
    markDirty();
    refreshReq();
  });
  $('#clAuthType')?.addEventListener('change', (ev) => { d.auth = { ...d.auth, type: ev.target.value }; markDirty(); refreshReq(); });
  $('#clAuthIn')?.addEventListener('change', (ev) => { d.auth.in = ev.target.value; markDirty(); });
  pane.querySelectorAll('[data-a]').forEach((x) => x.addEventListener('input', () => { d.auth[x.dataset.a] = x.value; markDirty(); renderResolved(); }));
}
function afterKv(kind) {
  markDirty();
  if (kind === 'params') {
    C.draft.url = urlWithParams(C.draft.url, C.draft.params);
    const u = $('#clUrl');
    if (u) u.value = C.draft.url;
  }
  renderResolved();
  updateTabCounts();
}
function renderResolved() {
  const el = $('#clResolved');
  if (!el || !C.draft) return;
  const b = buildRequest(C.draft);
  const hasVars = /\{\{/.test(C.draft.url + JSON.stringify(C.draft.headers) + JSON.stringify(C.draft.auth) + (C.draft.body?.text || ''));
  if (!hasVars) { el.innerHTML = ''; return; }
  const miss = [...b.missing];
  const byScript = miss.length && scriptChain(C.draft, 'pre').length;
  el.innerHTML = `→ ${esc(b.url)}${miss.length ? ` <span class="miss">· not set${byScript ? ' yet' : ''}: ${miss.map((m) => `{{${esc(m)}}}`).join(', ')}${byScript ? ' (a pre-request script may set these)' : activeEnv() ? '' : ' (no environment selected)'}</span>` : ''}`;
  el.title = b.url;
}

// ---------- sending ----------
async function clSend() {
  const d = C.draft;
  if (!d) return;
  const btn = $('#clSendBtn');
  const busy = (t) => { const b = $('#clSendBtn'); if (b) { b.disabled = !!t; b.textContent = t || 'Send'; } };
  const col = C.openId ? findNode(C.openId)?.col : null;
  const run = { tests: [], logs: [], error: null };
  let locals = {};
  // The request as scripts see it: before {{variables}} are filled in, like Postman.
  let work = JSON.parse(JSON.stringify(d));
  const pre = scriptChain(d, 'pre');
  if (pre.length) {
    busy('Pre-request…');
    const b0 = buildRequest(work);
    const res = await Runner.run({
      phase: 'pre', name: d.name, scripts: pre, env: varsObj(activeEnv()?.vars), col: varsObj(col?.vars), locals,
      request: { method: work.method, url: work.url, headers: b0.headers.map(([k, v]) => [k, v]), body: b0.body },
    });
    run.tests.push(...(res.tests || []));
    run.logs.push(...(res.logs || []));
    applyVarChanges(res, col);
    locals = res.locals || {};
    if (res.error) { run.error = res.error; C.resp = { error: `Pre-request script failed — ${res.error}`, run }; C.rtab = 'console'; renderResponse(); busy(); return; }
    // Take the script's edits to method / URL / headers / body.
    const r = res.request;
    work.method = r.method;
    work.url = r.url;
    work.headers = r.headers.map(([key, value]) => ({ key, value, enabled: true }));
    work.auth = { type: 'none' }; // auth headers were already expanded into r.headers
    if (work.body.mode !== 'none' || r.body) work.body = { mode: 'raw', text: r.body || '', form: [] };
  }
  const b = buildRequest(work, locals);
  if (!b.url) { toast('Enter a URL'); $('#clUrl')?.focus(); busy(); return; }
  if (b.missing.size) toast(`Not set: ${[...b.missing].map((m) => `{{${m}}}`).join(', ')}`);
  busy('Sending…');
  try {
    const r = await (await fetch('/replay', { method: 'POST', body: JSON.stringify({ method: b.method, url: b.url, headers: b.headers, body: b.body }) })).json();
    if (!r.ok) { C.resp = { error: r.message, run }; renderResponse(); return; }
    C.resp = { entryId: r.id, sentAt: Date.now(), run };
    renderResponse();
    const t0 = Date.now();
    await new Promise((resolve) => {
      const tick = () => {
        const e = S.byId.get(r.id);
        if (e && e.state !== 'pending') return resolve();
        if (Date.now() - t0 > 65000) return resolve();
        setTimeout(tick, 80);
      };
      tick();
    });
    const e = S.byId.get(r.id);
    const post = scriptChain(d, 'post');
    if (post.length && e) {
      busy('Tests…');
      const res = await Runner.run({
        phase: 'post', name: d.name, scripts: post, env: varsObj(activeEnv()?.vars), col: varsObj(col?.vars), locals,
        request: { method: b.method, url: b.url, headers: b.headers, body: b.body },
        response: { code: e.status ?? 0, status: e.statusText || '', time: e.durationMs, size: e.size, headers: e.respHeaders, body: e.respBody || '' },
      });
      run.tests.push(...(res.tests || []));
      run.logs.push(...(res.logs || []));
      if (res.error) run.error = res.error;
      applyVarChanges(res, col);
      renderResolved();
    }
    if (run.tests.length && run.tests.some((t) => !t.pass)) C.rtab = 'tests';
    renderResponse();
  } catch (err) {
    C.resp = { error: err.message, run };
    renderResponse();
  } finally {
    busy();
  }
}
function renderResponse() {
  const box = $('#clResp');
  if (!box) return;
  const r = C.resp;
  if (!r) { box.innerHTML = '<div class="cl-blank"><div>Send the request to see the response here.<div class="cl-hint">⌘↵ send · ⌘S save · ⌘N new request</div></div></div>'; return; }
  if (r.error && !r.entryId) {
    const logs = r.run?.logs?.length ? `<div class="cons" style="margin-top:10px">${r.run.logs.map(([lv, t]) => `<div class="${lv}">${esc(t)}</div>`).join('')}</div>` : '';
    box.innerHTML = `<div class="cl-resp-b"><div class="banner err">${esc(r.error)}</div>${logs}</div>`;
    return;
  }
  const e = S.byId.get(r.entryId);
  if (!e || (e.state === 'pending' && e.status == null)) { box.innerHTML = '<div class="cl-blank"><div><span class="spin" style="display:inline-block;width:14px;height:14px"></span><br>Waiting for the response…</div></div>'; return; }
  const run = r.run || { tests: [], logs: [] };
  const passed = run.tests.filter((t) => t.pass).length;
  const tabs = [['body', 'Body'], ['preview', 'Preview'], ['headers', `Headers <span class="n">${e.respHeaders.length}</span>`]];
  if (run.tests.length) tabs.push(['tests', `Tests <span class="n" style="color:${passed === run.tests.length ? 'var(--ok)' : 'var(--err)'}">${passed}/${run.tests.length}</span>`]);
  if (run.logs.length || run.error) tabs.push(['console', `Console <span class="n">${run.logs.length}</span>`]);
  if (!tabs.some(([k]) => k === C.rtab)) C.rtab = 'body';
  let body = '';
  if (C.rtab === 'tests') body = run.tests.map((t) => `<div class="tst"><span class="b ${t.pass ? 'p' : 'f'}">${t.pass ? 'PASS' : 'FAIL'}</span><div>${esc(t.name)}${t.error ? `<div class="e">${esc(t.error)}</div>` : ''}</div></div>`).join('');
  else if (C.rtab === 'console') body = `<div class="cons">${run.logs.map(([lv, t]) => `<div class="${lv}">${esc(t)}</div>`).join('') || '<div class="note">Nothing logged</div>'}</div>${run.error ? `<div class="banner err" style="margin-top:10px">${esc(run.error)}</div>` : ''}`;
  else if (e.error) body = `<div class="banner err">${esc(e.error)}</div>`;
  else if (C.rtab === 'headers') body = e.respHeaders.length ? `<div class="kv">${e.respHeaders.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('')}</div>` : '<div class="note">No headers</div>';
  else if (!e.respBody) body = `<div class="note">${esc(e.respNote || 'Empty body')}</div>`;
  else {
    const j = tryJson(e.respBody);
    if (C.rtab === 'preview' && j !== undefined && typeof j === 'object') body = `<div class="code jt">${jsonNode(null, j, 0)}</div>`;
    else if (C.rtab === 'preview' && /html/.test(mimeOf(e))) body = `<iframe sandbox="" style="width:100%;height:60vh;border:1px solid var(--line);border-radius:9px;background:#fff" srcdoc="${esc(e.respBody)}"></iframe>`;
    else body = `<div class="code"><pre>${esc(j !== undefined ? JSON.stringify(j, null, 2) : e.respBody)}</pre></div>`;
  }
  box.innerHTML = `
    <div class="cl-resp-h">${statusPill(e)} <span>Time <b>${fmtTime(e.durationMs) || '—'}</b></span><span>Size <b>${fmtSize(e.size)}</b></span>
      <span class="grow" style="flex:1"></span>
      <div class="tabs" style="display:flex;gap:2px">${tabs.map(([k, l]) => `<button class="tab ${C.rtab === k ? 'on' : ''}" data-rt="${k}" style="padding:4px 9px 5px">${l}</button>`).join('')}</div>
      <button class="iconbtn" id="clCopyResp" style="height:26px;font-size:12px">Copy</button>
      <button class="iconbtn" id="clShowInList" style="height:26px;font-size:12px" title="Show this call in the Requests list">In Requests</button>
    </div>
    <div class="cl-resp-b">${body}</div>`;
  box.querySelectorAll('[data-rt]').forEach((b) => b.addEventListener('click', () => { C.rtab = b.dataset.rt; renderResponse(); }));
  $('#clCopyResp').addEventListener('click', () => { const j = tryJson(e.respBody); copy(j !== undefined ? JSON.stringify(j, null, 2) : e.respBody || '', 'Response'); });
  $('#clShowInList').addEventListener('click', () => { setView('requests'); S.scrollToEntry?.(e.id, 'center'); select(e.id); });
}

// ---------- saving ----------
let saveModal;
function clSave() {
  const d = C.draft;
  if (!d) return;
  if (C.openId) {
    const f = findNode(C.openId);
    if (f) {
      const keepId = f.node.id;
      Object.assign(f.node, JSON.parse(JSON.stringify(d)), { id: keepId });
      C.dirty = false;
      clPersist();
      renderTree();
      renderEditor(true);
      toast('Saved');
      return;
    }
  }
  // Unsaved draft: pick where it goes.
  if (!saveModal) {
    saveModal = fxModal('clSaveModal', 'Save request', `
      <div class="save-grid">
        <div class="field"><label for="svName">Name</label><input id="svName" spellcheck="false"></div>
        <div class="field"><label for="svWhere">Save to</label><select id="svWhere"></select></div>
        <div class="field" id="svNewColWrap" style="display:none"><label for="svNewCol">New collection name</label><input id="svNewCol" value="My collection"></div>
        <button class="btn" id="svGo">Save</button>
      </div>`);
    $('#svWhere').addEventListener('change', () => { $('#svNewColWrap').style.display = $('#svWhere').value === '__new' ? '' : 'none'; });
    $('#svGo').addEventListener('click', doSaveNew);
    saveModal.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') doSaveNew(); });
  }
  const opts = [];
  for (const col of C.ws.collections) {
    opts.push([col.id, col.name]);
    walk(col.items, (it) => {
      if (it.type !== 'folder') return true;
      opts.push([it.id, `${col.name} / ${crumbOf(it.id).split(' / ').slice(1).concat(it.name).join(' / ')}`]);
      return true;
    });
  }
  $('#svWhere').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') + '<option value="__new">+ New collection…</option>';
  if (!opts.length) $('#svWhere').value = '__new';
  $('#svNewColWrap').style.display = $('#svWhere').value === '__new' ? '' : 'none';
  $('#svName').value = d.name;
  saveModal.classList.add('open');
  setTimeout(() => $('#svName').select(), 0);
}
function doSaveNew() {
  const d = C.draft;
  let parentId = $('#svWhere').value;
  if (parentId === '__new') {
    const col = { id: uid(), type: 'collection', name: $('#svNewCol').value.trim() || 'My collection', items: [], vars: [], auth: { type: 'none' } };
    C.ws.collections.push(col);
    parentId = col.id;
  }
  const f = findNode(parentId);
  if (!f) return;
  d.name = $('#svName').value.trim() || d.name;
  const node = JSON.parse(JSON.stringify(d));
  node.id = uid();
  (f.node.items ||= []).push(node);
  C.expanded.add(f.col.id);
  C.expanded.add(parentId);
  saveExpanded();
  C.openId = node.id;
  C.draft = JSON.parse(JSON.stringify(node));
  C.dirty = false;
  clPersist();
  saveModal.classList.remove('open');
  renderTree();
  renderEditor();
  toast(`Saved to ${f.node.name}`);
}

// ---------- folder / collection auth ----------
let gAuthModal;
function openGroupAuth(id) {
  const f = findNode(id);
  if (!f) return;
  if (!gAuthModal) {
    gAuthModal = fxModal('clAuthModal', 'Auth for everything inside', `
      <div class="cl-auth" id="gaBox"></div>
      <div class="cl-hint">Requests set to <b>Inherit</b> use this. Use a variable like <code>{{token}}</code> and set it per environment.</div>
      <div class="fx-row"><span class="grow"></span><button class="btn" id="gaSave">Save</button></div>`);
  }
  const a = { type: f.parent ? 'inherit' : 'none', ...(f.node.auth || {}) };
  const draw = () => {
    $('#gaBox').innerHTML = `<span>Type</span><select id="gaType">${[...(f.parent ? [['inherit', 'Inherit from parent']] : []), ['none', 'No auth'], ['bearer', 'Bearer token'], ['basic', 'Basic auth'], ['apikey', 'API key']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${a.type === 'bearer' ? `<span>Token</span><input data-g="token" value="${esc(a.token || '')}" placeholder="{{token}}">` : ''}
      ${a.type === 'basic' ? `<span>Username</span><input data-g="username" value="${esc(a.username || '')}"><span>Password</span><input type="password" data-g="password" value="${esc(a.password || '')}">` : ''}
      ${a.type === 'apikey' ? `<span>Key</span><input data-g="key" value="${esc(a.key || '')}" placeholder="X-API-Key"><span>Value</span><input data-g="value" value="${esc(a.value || '')}"><span>Add to</span><select data-g="in"><option value="header" ${a.in !== 'query' ? 'selected' : ''}>Header</option><option value="query" ${a.in === 'query' ? 'selected' : ''}>Query params</option></select>` : ''}`;
    $('#gaType').addEventListener('change', (ev) => { a.type = ev.target.value; draw(); });
    $('#gaBox').querySelectorAll('[data-g]').forEach((x) => x.addEventListener('input', () => { a[x.dataset.g] = x.value; }));
  };
  draw();
  $('#gaSave').onclick = () => {
    f.node.auth = { ...a };
    clPersist();
    gAuthModal.classList.remove('open');
    if (C.draft) refreshReq();
    renderResolved();
    toast('Auth saved');
  };
  gAuthModal.classList.add('open');
}

// ---------- environments (and collection variables) ----------
let envModal;
let envSel = null;
function openEnvModal({ collectionId } = {}) {
  if (!envModal) {
    envModal = fxModal('clEnvModal', 'Environments', `<div class="env-grid"><div class="env-list" id="envList"></div><div id="envEdit"></div></div>`);
  }
  envModal.querySelector('h2').textContent = collectionId ? 'Collection variables' : 'Environments';
  envModal.dataset.col = collectionId || '';
  envSel = collectionId ? null : (envSel && C.ws.environments.some((e) => e.id === envSel) ? envSel : C.ws.activeEnv || C.ws.environments[0]?.id || null);
  drawEnv();
  envModal.classList.add('open');
}
function drawEnv() {
  const colId = envModal.dataset.col;
  const list = $('#envList');
  const edit = $('#envEdit');
  if (colId) {
    const col = findNode(colId)?.node;
    if (!col) return;
    list.style.display = 'none';
    envModal.querySelector('.env-grid').style.gridTemplateColumns = '1fr';
    col.vars ||= [];
    edit.innerHTML = `<div class="cl-hint" style="margin:0 0 10px">Variables for <b>${esc(col.name)}</b>. An environment's value wins over these.</div>${kvTable(col.vars, 'vars')}`;
    bindVarTable(edit, col.vars);
    return;
  }
  list.style.display = '';
  envModal.querySelector('.env-grid').style.gridTemplateColumns = '';
  list.innerHTML = C.ws.environments.map((e) => `<button class="e ${e.id === envSel ? 'on' : ''}" data-e="${esc(e.id)}">${esc(e.name)}${e.id === C.ws.activeEnv ? '<span class="act">active</span>' : ''}</button>`).join('')
    + `<button class="iconbtn" id="envAdd" style="margin-top:6px">+ New environment</button><button class="iconbtn" id="envImport" style="margin-top:4px">Import…</button>`;
  list.querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => { envSel = b.dataset.e; drawEnv(); }));
  $('#envAdd').addEventListener('click', () => {
    const env = { id: uid(), name: C.ws.environments.length ? 'New environment' : 'dev', vars: [{ key: 'baseUrl', value: 'https://', enabled: true }, { key: 'token', value: '', enabled: true }] };
    C.ws.environments.push(env);
    if (!C.ws.activeEnv) C.ws.activeEnv = env.id;
    envSel = env.id;
    clPersist();
    renderEnvSelect();
    drawEnv();
  });
  $('#envImport').addEventListener('click', () => $('#clFile').click());
  const env = C.ws.environments.find((e) => e.id === envSel);
  if (!env) { edit.innerHTML = '<div class="cl-empty">Create an environment (for example <b>dev</b> and <b>prod</b>) holding values like <code>baseUrl</code> and <code>token</code>, then use them as <code>{{baseUrl}}</code> in requests.</div>'; return; }
  edit.innerHTML = `
    <div class="fx-row" style="margin:0 0 10px">
      <input id="envName" value="${esc(env.name)}" style="flex:1;height:32px;font:600 13px var(--sans);color:var(--text);background:var(--surface-2);border:1px solid var(--line);border-radius:7px;padding:0 9px;outline:none">
      ${env.id === C.ws.activeEnv ? '<span class="note">Active</span>' : '<button class="iconbtn" id="envUse">Use</button>'}
      <button class="iconbtn" id="envExport" title="Export as Postman environment">Export</button>
      <button class="iconbtn" id="envDel" style="color:var(--err)">Delete</button>
    </div>
    ${kvTable(env.vars, 'vars')}`;
  $('#envName').addEventListener('input', (ev) => { env.name = ev.target.value; clPersist(); renderEnvSelect(); list.querySelector(`[data-e="${CSS.escape(env.id)}"]`).firstChild.textContent = env.name; });
  $('#envUse')?.addEventListener('click', () => { C.ws.activeEnv = env.id; clPersist(); renderEnvSelect(); renderResolved(); drawEnv(); });
  $('#envExport').addEventListener('click', () => download(`${env.name.replace(/[^\w.-]+/g, '_')}.postman_environment.json`, { name: env.name, values: env.vars.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled !== false })), _postman_variable_scope: 'environment' }));
  $('#envDel').addEventListener('click', () => {
    if (!confirm(`Delete environment “${env.name}”?`)) return;
    C.ws.environments = C.ws.environments.filter((e) => e !== env);
    if (C.ws.activeEnv === env.id) C.ws.activeEnv = C.ws.environments[0]?.id || null;
    envSel = C.ws.activeEnv;
    clPersist();
    renderEnvSelect();
    renderResolved();
    drawEnv();
  });
  bindVarTable(edit, env.vars);
}
function bindVarTable(root, vars) {
  const t = root.querySelector('table.kvt');
  const redraw = () => { t.outerHTML = kvTable(vars, 'vars'); bindVarTable(root, vars); };
  t.addEventListener('input', (ev) => {
    const tr = ev.target.closest('tr[data-i]');
    const i = Number(tr.dataset.i);
    const isNew = i >= vars.length;
    if (isNew) vars.push({ key: '', value: '', enabled: true });
    if (ev.target.type === 'checkbox') vars[i].enabled = ev.target.checked;
    else vars[i][ev.target.dataset.f] = ev.target.value;
    clPersist();
    renderResolved();
    if (isNew) {
      const f = ev.target.dataset.f;
      const pos = ev.target.selectionStart;
      redraw();
      const el = root.querySelector(`tr[data-i="${i}"] input[data-f="${f}"]`);
      el?.focus();
      try { el?.setSelectionRange(pos, pos); } catch {}
    }
  });
  t.addEventListener('click', (ev) => {
    const b = ev.target.closest('.x2');
    if (!b) return;
    vars.splice(Number(b.closest('tr').dataset.i), 1);
    clPersist();
    renderResolved();
    redraw();
  });
}

// ---------- boot ----------
async function initClient() {
  try { C.expanded = new Set(JSON.parse(store.get('cl.expanded') || '[]')); } catch {}
  clMount();
  await clLoad();
  renderEnvSelect();
  renderTree();
  renderEditor();
}

// ---------- Markdown (docs) ----------
// Small, safe renderer: everything is escaped first, then a known subset is turned into HTML.
function mdInline(t) {
  return t
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
function mdRender(src) {
  const lines = esc(String(src || '')).split('\n');
  let out = '';
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out += `<p>${mdInline(para.join(' '))}</p>`; para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^```\s*([\w-]*)\s*$/))) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out += `<pre class="md-code"${m[1] ? ` data-lang="${m[1]}"` : ''}><code>${code.join('\n')}</code></pre>`;
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flush(); out += `<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }
    if (/^&gt;\s?/.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^&gt;\s?/, ''));
      out += `<blockquote>${mdInline(q.join(' '))}</blockquote>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flush();
      const row = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(c.trim()));
      const head = row(l);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body += `<tr>${row(lines[i++]).map((c) => `<td>${c}</td>`).join('')}</tr>`;
      out += `<table class="md-table"><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
        const task = m[2].match(/^\[( |x)\]\s+(.*)$/i);
        items.push(task ? `<li class="task"><span class="${task[1].trim() ? 'done' : ''}">${task[1].trim() ? '☑' : '☐'}</span> ${mdInline(task[2])}</li>` : `<li>${mdInline(m[2])}</li>`);
        i++;
      }
      out += ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`;
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l);
    i++;
  }
  flush();
  return out;
}

// A starting point for a request's docs, built from the request and its last response.
function docsTemplate(d) {
  const b = buildRequest(d);
  let u;
  try { u = new URL(b.url); } catch {}
  const lines = [`# ${d.name}`, '', 'Describe what this endpoint does, who calls it and when.', '', `**${d.method}** \`${d.url}\``, ''];
  const params = d.params.filter((p) => p.key);
  if (params.length) {
    lines.push('## Query parameters', '', '| Name | Example | Description |', '|---|---|---|');
    for (const p of params) lines.push(`| \`${p.key}\` | \`${p.value}\` | |`);
    lines.push('');
  }
  const hs = d.headers.filter((h) => h.key && h.enabled !== false);
  if (hs.length || (d.auth && !['none', 'inherit'].includes(d.auth.type))) {
    lines.push('## Headers', '', '| Name | Value | Description |', '|---|---|---|');
    if (d.auth?.type === 'bearer') lines.push('| `Authorization` | `Bearer <token>` | Required |');
    for (const h of hs) lines.push(`| \`${h.key}\` | \`${/authorization|token|secret|key/i.test(h.key) ? '<hidden>' : h.value}\` | |`);
    lines.push('');
  }
  if (d.body?.mode === 'json' && d.body.text?.trim()) lines.push('## Request body', '', '```json', d.body.text.trim(), '```', '');
  const e = C.resp?.entryId ? S.byId.get(C.resp.entryId) : null;
  if (e && e.status != null) {
    const j = tryJson(e.respBody);
    lines.push(`## Response — ${e.status}`, '');
    if (j !== undefined) lines.push('```json', JSON.stringify(j, null, 2).split('\n').slice(0, 60).join('\n'), '```', '');
  }
  lines.push('## Notes', '', '- ');
  if (u) lines.splice(5, 0, `Host: \`${u.host}\``, '');
  return lines.join('\n');
}

// ---------- scripts (Postman-style pre-request / post-response) ----------
// Scripts run inside a sandboxed iframe (no same-origin): they can't read Netscope's page,
// cookies or local server. They get copies of the variables and request, and send back the
// changes, test results and console output.
const RUNNER_SRC = `<!doctype html><meta charset="utf-8"><script>
const mkVars = (obj, log) => ({
  get: (k) => (k in obj ? obj[k] : undefined),
  has: (k) => k in obj,
  set: (k, v) => { obj[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); log.push(['set', k]); },
  unset: (k) => { delete obj[k]; log.push(['unset', k]); },
  clear: () => { for (const k of Object.keys(obj)) delete obj[k]; },
  toObject: () => ({ ...obj }),
  replaceIn: (s) => String(s).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (a, k) => (k in obj ? obj[k] : a)),
});
function expect(actual) {
  let neg = false;
  const fail = (msg) => { throw new Error(msg); };
  const show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
  const check = (ok, msg) => { if (ok === neg) fail((neg ? 'expected not: ' : 'expected: ') + msg); return api; };
  const deepEq = (a, b) => show(a) === show(b);
  const api = {};
  const chain = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'deep'];
  for (const w of chain) Object.defineProperty(api, w, { get: () => api });
  Object.defineProperty(api, 'not', { get: () => { neg = !neg; return api; } });
  Object.defineProperty(api, 'ok', { get: () => check(!!actual, show(actual) + ' to be truthy') });
  Object.defineProperty(api, 'true', { get: () => check(actual === true, show(actual) + ' to be true') });
  Object.defineProperty(api, 'false', { get: () => check(actual === false, show(actual) + ' to be false') });
  Object.defineProperty(api, 'null', { get: () => check(actual === null, show(actual) + ' to be null') });
  Object.defineProperty(api, 'undefined', { get: () => check(actual === undefined, show(actual) + ' to be undefined') });
  Object.defineProperty(api, 'exist', { get: () => check(actual != null, show(actual) + ' to exist') });
  Object.defineProperty(api, 'empty', { get: () => check(actual != null && (actual.length === 0 || (typeof actual === 'object' && !Object.keys(actual).length)), show(actual) + ' to be empty') });
  api.equal = api.equals = api.eq = (v) => check(actual === v, show(actual) + ' to equal ' + show(v));
  api.eql = (v) => check(deepEq(actual, v), show(actual) + ' to deeply equal ' + show(v));
  api.above = api.gt = (n) => check(actual > n, show(actual) + ' to be above ' + n);
  api.below = api.lt = (n) => check(actual < n, show(actual) + ' to be below ' + n);
  api.least = api.gte = (n) => check(actual >= n, show(actual) + ' to be at least ' + n);
  api.most = api.lte = (n) => check(actual <= n, show(actual) + ' to be at most ' + n);
  api.oneOf = (list) => check(list.includes(actual), show(actual) + ' to be one of ' + show(list));
  api.a = api.an = (t) => check(t === 'array' ? Array.isArray(actual) : t === 'null' ? actual === null : typeof actual === t, show(actual) + ' to be a ' + t);
  api.include = api.includes = api.contain = api.contains = (v) => check(typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.some((x) => deepEq(x, v)) : actual && typeof v === 'object' ? Object.entries(v).every(([k, x]) => deepEq(actual[k], x)) : false, show(actual) + ' to include ' + show(v));
  api.property = (k, ...rest) => { const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), k); check(has && (!rest.length || deepEq(actual[k], rest[0])), show(actual) + ' to have property ' + show(k) + (rest.length ? ' = ' + show(rest[0]) : '')); return api; };
  api.length = api.lengthOf = (n) => check(actual != null && actual.length === n, show(actual) + ' to have length ' + n);
  api.match = (re) => check(re.test(String(actual)), show(actual) + ' to match ' + re);
  api.status = (code) => check(actual && actual.code === code, 'status ' + (actual && actual.code) + ' to be ' + code);
  api.header = (name, val) => check(actual && actual.headers && actual.headers.has(name) && (val === undefined || actual.headers.get(name) === val), 'response to have header ' + name);
  api.jsonBody = (k) => { const j = actual && actual.json && actual.json(); return check(j != null && (k === undefined || k in j), 'response JSON to have ' + k); };
  return api;
}
window.addEventListener('message', async (ev) => {
  const job = ev.data || {};
  if (job.kind !== 'run') return;
  const logs = [];
  const tests = [];
  const env = { ...job.env };
  const col = { ...job.col };
  const locals = { ...job.locals };
  const changes = { env: [], col: [], locals: [] };
  const req = job.request;
  const hdr = (list) => ({
    get: (n) => { const h = list.find(([k]) => k.toLowerCase() === String(n).toLowerCase()); return h ? h[1] : undefined; },
    has: (n) => list.some(([k]) => k.toLowerCase() === String(n).toLowerCase()),
    add: (h) => { list.push([h.key, String(h.value)]); },
    upsert: (h) => { const i = list.findIndex(([k]) => k.toLowerCase() === String(h.key).toLowerCase()); if (i >= 0) list[i][1] = String(h.value); else list.push([h.key, String(h.value)]); },
    remove: (n) => { for (let i = list.length - 1; i >= 0; i--) if (list[i][0].toLowerCase() === String(n).toLowerCase()) list.splice(i, 1); },
    toObject: () => Object.fromEntries(list),
    each: (fn) => list.forEach(([key, value]) => fn({ key, value })),
  });
  const request = {
    get url() { return req.url; }, set url(v) { req.url = String(v); },
    get method() { return req.method; }, set method(v) { req.method = String(v).toUpperCase(); },
    headers: hdr(req.headers),
    body: { get raw() { return req.body; }, set raw(v) { req.body = typeof v === 'string' ? v : JSON.stringify(v); }, update(v) { req.body = typeof v === 'string' ? v : JSON.stringify(v); } },
  };
  const r = job.response;
  const response = r && {
    code: r.code, status: r.status, responseTime: r.time, responseSize: r.size,
    headers: hdr(r.headers),
    text: () => r.body,
    json: () => JSON.parse(r.body),
    to: { have: { status: (c) => { if (r.code !== c) throw new Error('expected status ' + c + ', got ' + r.code); } } },
  };
  const envApi = mkVars(env, changes.env);
  const colApi = mkVars(col, changes.col);
  const localApi = mkVars(locals, changes.locals);
  const pm = {
    environment: envApi,
    collectionVariables: colApi,
    globals: envApi,
    variables: { ...localApi, get: (k) => (k in locals ? locals[k] : k in env ? env[k] : col[k]), has: (k) => k in locals || k in env || k in col, replaceIn: (s) => String(s).replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (a, k) => (k in locals ? locals[k] : k in env ? env[k] : k in col ? col[k] : a)) },
    request,
    response,
    info: { requestName: job.name, eventName: job.phase === 'pre' ? 'prerequest' : 'test' },
    test: (name, fn) => {
      try { const p = fn(); if (p && p.then) throw new Error('async tests are not supported'); tests.push({ name, pass: true }); } catch (e) { tests.push({ name, pass: false, error: String(e && e.message || e) }); }
    },
    expect,
    sendRequest: () => { throw new Error('pm.sendRequest is not supported yet'); },
  };
  const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ');
  const cons = { log: (...a) => logs.push(['log', fmt(a)]), info: (...a) => logs.push(['info', fmt(a)]), warn: (...a) => logs.push(['warn', fmt(a)]), error: (...a) => logs.push(['error', fmt(a)]) };
  const postman = { setEnvironmentVariable: envApi.set, getEnvironmentVariable: envApi.get, clearEnvironmentVariable: envApi.unset, setGlobalVariable: envApi.set, getGlobalVariable: envApi.get };
  const legacyTests = {};
  let error = null;
  for (const s of job.scripts) {
    if (!s.code.trim()) continue;
    try {
      new Function('pm', 'console', 'postman', 'tests', 'responseBody', 'responseCode', s.code)(pm, cons, postman, legacyTests, r ? r.body : undefined, r ? { code: r.code } : undefined);
    } catch (e) {
      error = (s.where ? s.where + ': ' : '') + String(e && e.message || e);
      logs.push(['error', error]);
      break;
    }
  }
  for (const [name, pass] of Object.entries(legacyTests)) tests.push({ name, pass: !!pass });
  parent.postMessage({ kind: 'done', id: job.id, env, col, locals, changes, request: req, tests, logs, error }, '*');
});
<\/script>`;

const Runner = {
  frame: null,
  seq: 0,
  pending: new Map(),
  ensure() {
    if (this.frame) return;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts'); // no allow-same-origin: isolated from Netscope
    f.style.display = 'none';
    f.srcdoc = RUNNER_SRC;
    document.body.append(f);
    this.frame = f;
    this.ready = new Promise((r) => f.addEventListener('load', r, { once: true }));
    if (!this.listening) {
      this.listening = true;
      window.addEventListener('message', (ev) => {
        if (ev.source !== this.frame?.contentWindow) return;
        const m = ev.data || {};
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(m);
      });
    }
  },
  async run(job) {
    this.ensure();
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // A runaway script (e.g. an endless loop): throw the sandbox away and start fresh.
        this.pending.delete(id);
        this.frame.remove();
        this.frame = null;
        resolve({ error: 'Script timed out after 5 s', tests: [], logs: [['error', 'Script timed out after 5 s']], env: job.env, col: job.col, locals: job.locals, changes: { env: [], col: [], locals: [] }, request: job.request });
      }, 5000);
      this.pending.set(id, { resolve, timer });
      this.frame.contentWindow.postMessage({ ...job, kind: 'run', id }, '*');
    });
  },
};

// Scripts that apply to a request: collection first, then each folder, then the request itself.
function scriptChain(req, phase) {
  const out = [];
  const f = req.id ? findNode(req.id) : null;
  if (f) {
    const chain = [];
    let cur = f.parent;
    while (cur) {
      chain.unshift(cur);
      cur = cur.id === f.col.id ? null : findNode(cur.id)?.parent;
    }
    for (const n of chain) if (n.scripts?.[phase]) out.push({ where: n.name, code: n.scripts[phase] });
  }
  if (req.scripts?.[phase]) out.push({ where: 'this request', code: req.scripts[phase] });
  return out;
}
function varsObj(list) {
  const o = {};
  for (const v of list || []) if (v.enabled !== false && v.key) o[v.key] = v.value ?? '';
  return o;
}
// Write a script run's variable changes back into the environment / collection.
function applyVarChanges(res, col) {
  const env = activeEnv();
  const write = (list, changes, obj) => {
    for (const [op, k] of changes) {
      const i = list.findIndex((v) => v.key === k);
      if (op === 'unset') { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i].value = obj[k]; else list.push({ key: k, value: obj[k], enabled: true });
    }
  };
  let touched = false;
  if (res.changes?.env?.length) {
    if (env) { write(env.vars, res.changes.env, res.env); touched = true; } else toast('A script set an environment variable, but no environment is selected');
  }
  if (res.changes?.col?.length && col) { col.vars ||= []; write(col.vars, res.changes.col, res.col); touched = true; }
  if (touched) clPersist();
}

// ---------- collection / folder docs and scripts ----------
let gDocsModal;
function openGroupDocs(id) {
  const f = findNode(id);
  if (!f) return;
  if (!gDocsModal) gDocsModal = fxModal('clDocsModal', 'Docs', '<div id="gdBox"></div><div class="fx-row"><span class="grow"></span><button class="btn" id="gdSave">Save</button></div>');
  gDocsModal.querySelector('h2').textContent = `Docs — ${f.node.name}`;
  let text = f.node.docs || '';
  let mode = text.trim() ? 'preview' : 'write';
  const draw = () => {
    $('#gdBox').innerHTML = docsPane(text, mode, 'gd', false);
    $('#gdBox').querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.dm; draw(); }));
    $('#gddocs')?.addEventListener('input', (ev) => { text = ev.target.value; });
  };
  draw();
  $('#gdSave').onclick = () => { f.node.docs = text; clPersist(); gDocsModal.classList.remove('open'); toast('Docs saved'); };
  gDocsModal.classList.add('open');
}
let gScModal;
function openGroupScripts(id) {
  const f = findNode(id);
  if (!f) return;
  if (!gScModal) gScModal = fxModal('clScModal', 'Scripts', '<div id="gsBox"></div><div class="fx-row"><span class="grow"></span><button class="btn" id="gsSave">Save</button></div>');
  gScModal.querySelector('h2').textContent = `Scripts — ${f.node.name}`;
  const sc = { pre: f.node.scripts?.pre || '', post: f.node.scripts?.post || '' };
  $('#gsBox').innerHTML = scriptsPane(sc, 'gs').replace('Collection and folder scripts (⋯ → Scripts…) run first.', `These run for every request inside <b>${esc(f.node.name)}</b>, before the request's own scripts.`);
  bindScripts($('#gsBox'), sc, () => {}, 'gs');
  $('#gsSave').onclick = () => { f.node.scripts = sc; clPersist(); gScModal.classList.remove('open'); toast('Scripts saved'); };
  gScModal.classList.add('open');
}
