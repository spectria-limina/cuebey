import { parseTime, num, fmtHMS, trimNum, esc } from './format.js';

export const WARN_DEFAULT = 2;
export const TOKEN = /{([a-zA-Z0-9_|]+)(?::([^}]*))?}/g;

export const SEED_CSV =
`time,standby,warn,remain,type,text,set,options
0:00:00,,,,phase,— Pull · press Start —,,
0:00:12,8,3,2,call,Tankbuster — tank cooldowns,,
0:00:26,6,3,2,note,Grab the orb (top-left),,
0:00:44,10,4,3,call,Boss winds up — store side & tether,cleave;tether,left|right;near|far
0:01:04,6,3,2,call,"Cleave fires — move {cleave:left=right,right=left}",,
0:01:12,5,3,2,call,"{tether} tether resolves",,
0:01:18,6,3,8,call,"Go {cleave|tether:left|near=NE,left|far=SW,right|near=NW,right|far=SE,*=mid}",,
0:01:22,,2,1,call,Quick adjust — bait north,,
0:01:28,6,3,2,call,Stack middle,,
0:01:46,,,,phase,— Phase 2 · press GO at transition —,,
0:01:58,8,3,2,call,Spread for markers,,
0:02:12,6,3,2,call,Towers — your spot,,
0:02:26,8,4,3,call,"Knockback toward {cleave} wall",,
0:02:54,10,4,4,call,Raidwide — heal to full,,`;

function parseCSVText(text) {
  const rows = [];
  let row = [], field = '', inq = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inq) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inq = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inq = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function csvCell(v) {
  v = String(v == null ? '' : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function buildCues(csvText, offsetSec) {
  const rows = parseCSVText(csvText);
  const cues = [];
  const vars = {};
  const errs = [];
  let header = null, hi = {};

  rows.forEach((r, ri) => {
    const first = (r[0] || '').trim();
    if (!header) {
      if (first.toLowerCase() === 'time') {
        header = r.map(x => x.trim().toLowerCase());
        header.forEach((h, k) => (hi[h] = k));
        return;
      }
      header = ['time', 'type', 'text', 'set', 'options'];
      header.forEach((h, k) => (hi[h] = k));
    }
    if (!r.length || r.every(x => x.trim() === '')) return;
    if (first.startsWith('#')) return;
    const cell = name => (hi[name] != null ? r[hi[name]] || '' : '');
    const t = parseTime(cell('time').trim());
    if (t === null) { errs.push(ri + 1); return; }
    let type = cell('type').trim().toLowerCase();
    if (type === 'me' || type === 'self' || type === 'reminder') type = 'note';
    if (type === 'sync') type = 'phase';
    if (type !== 'note' && type !== 'phase') type = 'call';
    const text = cell('text').trim();
    const names = cell('set').trim().split(';').map(x => x.trim()).filter(Boolean);
    const groups = cell('options').split(';').map(g => g.split(/[|/]/).map(x => x.trim()).filter(Boolean));
    const sets = names.map((nm, k) => ({ name: nm, options: groups[k] || [] }));
    cues.push({
      raw: t,
      effTime: t - offsetSec,
      type,
      text,
      standby: num(cell('standby')),
      warn: num(cell('warn')),
      remain: num(cell('remain')),
      sets,
      skipped: false,
      _tok: /{[a-zA-Z0-9_|]/.test(text),
    });
  });

  cues.sort((a, b) => a.effTime - b.effTime);

  function ensure(n) {
    return vars[n] || (vars[n] = { name: n, options: [], value: null, first: Infinity, last: -Infinity, defIdx: -1, lastIdx: -1 });
  }
  cues.forEach((c, i) => {
    const ref = nm => {
      const v = ensure(nm);
      if (c.effTime < v.first) v.first = c.effTime;
      if (c.effTime > v.last || v.lastIdx < 0) { v.last = c.effTime; v.lastIdx = i; }
    };
    c.sets.forEach(s => {
      const v = ensure(s.name);
      if (!v.options.length && s.options.length) v.options = s.options.slice();
      if (v.defIdx < 0) v.defIdx = i;
      ref(s.name);
    });
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(c.text))) m[1].split('|').map(x => x.trim()).filter(Boolean).forEach(ref);
  });

  return { cues, vars, errs };
}

export function serializeCSV(cues) {
  let out = 'time,standby,warn,remain,type,text,set,options\n';
  cues.forEach(c => {
    const setStr = c.sets.map(s => s.name).join(';');
    const optStr = c.sets.map(s => s.options.join('|')).join(';');
    const n = v => (v == null ? '' : trimNum(v));
    out += [
      csvCell(fmtHMS(c.raw)),
      n(c.standby), n(c.warn), n(c.remain),
      csvCell(c.type === 'call' ? '' : c.type),
      csvCell(c.text),
      csvCell(setStr),
      csvCell(optStr),
    ].join(',') + '\n';
  });
  return out;
}

export function resolveToken(namesStr, mapStr, vars) {
  const names = namesStr.split('|').map(s => s.trim()).filter(Boolean);
  const vals = names.map(n => (vars[n] && vars[n].value != null) ? vars[n].value : null);
  let shown = null;
  if (mapStr != null) {
    let def = null, hit = null;
    mapStr.split(',').forEach(rule => {
      const eq = rule.indexOf('=');
      if (eq < 0) return;
      const pat = rule.slice(0, eq).trim(), out = rule.slice(eq + 1).trim();
      if (pat === '*') { if (def == null) def = out; return; }
      const parts = pat.split('|').map(s => s.trim());
      if (parts.length !== names.length) return;
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '*') continue;
        if (vals[i] == null || parts[i] !== vals[i]) { ok = false; break; }
      }
      if (ok && hit == null) hit = out;
    });
    shown = hit != null ? hit : (def != null ? def : (vals.every(v => v != null) ? vals.join(' ') : null));
  } else {
    shown = names.length === 1 ? vals[0] : (vals.every(v => v != null) ? vals.join(' ') : null);
  }
  return shown == null
    ? '<span class="vunset">' + esc(namesStr) + '?</span>'
    : '<span class="vval">' + esc(shown) + '</span>';
}

export function renderText(raw, vars) {
  let out = '', last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(raw))) {
    out += esc(raw.slice(last, m.index));
    out += resolveToken(m[1], m[2], vars);
    last = TOKEN.lastIndex;
  }
  out += esc(raw.slice(last));
  return out;
}
