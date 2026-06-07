import { parseTime, num, fmtHMS, trimNum, esc } from './format.js';

export const WARN_DEFAULT = 2;
export const TOKEN = /{([a-zA-Z0-9_|]+)(?::([^}]*))?}/g;

// Default timeline in TSV format (new column order)
export const SEED_CSV =
`time\ttype\ttext\tstandby\tready\tremain\tvars\tflags
0:00:00\tphase\t— Pull · press Start —\t\t\t\t\t
0:00:12\tcall\tTankbuster — tank cooldowns\t8\t3\t2\t\t
0:00:26\tnote\tGrab the orb (top-left)\t6\t3\t2\t\t
0:00:44\tcall\tBoss winds up — store side & tether\t10\t4\t3\t{cleave:left,right};{tether:near,far}\t
0:01:04\tcall\tCleave fires — move {cleave:left=right,right=left}\t6\t3\t2\t\t
0:01:12\tcall\t{tether} tether resolves\t5\t3\t2\t\t
0:01:18\tcall\tGo {cleave|tether:left|near=NE,left|far=SW,right|near=NW,right|far=SE,*=mid}\t6\t3\t8\t\t
0:01:22\tcall\tQuick adjust — bait north\t\t2\t1\t\t
0:01:28\tcall\tStack middle\t6\t3\t2\t\t
0:01:46\tphase\t— Phase 2 · press GO at transition —\t\t\t\t\t
0:01:58\tcall\tSpread for markers\t8\t3\t2\t\t
0:02:12\tcall\tTowers — your spot\t6\t3\t2\t\t
0:02:26\tcall\tKnockback toward {cleave} wall\t8\t4\t3\t\t
0:02:54\tcall\tRaidwide — heal to full\t10\t4\t4\t\t`;

// ── CSV parser (handles both CSV and TSV) ─────────────────────────────────────

function parseTSV(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    rows.push(line.split('\t'));
  }
  return rows;
}

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

function parseRows(text) {
  // Detect TSV by checking if the first non-empty, non-comment line has a tab
  const firstLine = text.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '';
  if (firstLine.includes('\t')) return parseTSV(text);
  return parseCSVText(text);
}

// ── Cell escaping for TSV output ──────────────────────────────────────────────

export function tsvCell(v) {
  // TSV doesn't support tabs in values — replace with space as a safe fallback
  return String(v == null ? '' : v).replace(/\t/g, ' ');
}

// Keep csvCell for any code still calling it (produces TSV-safe output too)
export function csvCell(v) { return tsvCell(v); }

// ── Variable set parsing ──────────────────────────────────────────────────────

// Parse the unified `vars` column (or legacy `set`+`options` columns).
// Syntax in vars column: {varname|Display Name:val=Label,val2=Label2,...}
// Semicolon-separates multiple variable definitions.
// Legacy set-only syntax: plain `varname` + pipe-separated options in optGroups.
export function parseSetsFromRaw(rawSet, rawOpts) {
  const entries = (rawSet || '').trim().split(';').map(x => x.trim()).filter(Boolean);
  const optGroups = (rawOpts || '').split(';');
  return entries.map((entry, k) => {
    // Inline syntax: {varname|Optional Display Name:val=Label,...}
    const m = entry.match(/^\{([a-zA-Z0-9_]+)(\|([^:}]+))?:([^}]*)\}$/);
    if (m) {
      const name = m[1];
      const displayLabel = m[3] ? m[3].trim() : name;
      const pairs = m[4].split(',').map(p => {
        // Handle escaped comma within a value: \, → comma
        const unescaped = p.replace(/\\,/g, '\x01');
        const eq = unescaped.indexOf('=');
        if (eq < 0) {
          const v = unescaped.trim().replace(/\x01/g, ',');
          return { value: v, label: v };
        }
        return {
          value: unescaped.slice(0, eq).trim().replace(/\x01/g, ','),
          label: unescaped.slice(eq + 1).trim().replace(/\x01/g, ','),
        };
      }).filter(p => p.value);
      return { name, displayLabel, options: pairs.map(p => p.value), labels: pairs.map(p => p.label) };
    }
    // Legacy plain syntax: varname in set column, pipe/slash-separated options in options column
    const opts = (optGroups[k] || '').split(/[|/]/).map(x => x.trim()).filter(Boolean);
    return { name: entry, displayLabel: entry, options: opts, labels: opts };
  });
}

// ── Flags parsing ─────────────────────────────────────────────────────────────

function parseFlags(flagsStr) {
  const flags = { disabled: false, syncPoint: false, castbarDuration: null };
  if (!flagsStr) return flags;
  for (const flag of flagsStr.split(',').map(f => f.trim()).filter(Boolean)) {
    if (flag === 'disabled') flags.disabled = true;
    else if (flag === 'sync') flags.syncPoint = true;
    else if (flag.startsWith('castbar=')) {
      const n = parseFloat(flag.slice(8));
      if (!isNaN(n) && n > 0) flags.castbarDuration = n;
    }
  }
  return flags;
}

// ── Build cues from text ──────────────────────────────────────────────────────

export function buildCues(csvText, offsetSec) {
  const rows = parseRows(csvText);
  const cues = [];
  const vars = {};
  const errs = [];
  let header = null, hi = {};

  rows.forEach((r, ri) => {
    const first = (r[0] || '').trim();
    if (!header) {
      if (first.toLowerCase() === 'time') {
        header = r.map(x => x.trim().toLowerCase());
        header.forEach((h, k) => { hi[h] = k; });
        return;
      }
      // No header row: assume new column order
      header = ['time', 'type', 'text', 'standby', 'ready', 'remain', 'vars', 'flags'];
      header.forEach((h, k) => { hi[h] = k; });
    }
    if (!r.length || r.every(x => x.trim() === '')) return;
    if (first.startsWith('#')) return;

    const cell = name => (hi[name] != null ? (r[hi[name]] || '') : '');
    const t = parseTime(cell('time').trim());
    if (t === null) { errs.push(ri + 1); return; }

    // Type: accept new names (event, cast) and map legacy names
    let rawType = cell('type').trim().toLowerCase();
    let isSyncLegacy = false;
    if (rawType === 'me' || rawType === 'self' || rawType === 'reminder') rawType = 'note';
    if (rawType === 'sync') { rawType = 'event'; isSyncLegacy = true; }
    if (!['call', 'note', 'phase', 'event', 'cast'].includes(rawType)) rawType = 'call';

    const text = cell('text').trim();

    // Accept `ready` or `warn` column for the warn/ready duration
    const warnRaw = cell('ready') || cell('warn');

    // Variable sets: prefer `vars` column, fall back to legacy `set`+`options`
    const varsCell = cell('vars').trim() || cell('set').trim();
    const optsCell = cell('options').trim();
    const sets = parseSetsFromRaw(varsCell, optsCell);

    // Flags
    const flags = parseFlags(cell('flags').trim());
    if (isSyncLegacy) flags.syncPoint = true;

    cues.push({
      raw: t,
      effTime: t - offsetSec,
      type: rawType,
      text,
      standby: num(cell('standby')),
      warn: num(warnRaw),
      remain: num(cell('remain')),
      sets,
      skipped: false,
      disabled: flags.disabled,
      syncPoint: flags.syncPoint,
      castbarDuration: flags.castbarDuration,
      _tok: /{[a-zA-Z0-9_|]/.test(text),
      varRefs: [], // populated below after all cues are built
    });
  });

  function ensure(n) {
    return vars[n] || (vars[n] = {
      name: n, label: n,
      options: [], labels: [], value: null,
      first: Infinity, last: -Infinity, defIdx: -1, lastIdx: -1,
    });
  }

  cues.forEach((c, i) => {
    const refSet = new Set();
    const ref = nm => {
      const v = ensure(nm);
      if (c.effTime < v.first) v.first = c.effTime;
      if (c.effTime > v.last || v.lastIdx < 0) { v.last = c.effTime; v.lastIdx = i; }
      refSet.add(nm);
    };
    c.sets.forEach(s => {
      const v = ensure(s.name);
      if (!v.options.length && s.options.length) {
        v.options = s.options.slice();
        v.labels = (s.labels || s.options).slice();
      }
      // Propagate display label from first definition that has one
      if (s.displayLabel && s.displayLabel !== s.name && v.label === v.name) {
        v.label = s.displayLabel;
      }
      if (v.defIdx < 0) v.defIdx = i;
      ref(s.name);
    });
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(c.text))) m[1].split('|').map(x => x.trim()).filter(Boolean).forEach(ref);
    c.varRefs = [...refSet];
  });

  return { cues, vars, errs };
}

// ── Serializer ────────────────────────────────────────────────────────────────

export function serializeVarsField(sets) {
  if (!sets || !sets.length) return '';
  return sets.map(s => {
    const hasDisplayLabel = s.displayLabel && s.displayLabel !== s.name;
    const hasCustomLabels = s.labels && s.labels.some((l, j) => l !== s.options[j]);
    const nameStr = hasDisplayLabel ? `${s.name}|${s.displayLabel}` : s.name;
    if (hasCustomLabels) {
      const inner = s.options.map((v, j) => {
        const l = s.labels[j];
        return (l === v) ? v : `${v}=${l}`;
      }).join(',');
      return `{${nameStr}:${inner}}`;
    }
    return `{${nameStr}:${s.options.join(',')}}`;
  }).join(';');
}

function serializeFlagsField(c) {
  const flags = [];
  if (c.disabled) flags.push('disabled');
  if (c.syncPoint) flags.push('sync');
  if (c.castbarDuration != null) flags.push('castbar=' + trimNum(c.castbarDuration));
  return flags.join(',');
}

export function serializeCSV(cues) {
  const cols = ['time', 'type', 'text', 'standby', 'ready', 'remain', 'vars', 'flags'];
  let out = cols.join('\t') + '\n';
  cues.forEach(c => {
    const n = v => (v == null ? '' : trimNum(v));
    out += [
      tsvCell(fmtHMS(c.raw)),
      tsvCell(c.type),
      tsvCell(c.text),
      n(c.standby),
      n(c.warn),
      n(c.remain),
      tsvCell(serializeVarsField(c.sets)),
      tsvCell(serializeFlagsField(c)),
    ].join('\t') + '\n';
  });
  return out;
}

// ── Token renderer ────────────────────────────────────────────────────────────

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
