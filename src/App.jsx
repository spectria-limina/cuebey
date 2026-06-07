import { useState, useEffect, useRef, useCallback } from 'react';
import { parseTime, fmtClock, fmtClean, trimNum } from './format.js';
import { buildCues, serializeCSV, renderText, SEED_CSV, WARN_DEFAULT } from './parser.js';
import Header from './components/Header.jsx';
import Timeline from './components/Timeline.jsx';
import Deck from './components/Deck.jsx';
import Variables from './components/Variables.jsx';

export default function App() {
  const [csvText, setCsvText] = useState(SEED_CSV);
  const [offsetText, setOffsetText] = useState('0:00:00');
  const [activeTab, setActiveTab] = useState('source');
  const [showTimeline, setShowTimeline] = useState(true);

  // Parsed data (rebuilt on csv/offset change)
  const [cues, setCues] = useState([]);
  const [vars, setVars] = useState({});
  const [parseStatus, setParseStatus] = useState({ ok: true, msg: 'Ready.' });
  const [metaText, setMetaText] = useState('—');

  // Engine structural state (affects button labels + layout class)
  const [engState, setEngState] = useState({ started: false, paused: false, phaseHold: false });

  // Engine timing (mutable refs, not React state — updated every frame)
  const eng = useRef({
    started: false, paused: false, phaseHold: false, phaseHoldIdx: -1,
    syncTime: 0, syncPerf: 0, frozenClock: 0, prevClock: -1e9,
    raf: 0, running: false,
  });

  // Animated DOM element refs (populated by child components via register callbacks)
  const clockDisplayRef = useRef(null);
  const cardRefs = useRef([]);    // per-cue: { slot, card, cd, bar, barwrap, stateEl, gbEl, textEl }
  const varRefs = useRef([]);     // per-var (ordered): { slot, card }
  const renderRowRefs = useRef([]); // per-cue: { row, textEl }
  const lastRenderCur = useRef(-2);

  // Keep latest cues/vars accessible in animation loop without stale closure
  const cuesRef = useRef([]);
  const varsRef = useRef({});

  // ── Parse & rebuild ──────────────────────────────────────────────────────
  useEffect(() => {
    const offsetSec = parseTime(offsetText) || 0;
    const { cues: newCues, vars: newVars, errs } = buildCues(csvText, offsetSec);

    // Preserve var values across re-parses
    Object.values(newVars).forEach(v => {
      const old = varsRef.current[v.name];
      if (old && old.value != null && v.options.includes(old.value)) v.value = old.value;
    });

    cuesRef.current = newCues;
    varsRef.current = newVars;
    setCues(newCues);
    setVars({ ...newVars });

    const last = newCues[newCues.length - 1];
    setMetaText(
      newCues.length + ' cue' + (newCues.length !== 1 ? 's' : '') +
      (last ? ' · ends ' + fmtClean(last.effTime) : '') +
      (offsetSec ? ' · −' + fmtClean(offsetSec) : '')
    );
    if (errs.length) {
      setParseStatus({ ok: false, msg: 'Bad time on row' + (errs.length > 1 ? 's' : '') + ' ' + errs.slice(0, 8).join(', ') + (errs.length > 8 ? '…' : '') });
    } else {
      setParseStatus({ ok: true, msg: newCues.length ? 'Parsed OK.' : 'Add rows, or Load a CSV.' });
    }

    lastRenderCur.current = -2;
    if (!eng.current.started) paintFrame(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText, offsetText]);

  // ── Engine helpers ────────────────────────────────────────────────────────
  function currentClock() {
    const e = eng.current;
    if (!e.started) return 0;
    if (e.paused || e.phaseHold) return e.frozenClock;
    return e.syncTime + (performance.now() - e.syncPerf) / 1000;
  }

  function syncEngState() {
    const e = eng.current;
    setEngState({ started: e.started, paused: e.paused, phaseHold: e.phaseHold });
  }

  function firstIdx() {
    const c = cuesRef.current;
    for (let i = 0; i < c.length; i++) if (!c[i].skipped) return i;
    return -1;
  }

  function start() {
    const e = eng.current;
    const wasActive = e.started;
    e.started = true; e.paused = false; e.phaseHold = false;
    e.syncTime = 0; e.syncPerf = performance.now(); e.frozenClock = 0;
    const c = cuesRef.current;
    e.prevClock = (c.length && c[0].type === 'phase') ? c[0].effTime : -1e9;
    syncEngState();
    if (!wasActive) kick();
  }

  function startAt(t) {
    const e = eng.current;
    const wasActive = e.started;
    e.started = true; e.paused = false; e.phaseHold = false;
    t = Math.max(0, t);
    e.syncTime = t; e.syncPerf = performance.now(); e.frozenClock = t; e.prevClock = t;
    syncEngState();
    if (!wasActive) kick();
  }

  function togglePause() {
    const e = eng.current;
    if (!e.started) { start(); return; }
    if (e.phaseHold) return;
    if (e.paused) {
      e.syncTime = e.frozenClock; e.syncPerf = performance.now(); e.paused = false;
    } else {
      e.frozenClock = currentClock(); e.paused = true;
    }
    syncEngState();
  }

  function goRelease() {
    const e = eng.current;
    if (e.phaseHold) {
      e.phaseHold = false; e.syncTime = e.frozenClock; e.syncPerf = performance.now(); e.prevClock = e.frozenClock;
      syncEngState();
    } else if (!e.started) {
      start();
    }
  }

  function nudge(d) {
    const e = eng.current;
    if (!e.started) return;
    if (e.paused || e.phaseHold) e.frozenClock += d;
    else e.syncTime += d;
    e.prevClock = currentClock();
  }

  function markDone(i) {
    const c = cuesRef.current[i];
    if (c) c.skipped = true;
  }

  function reset() {
    const e = eng.current;
    e.started = false; e.paused = false; e.phaseHold = false; e.phaseHoldIdx = -1;
    e.syncTime = 0; e.frozenClock = 0; e.prevClock = -1e9; e.running = false;
    cancelAnimationFrame(e.raf);
    cuesRef.current.forEach(c => (c.skipped = false));
    Object.values(varsRef.current).forEach(v => (v.value = null));
    lastRenderCur.current = -2;
    syncEngState();
    // Sync var React state
    setVars(v => {
      const next = { ...v };
      Object.values(next).forEach(vv => (vv.value = null));
      return next;
    });
    paintFrame(0);
  }

  function setVar(name, val) {
    const v = varsRef.current[name];
    if (!v) return;
    v.value = v.value === val ? null : val;
    setVars(prev => ({ ...prev, [name]: { ...prev[name], value: v.value } }));
  }

  function maybeSeek(i) {
    if (eng.current.started && !eng.current.paused && !eng.current.phaseHold) return;
    startAt(cuesRef.current[i].effTime - 5);
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  function advance() {
    const e = eng.current;
    if (!e.started) return;
    if (!e.paused && !e.phaseHold) {
      const c = e.syncTime + (performance.now() - e.syncPerf) / 1000;
      let hit = -1;
      const cues = cuesRef.current;
      for (let i = 0; i < cues.length; i++) {
        if (cues[i].type === 'phase' && !cues[i].skipped && cues[i].effTime > e.prevClock + 1e-6 && cues[i].effTime <= c) {
          hit = i; break;
        }
      }
      if (hit >= 0) {
        e.phaseHold = true; e.phaseHoldIdx = hit; e.frozenClock = cuesRef.current[hit].effTime;
        e.prevClock = e.frozenClock;
        syncEngState();
      } else {
        e.prevClock = c;
      }
    }
    paintFrame(currentClock());
  }

  function kick() {
    const e = eng.current;
    if (e.running) return;
    e.running = true;
    loop();
  }

  function loop() {
    const e = eng.current;
    if (!e.started) { e.running = false; return; }
    advance();
    e.raf = requestAnimationFrame(loop);
  }

  // ── Paint (imperative DOM updates, bypasses React) ────────────────────────
  function stateOf(i, clock) {
    const e = eng.current;
    const c = cuesRef.current[i];
    if (c.type === 'phase') {
      if (!e.started) return i === firstIdx() ? 'phase' : 'gray';
      if (e.phaseHold && e.phaseHoldIdx === i) return 'phase';
      if (c.skipped || clock > c.effTime + 1e-6) return 'retired';
      const t = c.effTime - clock, warn = c.warn ?? WARN_DEFAULT, sb = c.standby;
      if (t <= warn) return 'warn';
      if (sb != null && t <= sb) return 'standby';
      return 'gray';
    }
    if (c.skipped) return 'retired';
    if (!e.started) return 'gray';
    const t = c.effTime - clock, remain = c.remain ?? 0, warn = c.warn ?? WARN_DEFAULT, sb = c.standby;
    if (t <= 0 && t > -remain) return 'now';
    if (t <= 0) return 'retired';
    if (t <= warn) return 'warn';
    if (sb != null && t <= sb) return 'standby';
    return 'gray';
  }

  function varStateOf(v, clock) {
    if (!v.options.length) return 'gone';
    const last = cuesRef.current[v.lastIdx];
    if (last && clock >= last.effTime + (last.remain ?? 0)) return 'gone';
    const ds = v.defIdx >= 0 ? stateOf(v.defIdx, clock) : 'gray';
    if (ds === 'standby') return 'standby';
    if (ds === 'warn') return 'warn';
    return 'active';
  }

  function paintFrame(clock) {
    const e = eng.current;
    const cues = cuesRef.current;
    const vars = varsRef.current;

    // Clock display
    if (clockDisplayRef.current) {
      clockDisplayRef.current.textContent = fmtClock(clock);
      clockDisplayRef.current.className = 'clock' +
        (e.phaseHold ? ' hold' : (e.started && !e.paused ? ' run' : ''));
    }

    // Cards
    for (const d of cardRefs.current) {
      if (!d || !cues[d.i]) continue;
      const c = cues[d.i];
      const st = stateOf(d.i, clock);
      const t = c.effTime - clock;

      if (st !== d._st) {
        d._st = st;
        if (d.slot) d.slot.className = 'slot' + (st === 'retired' ? ' gone' : '');
        if (d.card) {
          d.card.className = 'card' +
            (c.type === 'note' ? ' note' : '') +
            (c.type === 'phase' ? ' phase' : '') +
            ' is-' + st;
        }
        if (d.gbEl) d.gbEl.style.display = (st === 'phase') ? '' : 'none';
      }

      // Timer
      let tmr;
      if (c.type === 'phase') {
        tmr = st === 'phase' ? (e.started ? '§HOLD' : '§START') : (st === 'retired' ? '' : cdHTML(Math.max(0, t)));
      } else if (st === 'now') {
        tmr = '§NOW';
      } else if (st === 'retired') {
        tmr = '';
      } else {
        tmr = cdHTML(Math.max(0, t));
      }
      if (tmr !== d._tmr) {
        d._tmr = tmr;
        if (d.cd) d.cd.innerHTML = tmr.charAt(0) === '§'
          ? '<span class="cd-word">' + tmr.slice(1) + '</span>'
          : tmr;
      }

      // Bar
      if (st === 'warn') {
        const warn = c.warn ?? WARN_DEFAULT;
        if (d.barwrap) d.barwrap.classList.remove('hide');
        if (d.bar) d.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, t / warn)) + ')';
      } else if (d.barwrap && !d.barwrap.classList.contains('hide')) {
        d.barwrap.classList.add('hide');
      }

      // State label
      const lbl =
        st === 'now' ? 'NOW' :
        st === 'warn' ? 'NEXT' :
        st === 'standby' ? 'STANDBY' :
        st === 'phase' ? (e.started ? 'PRESS GO' : 'PRESS START') : '';
      if (lbl !== d._lbl) {
        d._lbl = lbl;
        if (d.stateEl) d.stateEl.textContent = lbl;
        if (d.gbEl) d.gbEl.textContent = e.started ? 'GO ▸' : '▶ Start';
      }
    }

    // Variables
    let vis = 0;
    for (const vc of varRefs.current) {
      if (!vc || !vc.v) continue;
      const st = varStateOf(vc.v, clock);
      if (st !== 'gone') vis++;
      if (st !== vc._st) {
        vc._st = st;
        if (vc.slot) vc.slot.className = 'slot' + (st === 'gone' ? ' gone' : '');
        if (vc.card) vc.card.className = 'vcard' + (st === 'standby' ? ' is-standby' : st === 'warn' ? ' is-warn' : '');
      }
    }
    // vars-empty visibility managed by Variables component (React state) — skip here

    // Rendered list current highlight
    let cur = -1;
    if (e.started) {
      for (let i = 0; i < cues.length; i++) {
        if (cues[i].effTime > clock + 1e-6) break;
        if (!cues[i].skipped) cur = i;
      }
    }
    if (cur !== lastRenderCur.current) {
      const prev = lastRenderCur.current;
      if (prev >= 0 && renderRowRefs.current[prev]) renderRowRefs.current[prev].row?.classList.remove('cur');
      if (cur >= 0 && renderRowRefs.current[cur]) renderRowRefs.current[cur].row?.classList.add('cur');
      lastRenderCur.current = cur;
    }
  }

  // Backup tick while tab is hidden
  useEffect(() => {
    const iv = setInterval(() => {
      if (eng.current.started && document.hidden) advance();
    }, 500);
    const onVis = () => {
      if (!document.hidden && eng.current.started) {
        advance();
        if (!eng.current.running) kick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === 'Enter') { e.preventDefault(); goRelease(); }
      else if (e.key === 'ArrowLeft') nudge(-0.5);
      else if (e.key === 'ArrowRight') nudge(0.5);
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === 'e' || e.key === 'E') setShowTimeline(v => !v);
      else if (/^[1-9]$/.test(e.key)) {
        const live = cardRefs.current.find(d => d && d._st && d._st !== 'retired' && d._st !== 'gray' && cuesRef.current[d.i]?.sets.length) ||
          cardRefs.current.find(d => d && d._st && d._st !== 'retired' && cuesRef.current[d.i]?.sets.length);
        if (live) {
          const c = cuesRef.current[live.i];
          const allOpts = c.sets.flatMap(s => s.options.map(opt => ({ name: s.name, opt })));
          const entry = allOpts[+e.key - 1];
          if (entry) setVar(entry.name, entry.opt);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Register callbacks for child components ───────────────────────────────
  const registerCard = useCallback((i, refs) => {
    // Ensure array is large enough
    while (cardRefs.current.length <= i) cardRefs.current.push(null);
    cardRefs.current[i] = { i, ...refs, _st: null, _tmr: null, _lbl: null };
  }, []);

  const unregisterCard = useCallback((i) => {
    if (cardRefs.current[i]) cardRefs.current[i] = null;
  }, []);

  const registerVarRef = useCallback((idx, refs) => {
    while (varRefs.current.length <= idx) varRefs.current.push(null);
    varRefs.current[idx] = { ...refs, _st: null };
  }, []);

  const registerRenderRow = useCallback((i, refs) => {
    while (renderRowRefs.current.length <= i) renderRowRefs.current.push(null);
    renderRowRefs.current[i] = refs;
  }, []);

  // ── I/O ───────────────────────────────────────────────────────────────────
  function download() {
    const blob = new Blob([serializeCSV(cuesRef.current)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cuebey-timeline.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copy() {
    navigator.clipboard?.writeText(serializeCSV(cuesRef.current));
  }

  function loadFile(file) {
    const r = new FileReader();
    r.onload = () => setCsvText(r.result);
    r.readAsText(file);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Header
        engState={engState}
        offsetText={offsetText}
        onOffsetChange={setOffsetText}
        clockRef={clockDisplayRef}
        onPlay={togglePause}
        onMinus={() => nudge(-0.5)}
        onPlus={() => nudge(0.5)}
        onReset={reset}
        onToggleTimeline={() => setShowTimeline(v => !v)}
      />
      <main className={showTimeline ? '' : 'solo'}>
        <Timeline
          csvText={csvText}
          onCsvChange={setCsvText}
          parseStatus={parseStatus}
          metaText={metaText}
          cues={cues}
          vars={vars}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onLoad={loadFile}
          onDownload={download}
          onCopy={copy}
          onSeek={maybeSeek}
          registerRenderRow={registerRenderRow}
        />
        <Deck
          cues={cues}
          vars={vars}
          engState={engState}
          onDone={markDone}
          onSetVar={setVar}
          onPhaseBtn={() => { if (engState.phaseHold) goRelease(); else if (!engState.started) start(); }}
          registerCard={registerCard}
          unregisterCard={unregisterCard}
        />
        <Variables
          vars={vars}
          engState={engState}
          onSetVar={setVar}
          registerVarRef={registerVarRef}
        />
      </main>
      <div className="hint">space start/pause · enter GO · ←/→ ∓0.5s · R reset · E timeline · 1-9 set var</div>
    </div>
  );
}

// Helper (needed in paint loop, pulled from format.js but defined here to avoid circular)
function cdHTML(sec) {
  if (sec >= 15) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return '<span class="cd-int">' + m + ':' + String(Math.min(59, s)).padStart(2, '0') + '</span><span class="cd-dec"></span>';
  }
  const s = Math.floor(sec), d = Math.floor((sec - s) * 10);
  return '<span class="cd-int">' + s + '</span><span class="cd-dec">.' + d + '</span>';
}
