import { useState, useEffect, useRef, useCallback } from 'react';
import { parseTime, fmtClock, fmtClean, cdHTML } from './format.ts';
import { buildCues, serializeCSV, SEED_CSV, WARN_DEFAULT } from './parser.ts';
import Header from './components/Header.tsx';
import Timeline from './components/Timeline.tsx';
import Deck from './components/Deck.tsx';
import Variables from './components/Variables.tsx';
import VideoPanel from './components/VideoPanel.tsx';
import type {
  Cue, VarsRecord, EngineRef, EngStateSnapshot, ParseStatus,
  CardRef, CardDomRefs, VarCardRef, VarCardDomRefs, RenderRowRef,
  CueState, CueChanges,
} from './types.ts';

const REMAIN_DEFAULT = 0.5;
// Seconds after last variable use retires before a note card enters pending/retired state
const VAR_LINGER = 5;

export default function App() {
  const [csvText, setCsvText] = useState<string>(() => localStorage.getItem('cuebey-csv') || SEED_CSV);
  const [offsetText, setOffsetText] = useState<string>('0:00:00');
  const [activeTab, setActiveTab] = useState<string>('source');
  const [showTimeline, setShowTimeline] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);
  const [leftWidth, setLeftWidth] = useState<number>(360);
  const [rightWidth, setRightWidth] = useState<number>(300);

  const [cues, setCues] = useState<Cue[]>([]);
  const [vars, setVars] = useState<VarsRecord>({});
  const [varConflicts, setVarConflicts] = useState<string[]>([]);
  const [parseStatus, setParseStatus] = useState<ParseStatus>({ ok: true, msg: 'Ready.' });
  const [metaText, setMetaText] = useState<string>('—');

  const [engState, setEngState] = useState<EngStateSnapshot>({ started: false, paused: false, phaseHold: false });
  const [hideDone, setHideDone] = useState<boolean>(true);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Video
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState<boolean>(false);
  const [videoSynced, setVideoSynced] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(30);

  // Engine timing — mutable refs, never triggers React re-renders
  const eng = useRef<EngineRef>({
    started: false, paused: false, phaseHold: false, phaseHoldIdx: -1,
    syncTime: 0, syncPerf: 0, frozenClock: 0, prevClock: -1e9,
    raf: 0, running: false,
    videoSynced: false,
    syncPoints: [],
  });

  // Persist CSV across page refreshes
  useEffect(() => { localStorage.setItem('cuebey-csv', csvText); }, [csvText]);

  // Repaint when hide-done toggle changes; scroll to maintain context after layout transition
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    paintFrame(currentClock());
    setTimeout(() => {
      const sel = selectedIdxRef.current;
      if (sel >= 0 && cardRefs.current[sel]?._st !== 'retired') {
        scrollDeckToCard(sel);
      } else {
        for (let i = 0; i < cuesRef.current.length; i++) {
          const d = cardRefs.current[i];
          if (d && d._st && d._st !== 'retired' && d._st !== 'gray') { scrollDeckToCard(i); break; }
        }
      }
    }, 450);
  }, [hideDone]);

  // Animated DOM refs
  const clockDisplayRef = useRef<HTMLInputElement>(null);
  const editorClockRef = useRef<number>(0);
  const editorClockDisplayRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(CardRef | null)[]>([]);
  const varRefs = useRef<(VarCardRef | null)[]>([]);
  const renderRowRefs = useRef<(RenderRowRef | null)[]>([]);
  const lastRenderCur = useRef<number>(-2);
  const focusRowRef = useRef<((i: number) => void) | null>(null);
  const selectedIdxRef = useRef<number>(-1);
  const hoveredIdxRef = useRef<number>(-1);
  const hideDoneRef = useRef<boolean>(true);
  hideDoneRef.current = hideDone;
  const lastTopActiveRef = useRef<number>(-1);

  // Live cues/vars for the animation loop
  const cuesRef = useRef<Cue[]>([]);
  const varsRef = useRef<VarsRecord>({});

  // ── Parse & rebuild ──────────────────────────────────────────────────────
  useEffect(() => {
    const offsetSec = parseTime(offsetText) || 0;
    const { cues: newCues, vars: newVars, errs } = buildCues(csvText, offsetSec);

    // Preserve runtime variable values across re-parses
    Object.values(newVars).forEach(v => {
      const old = varsRef.current[v.name];
      if (old && old.value != null && v.options.includes(old.value)) v.value = old.value;
    });

    // Warn about variables with conflicting definitions (multiple sets with different options)
    const conflicts: string[] = [];
    Object.values(newVars).forEach(v => {
      for (const c of newCues) {
        for (const s of c.sets) {
          if (s.name === v.name && s.options.length && s.options.join('|') !== v.options.join('|')) {
            if (!conflicts.includes(v.name)) conflicts.push(v.name);
          }
        }
      }
    });

    cuesRef.current = newCues;
    varsRef.current = newVars;
    setCues(newCues);
    setVars({ ...newVars });
    setVarConflicts(conflicts);

    const last = newCues.reduce<Cue | null>((m, c) => (!m || c.effTime > m.effTime) ? c : m, null);
    setMetaText(
      newCues.length + ' cue' + (newCues.length !== 1 ? 's' : '') +
      (last ? ' · ends ' + fmtClean(last.effTime) : '') +
      (offsetSec ? ' · −' + fmtClean(offsetSec) : '') +
      (conflicts.length ? ' · ⚠ var conflict' : '')
    );
    setParseStatus(errs.length
      ? { ok: false, msg: 'Bad time on row' + (errs.length > 1 ? 's' : '') + ' ' + errs.slice(0, 8).join(', ') + (errs.length > 8 ? '…' : '') }
      : { ok: true, msg: newCues.length ? 'Parsed OK.' : 'Add rows, or Load a CSV.' }
    );

    lastRenderCur.current = -2;
    lastTopActiveRef.current = -1;
    paintFrame(currentClock());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText, offsetText]);

  // ── Video helpers ─────────────────────────────────────────────────────────
  function getTimelineFromVideo(vt: number): number {
    const pts = eng.current.syncPoints;
    if (!pts.length) return 0;
    let best = pts[0];
    for (const sp of pts) {
      if (sp.videoTime <= vt) best = sp;
      else break;
    }
    return best.timelineTime + (vt - best.videoTime);
  }

  function getVideoFromTimeline(tl: number): number | null {
    const pts = eng.current.syncPoints;
    if (!pts.length) return null;
    let best = pts[0];
    for (const sp of pts) {
      if (sp.timelineTime <= tl) best = sp;
      else break;
    }
    return best.videoTime + (tl - best.timelineTime);
  }

  // ── Engine helpers ────────────────────────────────────────────────────────
  function currentClock(): number {
    const e = eng.current;
    if (e.paused || e.phaseHold) return e.frozenClock;
    if (e.videoSynced && videoRef.current) return getTimelineFromVideo(videoRef.current.currentTime);
    if (!e.started) return editorClockRef.current;
    return e.syncTime + (performance.now() - e.syncPerf) / 1000;
  }

  function syncEngState(): void {
    const e = eng.current;
    setEngState({ started: e.started, paused: e.paused, phaseHold: e.phaseHold });
  }

  function firstIdx(): number {
    const c = cuesRef.current;
    for (let i = 0; i < c.length; i++) if (!c[i].skipped) return i;
    return -1;
  }

  function start(): void {
    const e = eng.current;
    const wasActive = e.started;
    e.started = true; e.paused = false; e.phaseHold = false;
    e.syncTime = 0; e.syncPerf = performance.now(); e.frozenClock = 0;
    lastTopActiveRef.current = -1;
    const c = cuesRef.current;
    const firstPhase = c.reduce<Cue | null>((m, x) => x.type === 'phase' && (m === null || x.effTime < m.effTime) ? x : m, null);
    e.prevClock = (firstPhase && firstPhase.effTime <= 0) ? firstPhase.effTime : -1e9;
    syncEngState();
    if (!wasActive) kick();
  }

  function togglePause(): void {
    const e = eng.current;
    const v = videoRef.current;

    if (e.phaseHold && e.videoSynced && v) {
      if (v.paused) v.play(); else v.pause();
      return;
    }
    if (e.phaseHold) return;

    if (!e.started && !e.videoSynced) { start(); return; }

    if (e.paused) {
      e.paused = false;
      if (e.videoSynced && v) {
        v.play();
      } else {
        e.syncTime = e.frozenClock; e.syncPerf = performance.now();
      }
      if (!e.running) kick();
    } else {
      e.frozenClock = currentClock();
      e.paused = true;
      if (e.videoSynced && v) v.pause();
    }
    syncEngState();
  }

  function goRelease(): void {
    const e = eng.current;
    if (e.phaseHold) {
      const phaseTime = e.frozenClock;
      if (e.videoSynced && videoRef.current) {
        const vt = videoRef.current.currentTime;
        const kept = e.syncPoints.filter(sp => sp.videoTime < vt);
        kept.push({ videoTime: vt, timelineTime: phaseTime });
        e.syncPoints = kept;
      }
      e.phaseHold = false;
      e.syncTime = phaseTime; e.syncPerf = performance.now(); e.prevClock = phaseTime;
      syncEngState();
    } else if (!e.started) {
      start();
    }
  }

  function nudge(d: number): void {
    const e = eng.current;
    const v = videoRef.current;
    if (e.videoSynced && v) {
      v.currentTime = Math.max(0, v.currentTime + d);
      return;
    }
    if (!e.started) return;
    if (e.paused || e.phaseHold) e.frozenClock += d;
    else e.syncTime += d;
    e.prevClock = currentClock();
  }

  function markDone(i: number): void {
    const c = cuesRef.current[i];
    if (!c) return;
    const slot = cardRefs.current[i]?.slot;
    if (slot) {
      // Use slower animation for manually-retired cards that haven't reached their time yet
      const st = cardRefs.current[i]?._st;
      if (st && st !== 'retired' && st !== 'gray') {
        slot.className = slot.className.replace(/\bgone\b|\bgone-manual\b/, '') + ' gone-manual';
      }
    }
    c.skipped = true;
    paintFrame(currentClock());
  }

  function toggleDone(i: number): void {
    const c = cuesRef.current[i];
    if (!c) return;
    if (c.skipped) {
      // Un-retire: only allow if cue hasn't passed its time yet
      const clock = currentClock();
      const e = eng.current;
      if (e.started && c.effTime + (c.remain ?? REMAIN_DEFAULT) < clock) return;
      c.skipped = false;
    } else {
      markDone(i);
      return;
    }
    paintFrame(currentClock());
  }

  function toggleDisabled(i: number): void {
    const c = cuesRef.current[i];
    if (!c) return;
    c.disabled = !c.disabled;
    setCsvText(serializeCSV(cuesRef.current));
  }

  function onSyncEntry(i: number): void {
    const c = cuesRef.current[i];
    if (!c) return;
    const e = eng.current;
    if (e.videoSynced && videoRef.current) {
      // Video sync: insert a new sync point mapping current video time to this cue's time
      const vt = videoRef.current.currentTime;
      const kept = e.syncPoints.filter(sp => sp.videoTime < vt);
      kept.push({ videoTime: vt, timelineTime: c.effTime });
      e.syncPoints = kept;
    } else if (e.started) {
      // Freestanding: re-anchor the clock to this cue's time
      if (e.paused || e.phaseHold) {
        e.frozenClock = c.effTime;
      } else {
        e.syncTime = c.effTime;
        e.syncPerf = performance.now();
      }
      e.prevClock = c.effTime;
    }
    c.skipped = true;
    paintFrame(currentClock());
  }

  function refreshCardClass(d: CardRef): void {
    if (!d?.card) return;
    const c = cuesRef.current[d.i];
    if (!c) return;
    d.card.className = 'card' +
      (c.type === 'note' ? ' note' : '') +
      (c.type === 'phase' ? ' phase' : '') +
      (c.type === 'event' ? ' event' : '') +
      (c.type === 'cast' ? ' cast' : '') +
      ' is-' + (d._st || 'gray') +
      (d._sel ? ' ui-selected' : '') +
      (d._hov ? ' ui-hovered' : '');
  }

  function applyHoveredClass(i: number, add: boolean): void {
    renderRowRefs.current[i]?.row?.classList.toggle('rrow-hovered', add);
    const d = cardRefs.current[i];
    if (d) { d._hov = add; refreshCardClass(d); }
  }

  function applySelectedClass(i: number, add: boolean): void {
    renderRowRefs.current[i]?.row?.classList.toggle('rrow-selected', add);
    const d = cardRefs.current[i];
    if (d) { d._sel = add; refreshCardClass(d); }
  }

  function handleSelect(i: number): void {
    const prev = selectedIdxRef.current;
    if (prev >= 0) applySelectedClass(prev, false);
    selectedIdxRef.current = i;
    if (i >= 0) applySelectedClass(i, true);
    // Does NOT seek the clock; double-click calls handleSeek for that
  }

  function handleSeek(i: number): void {
    handleDoubleClick(i);
  }

  function handleHover(i: number): void {
    const prev = hoveredIdxRef.current;
    if (prev === i) return;
    if (prev >= 0) applyHoveredClass(prev, false);
    hoveredIdxRef.current = i;
    if (i >= 0) applyHoveredClass(i, true);
  }

  function handleUnhover(i: number): void {
    if (hoveredIdxRef.current !== i) return;
    hoveredIdxRef.current = -1;
    applyHoveredClass(i, false);
  }

  function setEditorClock(t: number): void {
    editorClockRef.current = Math.max(0, t);
    if (editorClockDisplayRef.current) {
      editorClockDisplayRef.current.textContent = fmtClock(editorClockRef.current);
    }
    paintFrame(editorClockRef.current);
  }

  function handleDoubleClick(i: number): void {
    const e = eng.current;
    const c = cuesRef.current[i];
    if (!c) return;
    if (e.started && !e.paused && !e.phaseHold) return; // live — no seeking
    if (e.started && (e.paused || e.phaseHold)) {
      // Paused/held: seek playback to 5s before this cue
      maybeSeek(i);
    } else {
      // Not started: set editor clock to this cue's time
      setEditorClock(c.effTime);
    }
  }

  function editCue(i: number, changes: CueChanges): void {
    const c = cuesRef.current[i];
    if (!c) return;
    const offsetSec = parseTime(offsetText) || 0;
    if ('type' in changes) c.type = changes.type!;
    if ('text' in changes) { c.text = changes.text!; c._tok = /{[a-zA-Z0-9_|]/.test(changes.text!); }
    if ('rawTime' in changes) {
      const t = parseTime(changes.rawTime!);
      if (t !== null) { c.raw = t; c.effTime = t - offsetSec; }
    }
    if ('standby' in changes) c.standby = changes.standby ?? null;
    if ('warn' in changes) c.warn = changes.warn ?? null;
    if ('remain' in changes) c.remain = changes.remain ?? null;
    if ('sets' in changes) c.sets = changes.sets!;
    setCsvText(serializeCSV(cuesRef.current));
  }

  function reorderCues(fromIdx: number, toIdx: number): void {
    if (fromIdx === toIdx) return;
    const c = [...cuesRef.current];
    const [moved] = c.splice(fromIdx, 1);
    c.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    cuesRef.current = c;
    setCsvText(serializeCSV(c));
  }

  function deleteCue(i: number): void {
    cuesRef.current.splice(i, 1);
    setCsvText(serializeCSV(cuesRef.current));
  }

  function addCue(i: number, after: boolean): void {
    const c = cuesRef.current;
    const ref = c[i];
    const offsetSec = parseTime(offsetText) || 0;
    const baseRaw = ref ? ref.raw : 0;
    const newRaw = Math.max(0, baseRaw + (after ? 1 : -1));
    c.splice(after ? i + 1 : i, 0, {
      raw: newRaw, effTime: newRaw - offsetSec,
      type: 'call', text: '',
      standby: null, warn: null, remain: null,
      sets: [], skipped: false, disabled: false,
      syncPoint: false, castbarDuration: null, _tok: false, varRefs: [],
    });
    setCsvText(serializeCSV(c));
  }

  function reset(): void {
    const e = eng.current;
    const wasVideoSynced = e.videoSynced;
    const savedPoints = [...e.syncPoints];

    e.started = false; e.paused = false; e.phaseHold = false; e.phaseHoldIdx = -1;
    e.syncTime = 0; e.frozenClock = 0; e.prevClock = -1e9; e.running = false;
    lastTopActiveRef.current = -1;
    cancelAnimationFrame(e.raf);
    cuesRef.current.forEach(c => (c.skipped = false));
    Object.values(varsRef.current).forEach(v => { v.value = null; });

    if (wasVideoSynced && videoRef.current && savedPoints.length) {
      const v = videoRef.current;
      v.currentTime = savedPoints[0].videoTime;
      v.pause();
      e.videoSynced = true;
      e.syncPoints = savedPoints;
      e.started = true;
      e.paused = true;
      e.frozenClock = 0;
    }

    lastRenderCur.current = -2;
    syncEngState();
    setVars(prev => {
      const next = { ...prev };
      Object.values(next).forEach(vv => { vv.value = null; });
      return next;
    });

    // Always scroll to top on reset
    requestAnimationFrame(() => {
      const deckEl = document.getElementById('deck');
      if (deckEl) deckEl.scrollTop = 0;
      const rlistEl = document.querySelector('.rlist');
      if (rlistEl) (rlistEl as HTMLElement).scrollTop = 0;
    });

    paintFrame(0);
  }

  function setVar(name: string, val: string): void {
    const v = varsRef.current[name];
    if (!v) return;
    v.value = v.value === val ? null : val;
    setVars(prev => ({ ...prev, [name]: { ...prev[name], value: v.value } }));
  }

  function maybeSeek(i: number): void {
    const e = eng.current;
    const v = videoRef.current;
    if (e.started && !e.paused && !e.phaseHold) return;
    const t = Math.max(0, (cuesRef.current[i]?.effTime ?? 0) - 5);
    if (e.videoSynced && v) {
      const vt = getVideoFromTimeline(t);
      if (vt != null) v.currentTime = Math.max(0, vt);
    } else if (e.started) {
      e.frozenClock = t;
      e.prevClock = t;
      paintFrame(t);
    }
  }

  function seekToTime(t: number): void {
    const e = eng.current;
    const v = videoRef.current;
    t = Math.max(0, t);
    if (e.videoSynced && v) {
      const vt = getVideoFromTimeline(t);
      if (vt != null) v.currentTime = Math.max(0, vt);
    } else if (!e.started) {
      setEditorClock(t);
    } else if (e.paused || e.phaseHold) {
      e.frozenClock = t;
      e.prevClock = t;
      paintFrame(t);
    } else {
      // Running freestanding: re-anchor
      e.syncTime = t;
      e.syncPerf = performance.now();
      e.prevClock = t;
    }
  }

  // ── Deck auto-scroll ─────────────────────────────────────────────────────
  function smoothScrollDeck(deckEl: HTMLElement, targetScrollTop: number, duration = 800): void {
    const start = deckEl.scrollTop;
    const delta = targetScrollTop - start;
    if (Math.abs(delta) < 2) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
      deckEl.scrollTop = start + delta * ease;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function scrollDeckToCard(i: number, delay = 0): void {
    const doScroll = () => {
      const d = cardRefs.current[i];
      const deckEl = document.getElementById('deck');
      if (!d?.card || !deckEl) return;
      const anchorPx = Math.max(100, Math.min(300, deckEl.clientHeight * 0.2));
      const deckRect = deckEl.getBoundingClientRect();
      const slot = d.card.closest('.slot') ?? d.card;
      const relativeTop = slot.getBoundingClientRect().top - deckRect.top + deckEl.scrollTop;
      smoothScrollDeck(deckEl, Math.max(0, relativeTop - anchorPx));
    };
    if (delay > 0) setTimeout(doScroll, delay);
    else doScroll();
  }

  // ── Video sync controls ───────────────────────────────────────────────────
  function setVideoSync(): void {
    const e = eng.current;
    const v = videoRef.current;
    if (!v) return;
    const vt = v.currentTime;

    e.syncPoints = [{ videoTime: vt, timelineTime: 0 }];
    e.videoSynced = true;
    lastTopActiveRef.current = -1;
    e.started = true;
    e.phaseHold = false; e.phaseHoldIdx = -1;
    e.frozenClock = 0;
    e.paused = v.paused;
    e.prevClock = -1e9;

    cuesRef.current.forEach(c => (c.skipped = false));
    Object.values(varsRef.current).forEach(vv => { vv.value = null; });
    lastRenderCur.current = -2;

    syncEngState();
    setVideoSynced(true);
    setVars(prev => {
      const next = { ...prev };
      Object.values(next).forEach(vv => { vv.value = null; });
      return next;
    });
    if (!e.paused && !e.running) kick();
    else paintFrame(0);
  }

  function clearVideoSync(): void {
    const e = eng.current;
    e.videoSynced = false;
    e.syncPoints = [];
    e.started = false;
    e.paused = false;
    e.phaseHold = false;
    e.running = false;
    cancelAnimationFrame(e.raf);
    setVideoSynced(false);
    syncEngState();
    paintFrame(0);
  }

  function loadVideo(file: File): void {
    const v = videoRef.current;
    if (!v) return;
    if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(file);
    v.load();
    setVideoLoaded(true);
  }

  function unloadVideo(): void {
    const v = videoRef.current;
    if (!v) return;
    clearVideoSync();
    if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
    v.src = '';
    v.load();
    setVideoLoaded(false);
  }

  function setVideoRate(rate: number): void {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }

  // ── Video events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => {
      const e = eng.current;
      if (!e.videoSynced) return;
      if (e.phaseHold) return;
      if (e.paused) {
        e.paused = false;
        syncEngState();
        kick();
      }
    };

    const onPause = () => {
      const e = eng.current;
      if (!e.videoSynced || e.phaseHold) return;
      if (!e.paused) {
        e.frozenClock = currentClock();
        e.paused = true;
        syncEngState();
      }
    };

    const onSeeked = () => {
      const e = eng.current;
      if (!e.videoSynced || !v) return;
      const newClock = getTimelineFromVideo(v.currentTime);
      e.prevClock = newClock;
      if (!e.phaseHold) e.frozenClock = newClock;
      paintFrame(currentClock());
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  function advance(): void {
    const e = eng.current;
    if (!e.started) return;
    if (!e.paused && !e.phaseHold) {
      const c = (e.videoSynced && videoRef.current)
        ? getTimelineFromVideo(videoRef.current.currentTime)
        : e.syncTime + (performance.now() - e.syncPerf) / 1000;
      let hit = -1, hitTime = Infinity;
      const cues = cuesRef.current;
      for (let i = 0; i < cues.length; i++) {
        if (cues[i].type === 'phase' && !cues[i].skipped &&
            cues[i].effTime > e.prevClock + 1e-6 && cues[i].effTime <= c &&
            cues[i].effTime < hitTime) {
          hit = i; hitTime = cues[i].effTime;
        }
      }
      if (hit >= 0) {
        e.phaseHold = true; e.phaseHoldIdx = hit;
        e.frozenClock = cuesRef.current[hit].effTime;
        e.prevClock = e.frozenClock;
        syncEngState();
      } else {
        e.prevClock = c;
      }
    }
    paintFrame(currentClock());
  }

  function kick(): void {
    const e = eng.current;
    if (e.running) return;
    e.running = true;
    loop();
  }

  function loop(): void {
    const e = eng.current;
    if (!e.started) { e.running = false; return; }
    advance();
    e.raf = requestAnimationFrame(loop);
  }

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
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === 'Enter') { e.preventDefault(); goRelease(); }
      else if (e.key === 'ArrowLeft') nudge(-0.5);
      else if (e.key === 'ArrowRight') nudge(0.5);
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === 'e' || e.key === 'E') setShowTimeline(v => !v);
      else if (e.key === 'l' || e.key === 'L') setLocked(v => !v);
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

  // ── State computation ─────────────────────────────────────────────────────

  function stateOf(i: number, clock: number): CueState {
    const e = eng.current;
    const c = cuesRef.current[i];
    if (!c) return 'gray';
    if (c.disabled) return 'gray';

    if (c.type === 'phase') {
      if (!e.started) return i === firstIdx() ? 'phase' : 'gray';
      if (e.phaseHold && e.phaseHoldIdx === i) return 'phase';
      if (c.skipped || clock > c.effTime + 1e-6) return 'retired';
      const t = c.effTime - clock, warn = c.warn ?? WARN_DEFAULT, sb = c.standby;
      if (t <= warn) return 'ready';
      if (sb != null && t <= sb) return 'standby';
      return 'gray';
    }

    if (c.skipped) return 'retired';
    if (!e.started) return 'gray';

    const t = c.effTime - clock;
    const warn = c.warn ?? WARN_DEFAULT;
    const sb = c.standby;
    const remain = c.remain ?? REMAIN_DEFAULT;

    // Note cards with sets: retire immediately when all set variables are filled
    // (this can fire at any time stage — the user has answered so the card can go)
    if (c.type === 'note' && c.sets.length > 0) {
      const allFilled = c.sets.every(s => varsRef.current[s.name]?.value != null);
      if (allFilled) return 'retired';
    }

    if (t <= -remain) {
      // Past the now window — check if any referenced variable is still unset
      const varNames = c.varRefs || [];
      if (varNames.length > 0) {
        const anyUnset = varNames.some(nm => varsRef.current[nm]?.value == null);
        if (anyUnset) {
          // Compute the linger deadline from the last non-disabled cue referencing
          // any of our variables. Track whether we found at least one registered var.
          let maxLastRetire = -Infinity;
          let foundAnyVar = false;
          for (const nm of varNames) {
            const v = varsRef.current[nm];
            if (!v) continue;
            foundAnyVar = true;
            // Walk backwards from lastIdx to find the last non-disabled cue
            // that references this variable.
            let idx = v.lastIdx;
            while (idx >= 0) {
              const lastCue = cuesRef.current[idx];
              if (lastCue && !lastCue.disabled && lastCue.varRefs?.includes(nm)) {
                maxLastRetire = Math.max(maxLastRetire,
                  lastCue.effTime + (lastCue.remain ?? REMAIN_DEFAULT) + VAR_LINGER);
                break;
              }
              idx--;
            }
          }
          // If we found at least one registered variable and the linger window is
          // still open, stay pending. If foundAnyVar but all referencing cues are
          // disabled (maxLastRetire still -Infinity), retire immediately.
          if (foundAnyVar && maxLastRetire !== -Infinity && clock <= maxLastRetire) return 'pending';
        }
      }
      return 'retired';
    }

    if (t <= 0) return 'now';
    if (t <= warn) return 'ready';
    if (sb != null && t <= sb) return 'standby';
    return 'gray';
  }

  function varStateOf(v: { options: string[]; lastIdx: number; remain?: number | null }, clock: number): 'gone' | 'active' {
    if (!v.options || !v.options.length) return 'gone';
    const last = cuesRef.current[v.lastIdx];
    // 5-second linger after last use retires (whether variable was set or not)
    if (last && clock >= last.effTime + (last.remain ?? REMAIN_DEFAULT) + VAR_LINGER) return 'gone';
    return 'active';
  }

  // ── Paint ─────────────────────────────────────────────────────────────────
  function paintFrame(clock: number): void {
    const e = eng.current;
    const cues = cuesRef.current;

    if (clockDisplayRef.current) {
      if (document.activeElement !== clockDisplayRef.current) {
        clockDisplayRef.current.value = fmtClock(clock);
      }
      clockDisplayRef.current.className = 'clock-input' +
        (e.phaseHold ? ' hold' : (e.started && !e.paused ? ' run' : ''));
    }

    if (e.started && !e.paused && !e.phaseHold) {
      editorClockRef.current = clock;
      if (editorClockDisplayRef.current) {
        editorClockDisplayRef.current.textContent = fmtClock(clock);
      }
    }

    for (const d of cardRefs.current) {
      if (!d || !d.card || !cues[d.i]) continue;
      const c = cues[d.i];
      const st = stateOf(d.i, clock);
      const t = c.effTime - clock;

      // Slot visibility
      const isDisabled = c.disabled;
      const gone = hideDoneRef.current && st === 'retired' && !isDisabled;
      let slotCls = 'slot';
      if (isDisabled) slotCls += ' slot-disabled';
      else if (gone) slotCls += ' gone';
      else if (st === 'retired') slotCls += ' dimmed';
      if (d.slot && d.slot.className !== slotCls) d.slot.className = slotCls;

      if (st !== d._st) {
        const prevSt = d._st;
        d._st = st;
        const typeClass = c.type === 'note' ? ' note' : c.type === 'phase' ? ' phase' : c.type === 'event' ? ' event' : c.type === 'cast' ? ' cast' : '';
        d.card.className = 'card' + typeClass +
          ' is-' + st +
          (d._sel ? ' ui-selected' : '') +
          (d._hov ? ' ui-hovered' : '');

        // Attention flash when entering ready state (not for note cards)
        if (st === 'ready' && prevSt !== 'ready' && c.type !== 'note') {
          d.card.classList.add('just-entered');
          setTimeout(() => d.card?.classList.remove('just-entered'), 750);
        }

        if (d.gbEl) d.gbEl.style.display = st === 'phase' ? '' : 'none';
      }

      // Skip/Restore button
      if (d.doneBtn && c.type !== 'phase') {
        const showRestore = st === 'retired';
        const dis = e.started && e.videoSynced && !e.paused && !e.phaseHold;
        const newText = showRestore ? '↺' : '⇓';
        const newCls = showRestore ? 'restore-btn' : 'skip-btn';
        if (d.doneBtn.textContent !== newText) d.doneBtn.textContent = newText;
        if (d.doneBtn.className !== newCls) d.doneBtn.className = newCls;
        // Disable un-retiring a past-due cue while running
        const cantRestore = showRestore && e.started && (c.effTime + (c.remain ?? REMAIN_DEFAULT) < clock);
        const newDis = dis || cantRestore;
        if (d.doneBtn.disabled !== newDis) d.doneBtn.disabled = newDis;
      }

      // Countdown display
      let tmr: string;
      if (c.type === 'phase') {
        tmr = st === 'phase' ? (e.started ? '§HOLD' : '§START') : (st === 'retired' ? '' : cdHTML(Math.max(0, t)));
      } else if (st === 'now') {
        tmr = '§NOW';
      } else if (st === 'pending') {
        tmr = ''; // no countdown in pending — card is just waiting
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

      // Progress bar
      if (st === 'ready') {
        const warn = c.warn ?? WARN_DEFAULT;
        if (d.barwrap) d.barwrap.classList.remove('hide');
        if (d.bar) {
          if (c.type === 'cast') {
            // Castbar: fills left-to-right as cast progresses
            d.bar.className = 'bar castbar';
            d.bar.style.transformOrigin = 'center';
            d.bar.style.background = '';
            d.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - t / warn)) + ')';
          } else {
            // Ready drain bar: amber, low-contrast, shrinks from center
            d.bar.className = 'bar';
            d.bar.style.background = 'rgba(200,168,74,0.45)';
            d.bar.style.transformOrigin = 'center';
            d.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, t / warn)) + ')';
          }
        }
      } else if (st === 'now') {
        const remain = c.remain;
        if (remain != null && remain > 0) {
          if (d.barwrap) d.barwrap.classList.remove('hide');
          if (d.bar) {
            d.bar.className = 'bar';
            d.bar.style.background = 'var(--green)';
            d.bar.style.transformOrigin = 'center';
            d.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 + t / remain)) + ')';
          }
        } else if (d.barwrap && !d.barwrap.classList.contains('hide')) {
          d.barwrap.classList.add('hide');
        }
      } else if (c.type === 'cast' && st !== 'retired') {
        // Keep castbar track visible (empty) in all pre-ready states
        if (d.barwrap) d.barwrap.classList.remove('hide');
        if (d.bar) {
          d.bar.className = 'bar castbar';
          d.bar.style.transformOrigin = 'left';
          d.bar.style.transform = 'scaleX(0)';
          d.bar.style.background = '';
        }
      } else if (d.barwrap && !d.barwrap.classList.contains('hide')) {
        d.barwrap.classList.add('hide');
        if (d.bar) d.bar.style.background = '';
      }

      // State label
      const lbl =
        st === 'now' ? 'NOW' :
        st === 'pending' ? 'PENDING' :
        st === 'ready' ? 'READY' :
        st === 'standby' ? 'STANDBY' :
        st === 'phase' ? (e.started ? 'PRESS GO' : 'PRESS START') : '';
      if (lbl !== d._lbl) {
        d._lbl = lbl;
        if (d.stateEl) d.stateEl.textContent = lbl;
        if (d.gbEl) d.gbEl.textContent = e.started ? 'GO ▸' : '▶ Start';
      }
    }

    // Auto-scroll deck during playback
    if (e.started && !e.paused && !e.phaseHold) {
      let newTop = -1;
      for (let i = 0; i < cues.length; i++) {
        const d = cardRefs.current[i];
        if (d && d._st && d._st !== 'retired' && d._st !== 'gray') { newTop = i; break; }
      }
      if (newTop !== lastTopActiveRef.current) {
        const prev = lastTopActiveRef.current;
        lastTopActiveRef.current = newTop;
        if (prev >= 0 && newTop > prev) {
          scrollDeckToCard(newTop, hideDoneRef.current ? 450 : 0);
        }
      }
    }

    // Variable panel state
    for (const vc of varRefs.current) {
      if (!vc || !vc.v) continue;
      const st = varStateOf(vc.v, clock);
      const isSet = vc.v.value != null;
      const newSlotCls = 'slot' + (st === 'gone' ? ' gone' : '');
      const newCardCls = 'vcard' + (isSet ? ' is-set' : '');
      if (st !== vc._st) {
        vc._st = st;
        if (vc.slot && vc.slot.className !== newSlotCls) vc.slot.className = newSlotCls;
      }
      if (vc.card && vc.card.className !== newCardCls) vc.card.className = newCardCls;
    }

    // Track most recently fired cue (for cur highlight in timeline)
    let cur = -1, curTime = -Infinity;
    if (e.started) {
      for (let i = 0; i < cues.length; i++) {
        if (!cues[i].skipped && !cues[i].disabled && cues[i].effTime <= clock + 1e-6 && cues[i].effTime > curTime) {
          cur = i; curTime = cues[i].effTime;
        }
      }
    }
    if (cur !== lastRenderCur.current) {
      const prev = lastRenderCur.current;
      if (prev >= 0 && renderRowRefs.current[prev]) {
        const wrap = renderRowRefs.current[prev]?.row?.parentElement;
        wrap?.classList.remove('rrow-cur');
      }
      if (cur >= 0 && renderRowRefs.current[cur]) {
        const wrap = renderRowRefs.current[cur]?.row?.parentElement;
        wrap?.classList.add('rrow-cur');
      }
      lastRenderCur.current = cur;
    }
  }

  // ── Register callbacks ────────────────────────────────────────────────────
  const registerCard = useCallback((i: number, refs: CardDomRefs) => {
    while (cardRefs.current.length <= i) cardRefs.current.push(null);
    const prev = cardRefs.current[i];
    cardRefs.current[i] = { i, ...refs, _st: null, _tmr: null, _lbl: null,
      _sel: prev?._sel ?? false, _hov: prev?._hov ?? false };
    paintFrame(currentClock());
  }, []);

  const unregisterCard = useCallback((i: number) => {
    if (cardRefs.current[i]) cardRefs.current[i] = null;
  }, []);

  const registerVarRef = useCallback((idx: number, refs: VarCardDomRefs) => {
    while (varRefs.current.length <= idx) varRefs.current.push(null);
    varRefs.current[idx] = { ...refs, _st: null };
  }, []);

  const registerRenderRow = useCallback((i: number, refs: RenderRowRef) => {
    while (renderRowRefs.current.length <= i) renderRowRefs.current.push(null);
    renderRowRefs.current[i] = refs;
    if (refs.row) {
      const wrap = refs.row.parentElement;
      wrap?.classList.toggle('rrow-selected', selectedIdxRef.current === i);
      wrap?.classList.toggle('rrow-hovered', hoveredIdxRef.current === i);
    }
  }, []);

  // ── I/O ───────────────────────────────────────────────────────────────────
  async function save(): Promise<void> {
    const content = serializeCSV(cuesRef.current);
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as Window & { showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: 'cuebey-timeline.tsv',
          types: [
            { description: 'TSV (tab-separated)', accept: { 'text/tab-separated-values': ['.tsv'] } },
            { description: 'CSV', accept: { 'text/csv': ['.csv'] } },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = 'data:text/tab-separated-values;charset=utf-8,' + encodeURIComponent(content);
    a.download = 'cuebey-timeline.tsv';
    a.click();
  }

  function copy(): void { navigator.clipboard?.writeText(serializeCSV(cuesRef.current)); }

  function onCardFocus(i: number): void {
    const e = eng.current;
    if (e.started && !e.paused && !e.phaseHold) return;
    setActiveTab('rendered');
    handleSelect(i);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      renderRowRefs.current[i]?.row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  }

  function loadFile(file: File): void {
    const r = new FileReader();
    r.onload = () => {
      const offsetSec = parseTime(offsetText) || 0;
      const { cues } = buildCues(r.result as string, offsetSec);
      // Normalize to TSV regardless of source format (CSV, old format, etc.)
      setCsvText(cues.length > 0 ? serializeCSV(cues) : r.result as string);
    };
    r.readAsText(file);
  }

  const doneDisabled = videoSynced && engState.started && !engState.paused && !engState.phaseHold;

  // ── Resize handlers ───────────────────────────────────────────────────────
  function startResizeLeft(e: React.MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    const onMove = (ev: MouseEvent) => {
      setLeftWidth(Math.max(200, Math.min(600, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResizeRight(e: React.MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightWidth;
    const onMove = (ev: MouseEvent) => {
      setRightWidth(Math.max(180, Math.min(500, startWidth - (ev.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Header
        engState={engState}
        videoLoaded={videoLoaded}
        videoSynced={videoSynced}
        offsetText={offsetText}
        onOffsetChange={setOffsetText}
        clockRef={clockDisplayRef}
        onPlay={togglePause}
        onGo={goRelease}
        onMinus={() => nudge(-0.5)}
        onPlus={() => nudge(0.5)}
        onReset={reset}
        onToggleTimeline={() => setShowTimeline(v => !v)}
        hideDone={hideDone}
        onToggleHideDone={() => setHideDone(v => !v)}
        locked={locked}
        onToggleLock={() => setLocked(v => !v)}
        showHelp={showHelp}
        onToggleHelp={() => setShowHelp(v => !v)}
        onLoadVideo={loadVideo}
        onUnloadVideo={unloadVideo}
        onSpeedChange={setVideoRate}
        onClockSeek={seekToTime}
        onClockBlur={() => paintFrame(currentClock())}
      />
      <main
        className={showTimeline ? '' : 'solo'}
        style={{ gridTemplateColumns: showTimeline
          ? `${leftWidth}px 6px 1fr 6px ${rightWidth}px`
          : `0 0 1fr 6px ${rightWidth}px` }}
      >
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
          onSave={save}
          onCopy={copy}
          onSelect={handleSelect}
          onSeek={handleSeek}
          onHover={handleHover}
          onUnhover={handleUnhover}
          onReorder={reorderCues}
          onNudge={nudge}
          onEditCue={editCue}
          onDeleteCue={deleteCue}
          onAddCue={addCue}
          offsetSec={parseTime(offsetText) || 0}
          getCurrentTime={currentClock}
          registerRenderRow={registerRenderRow}
          focusRowRef={focusRowRef}
          locked={locked}
          editorClockDisplayRef={editorClockDisplayRef}
        />
        <div className="resize-handle resize-handle-left" onMouseDown={startResizeLeft} />
        <div className="center-col">
          <VideoPanel
            videoRef={videoRef}
            videoLoaded={videoLoaded}
            synced={videoSynced}
            onSetSync={setVideoSync}
            onClearSync={clearVideoSync}
            onUnload={unloadVideo}
            onLoadFile={loadVideo}
            onRateChange={setVideoRate}
            fps={fps}
            onFpsChange={setFps}
            onFrameStep={d => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + d / fps); }}
          />
          <Deck
            cues={cues}
            vars={vars}
            engState={engState}
            doneDisabled={doneDisabled}
            onDone={toggleDone}
            onSetVar={setVar}
            onSyncEntry={onSyncEntry}
            onPhaseBtn={() => { if (engState.phaseHold) goRelease(); else if (!engState.started) start(); }}
            onCardFocus={onCardFocus}
            onDoubleClick={handleDoubleClick}
            onHover={handleHover}
            onUnhover={handleUnhover}
            onToggleDisabled={toggleDisabled}
            registerCard={registerCard}
            unregisterCard={unregisterCard}
            locked={locked}
            onEditCue={editCue}
            getCurrentTime={currentClock}
            offsetSec={parseTime(offsetText) || 0}
          />
        </div>
        <div className="resize-handle resize-handle-right" onMouseDown={startResizeRight} />
        <Variables
          vars={vars}
          conflicts={varConflicts}
          engState={engState}
          onSetVar={setVar}
          registerVarRef={registerVarRef}
        />
      </main>
    </div>
  );
}
