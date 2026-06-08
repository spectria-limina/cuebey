import { useState, useRef, useEffect } from 'react';
import { fmtClean, fmtHMS, parseTime } from '../format.ts';
import { renderText, parseSetsFromRaw } from '../parser.ts';
import type { Cue, VarsRecord, ParseStatus, CueChanges, RenderRowRef, EngStateSnapshot } from '../types.ts';

const COL_HEADERS = ['time', 'type', 'text', 'standby', 'ready', 'remain', 'vars', 'flags'];

// Reconstruct the vars field text from a cue's sets array
function setsToVarsText(sets: Cue['sets']): string {
  if (!sets || !sets.length) return '';
  return sets.map(s => {
    const hasLabel = s.displayLabel && s.displayLabel !== s.name;
    const nameStr = hasLabel ? `${s.name}|${s.displayLabel}` : s.name;
    const hasCustomLabels = s.labels && s.labels.some((l, j) => l !== s.options[j]);
    if (hasCustomLabels) {
      const inner = s.options.map((v, j) => {
        const l = s.labels[j];
        return l === v ? v : `${v}=${l}`;
      }).join(',');
      return `{${nameStr}:${inner}}`;
    }
    if (s.options.length) return `{${nameStr}:${s.options.join(',')}}`;
    return nameStr;
  }).join(';');
}

interface TimelineProps {
  csvText: string;
  onCsvChange: (text: string) => void;
  parseStatus: ParseStatus;
  metaText: string;
  cues: Cue[];
  vars: VarsRecord;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLoad: (file: File) => void;
  onSave: () => void;
  onCopy: () => void;
  onSelect: (i: number) => void;
  onSeek: (i: number) => void;
  onHover: (i: number) => void;
  onUnhover: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onNudge: (d: number) => void;
  onEditCue: (i: number, changes: CueChanges) => void;
  onDeleteCue: (i: number) => void;
  onAddCue: (i: number, after: boolean) => void;
  offsetSec: number;
  getCurrentTime: () => number;
  registerRenderRow: (i: number, refs: RenderRowRef) => void;
  focusRowRef: React.RefObject<((i: number) => void) | null>;
  locked: boolean;
  editorClockDisplayRef: React.RefObject<HTMLDivElement | null>;
  engState: EngStateSnapshot;
  onEditorSync: () => void;
  onEditorResume: () => void;
  onEditorResumeHere: () => void;
}

export default function Timeline({
  csvText, onCsvChange, parseStatus, metaText,
  cues, vars, activeTab, onTabChange,
  onLoad, onSave, onCopy,
  onSelect, onSeek, onHover, onUnhover, onReorder, onNudge,
  onEditCue, onDeleteCue, onAddCue,
  offsetSec, getCurrentTime,
  registerRenderRow, focusRowRef,
  locked,
  editorClockDisplayRef,
  engState,
  onEditorSync, onEditorResume, onEditorResumeHere,
}: TimelineProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const rlistRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const colHeaderRef = useRef<HTMLDivElement>(null);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  interface DragScrollState { active: boolean; speed: number; raf: number; }
  const dragScrollRef = useRef<DragScrollState>({ active: false, speed: 0, raf: 0 });

  const onNudgeRef = useRef(onNudge);
  onNudgeRef.current = onNudge;
  useEffect(() => {
    const el = rlistRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        onNudgeRef.current?.(e.deltaY / 100);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Drag auto-scroll in rendered list
  useEffect(() => {
    const el = rlistRef.current;
    if (!el) return;
    const ZONE = 60, MAX_SPEED = 6;
    const handleDragOver = (e: DragEvent) => {
      if (!isDraggingRef.current) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ds = dragScrollRef.current;
      let speed = 0;
      if (y < ZONE) speed = -MAX_SPEED * Math.max(0, 1 - y / ZONE);
      else if (y > rect.height - ZONE) speed = MAX_SPEED * Math.max(0, 1 - (rect.height - y) / ZONE);
      ds.speed = speed;
      if (speed !== 0 && !ds.active) {
        ds.active = true;
        const scroll = () => {
          if (!ds.active) return;
          el.scrollTop = Math.max(0, el.scrollTop + ds.speed);
          ds.raf = requestAnimationFrame(scroll);
        };
        ds.raf = requestAnimationFrame(scroll);
      } else if (speed === 0 && ds.active) {
        ds.active = false;
        cancelAnimationFrame(ds.raf);
      }
    };
    const stopScroll = () => {
      isDraggingRef.current = false;
      const ds = dragScrollRef.current;
      ds.active = false;
      cancelAnimationFrame(ds.raf);
    };
    el.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragend', stopScroll);
    return () => {
      el.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragend', stopScroll);
    };
  }, []);

  if (focusRowRef) focusRowRef.current = (i: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  };

  function toggleRow(i: number, _shift: boolean) {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });
  }

  // Index-safe wrappers: keep expandedSet valid after structural changes so
  // open editors always match the cue they were opened for.

  function handleAddCue(idx: number, after: boolean) {
    const insertAt = after ? idx + 1 : idx;
    setExpandedSet(prev => {
      const next = new Set<number>();
      for (const x of prev) next.add(x < insertAt ? x : x + 1);
      return next;
    });
    onAddCue(idx, after);
  }

  function handleDeleteCue(idx: number) {
    setExpandedSet(prev => {
      const next = new Set<number>();
      for (const x of prev) {
        if (x < idx) next.add(x);
        else if (x > idx) next.add(x - 1);
        // skip x === idx (deleted)
      }
      return next;
    });
    onDeleteCue(idx);
  }

  function handleMoveUp(idx: number) {
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.delete(idx);
      next.delete(idx - 1);
      return next;
    });
    onReorder(idx, idx - 1);
  }

  function handleMoveDown(idx: number) {
    setExpandedSet(prev => {
      const next = new Set(prev);
      next.delete(idx);
      next.delete(idx + 1);
      return next;
    });
    onReorder(idx, idx + 2);
  }

  return (
    <section className="editor">
      <div className="editor-head">
        <div className="tabs">
          <button className={'tab' + (activeTab === 'source' ? ' on' : '')} onClick={() => onTabChange('source')}>Source</button>
          <button className={'tab' + (activeTab === 'rendered' ? ' on' : '')} onClick={() => onTabChange('rendered')}>Rendered</button>
        </div>
        <div className="meta">{metaText}</div>
      </div>

      <div className={'pane' + (activeTab === 'source' ? ' on' : '')}>
        <div className="source-header">
          <div className="source-col-headers" ref={colHeaderRef}>
            {COL_HEADERS.map(h => (
              <span key={h} className="source-col-header">{h}</span>
            ))}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="source-editor"
          value={csvText}
          onChange={e => !locked && onCsvChange(e.target.value)}
          readOnly={locked}
          spellCheck={false}
          style={{ whiteSpace: 'pre', overflowX: 'auto', wordBreak: 'normal', overflowWrap: 'normal' }}
          onScroll={e => {
            if (colHeaderRef.current) colHeaderRef.current.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft;
          }}
          onKeyDown={e => {
            if (locked) return;
            if (e.key === 'Tab') {
              e.preventDefault();
              const ta = e.target as HTMLTextAreaElement;
              const start = ta.selectionStart, end = ta.selectionEnd;
              const next = ta.value.slice(0, start) + '\t' + ta.value.slice(end);
              // Mutate DOM first so React won't reset the cursor on re-render
              ta.value = next;
              ta.selectionStart = ta.selectionEnd = start + 1;
              onCsvChange(next);
            }
          }}
        />
        <div className={'parsebar ' + (parseStatus.ok ? 'ok' : 'err')}>{parseStatus.msg}</div>
        <div className="io">
          <button className="ghost" onClick={() => fileRef.current?.click()}>Load</button>
          <button className="ghost" onClick={onSave}>Save</button>
          <button className="ghost" onClick={onCopy}>Copy</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) onLoad(f); }} />
        </div>
      </div>

      <div className={'pane' + (activeTab === 'rendered' ? ' on' : '')}>
        <div className="rlist-head">
          <div className="editor-clock" ref={editorClockDisplayRef}>0:00.0</div>
          {engState.started && (engState.paused || engState.phaseHold) && (
            <>
              <button className="ghost editor-clock-btn" title="Set editor clock to playback position" onClick={onEditorSync}>↩ Now</button>
              <button className="ghost editor-clock-btn" title={engState.phaseHold ? 'GO — release phase hold' : 'Resume from current playback position'} onClick={onEditorResume}>▶ {engState.phaseHold ? 'GO' : 'Resume'}</button>
              {engState.paused && <button className="ghost editor-clock-btn" title="Seek to editor clock position and resume" onClick={onEditorResumeHere}>▶ Here</button>}
            </>
          )}
          {expandedSet.size > 0 && (
            <span className="open-count">{expandedSet.size} open</span>
          )}
          <button className="ghost rlist-close-all" onClick={() => setExpandedSet(new Set())}>Close All</button>
        </div>
        <div className="rlist" ref={rlistRef}>
          {cues.map((c, i) => (
            <RenderedRow
              key={i}
              i={i}
              cue={c}
              vars={vars}
              onSelect={onSelect}
              onSeek={onSeek}
              onHover={onHover}
              onUnhover={onUnhover}
              onEditCue={locked ? null : onEditCue}
              onDeleteCue={locked ? null : handleDeleteCue}
              onAddCue={locked ? null : handleAddCue}
              onMoveUp={locked || i === 0 ? null : handleMoveUp}
              onMoveDown={locked || i === cues.length - 1 ? null : handleMoveDown}
              offsetSec={offsetSec}
              getCurrentTime={getCurrentTime}
              registerRenderRow={registerRenderRow}
              expanded={expandedSet.has(i)}
              onToggle={(shift) => toggleRow(i, shift)}
              locked={locked}
              isDragging={dragIdx === i}
              isDragOver={dragOverIdx === i}
              onDragStart={() => { isDraggingRef.current = true; setDragIdx(i); }}
              onDragOver={j => setDragOverIdx(j)}
              onDrop={j => {
                if (dragIdx !== null && !locked) {
                  setExpandedSet(new Set());
                  onReorder(dragIdx, j);
                }
                setDragIdx(null);
                setDragOverIdx(null);
              }}
              onDragEnd={() => { isDraggingRef.current = false; dragScrollRef.current.active = false; setDragIdx(null); setDragOverIdx(null); }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface RenderedRowProps {
  i: number;
  cue: Cue;
  vars: VarsRecord;
  onSelect: (i: number) => void;
  onSeek: (i: number) => void;
  onHover: (i: number) => void;
  onUnhover: (i: number) => void;
  onEditCue: ((i: number, changes: CueChanges) => void) | null;
  onDeleteCue: ((i: number) => void) | null;
  onAddCue: ((i: number, after: boolean) => void) | null;
  onMoveUp: ((i: number) => void) | null;
  onMoveDown: ((i: number) => void) | null;
  offsetSec: number;
  getCurrentTime: () => number;
  registerRenderRow: (i: number, refs: RenderRowRef) => void;
  expanded: boolean;
  onToggle: (shift: boolean) => void;
  locked: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (i: number) => void;
  onDrop: (i: number) => void;
  onDragEnd: () => void;
}

function RenderedRow({
  i, cue, vars,
  onSelect, onSeek, onHover, onUnhover,
  onEditCue, onDeleteCue, onAddCue,
  onMoveUp, onMoveDown,
  offsetSec, getCurrentTime, registerRenderRow,
  expanded, onToggle, locked,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: RenderedRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerRenderRow(i, { row: rowRef.current });
  }, [i, registerRenderRow]);

  useEffect(() => {
    if (expanded && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded]);

  const typeClass = cue.type === 'note' ? ' t-note' : cue.type === 'phase' ? ' t-phase' :
    cue.type === 'event' ? ' t-event' : cue.type === 'cast' ? ' t-cast' : ' t-call';

  const hasMeta = cue.standby != null || cue.warn != null || cue.remain != null || cue.sets.length > 0;

  return (
    <div
      className={'rrow-wrap' + typeClass + (isDragOver ? ' drag-over' : '') + (expanded ? ' expanded' : '')}
      onDragOver={e => { e.preventDefault(); onDragOver?.(i); }}
      onDrop={e => { e.preventDefault(); onDrop?.(i); }}
    >
      <div
        ref={rowRef}
        className={'rrow' + (isDragging ? ' dragging' : '') + (cue.disabled ? ' rrow-disabled' : '')}
        draggable={!locked}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
        onDragEnd={() => onDragEnd?.()}
        onClick={() => onSelect?.(i)}
        onDoubleClick={() => onSeek?.(i)}
        onMouseEnter={() => onHover?.(i)}
        onMouseLeave={() => onUnhover?.(i)}
      >
        <span className="rrow-drag">⠿</span>
        <div className="rt">{fmtClean(cue.effTime)}</div>
        <div className="rc" dangerouslySetInnerHTML={{ __html: renderText(cue.text, vars) }} />
        {cue.disabled && <div className="rtag rtag-off">OFF</div>}
        <button
          className={'rrow-expand ghost' + (expanded ? ' open' : '')}
          title="Edit row"
          onClick={e => { e.stopPropagation(); onToggle(e.shiftKey); }}
        >
          {expanded ? '▾' : '✎'}
        </button>
      </div>
      {hasMeta && (
        <div className="rrow-meta">
          {cue.standby != null && (
            <span className="rpill sb" title="Standby starts">
              {fmtClean(Math.max(0, cue.effTime - cue.standby))}
            </span>
          )}
          {cue.warn != null && (
            <span className="rpill rd" title="Ready starts">
              {fmtClean(Math.max(0, cue.effTime - cue.warn))}
            </span>
          )}
          {cue.remain != null && (
            <span className="rpill rm" title="NOW window ends">
              {fmtClean(cue.effTime + cue.remain)}
            </span>
          )}
          {cue.sets.length > 0 && (
            <span className="rvtag">set {cue.sets.map(s => s.displayLabel || s.name).join(', ')}</span>
          )}
        </div>
      )}
      {expanded && onEditCue && (
        <div className={`re-wrap t-${cue.type}`}>
          <RowEditor
            i={i}
            cue={cue}
            offsetSec={offsetSec}
            getCurrentTime={getCurrentTime}
            onEditCue={onEditCue}
            onDeleteCue={onDeleteCue}
            onAddCue={onAddCue}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </div>
      )}
      {expanded && !onEditCue && (
        <div className="re-panel re-locked">
          <span>Editing locked — press L or click Lock to edit.</span>
        </div>
      )}
    </div>
  );
}

type DurationField = 'standby' | 'warn' | 'remain';

interface RowEditorProps {
  i: number;
  cue: Cue;
  offsetSec: number;
  getCurrentTime: () => number;
  onEditCue: (i: number, changes: CueChanges) => void;
  onDeleteCue: ((i: number) => void) | null;
  onAddCue: ((i: number, after: boolean) => void) | null;
  onMoveUp: ((i: number) => void) | null;
  onMoveDown: ((i: number) => void) | null;
}

function toAbsStr(rel: number, effTime: number, isRemain: boolean): string {
  return fmtHMS(Math.max(0, isRemain ? effTime + rel : effTime - rel));
}

function RowEditor({ i, cue, offsetSec, getCurrentTime, onEditCue, onDeleteCue, onAddCue, onMoveUp, onMoveDown }: RowEditorProps) {
  const [type, setType] = useState(cue.type);
  const [text, setText] = useState(cue.text);
  const [timeStr, setTimeStr] = useState(() => fmtHMS(cue.raw));
  const [standby, setStandby] = useState(() => cue.standby == null ? '' : cue.standby.toFixed(1));
  const [ready, setReady] = useState(() => cue.warn == null ? '' : cue.warn.toFixed(1));
  const [remain, setRemain] = useState(() => cue.remain == null ? '' : cue.remain.toFixed(1));
  const [absStandby, setAbsStandby] = useState(() => cue.standby == null ? '' : toAbsStr(cue.standby, cue.effTime, false));
  const [absReady, setAbsReady] = useState(() => cue.warn == null ? '' : toAbsStr(cue.warn, cue.effTime, false));
  const [absRemain, setAbsRemain] = useState(() => cue.remain == null ? '' : toAbsStr(cue.remain, cue.effTime, true));
  const [varsText, setVarsText] = useState(() => setsToVarsText(cue.sets));

  function commit(changes: CueChanges) { onEditCue(i, changes); }

  function handleTypeChange(v: Cue['type']) { setType(v); commit({ type: v }); }

  function handleTimeBlur() {
    const t = parseTime(timeStr);
    if (t === null) setTimeStr(fmtHMS(cue.raw));
    else commit({ rawTime: timeStr });
  }

  function setTimeNow() {
    const s = fmtHMS(Math.max(0, getCurrentTime() + offsetSec));
    setTimeStr(s);
    commit({ rawTime: s });
  }

  function nudgeTime(delta: number) {
    const base = parseTime(timeStr) ?? cue.raw;
    const s = fmtHMS(Math.max(0, base + delta));
    setTimeStr(s);
    commit({ rawTime: s });
  }

  function handleDuration(field: DurationField, val: string, setter: (v: string) => void, absSetter: (v: string) => void, isRemain: boolean) {
    setter(val);
    const trimmed = val.trim();
    if (trimmed === '') {
      absSetter('');
      commit({ [field]: null } as CueChanges);
    } else {
      const n = parseFloat(trimmed);
      if (isFinite(n) && n >= 0) {
        absSetter(toAbsStr(n, cue.effTime, isRemain));
        commit({ [field]: n } as CueChanges);
      }
    }
  }

  function handleAbsDuration(field: DurationField, absVal: string, relSetter: (v: string) => void, absSetter: (v: string) => void, isRemain: boolean) {
    absSetter(absVal);
    const t = parseTime(absVal);
    if (t !== null) {
      const rel = Math.max(0, isRemain ? t - cue.effTime : cue.effTime - t);
      relSetter(rel.toFixed(1));
      commit({ [field]: rel } as CueChanges);
    }
  }

  function handleAbsDurationBlur(absVal: string, relVal: string, absSetter: (v: string) => void, isRemain: boolean) {
    if (parseTime(absVal) === null) {
      const n = parseFloat(relVal.trim());
      absSetter(isNaN(n) ? '' : toAbsStr(n, cue.effTime, isRemain));
    }
  }

  function durationFromNow(field: DurationField, setter: (v: string) => void, absSetter: (v: string) => void, isRemain: boolean) {
    const tl = getCurrentTime();
    const d = isRemain ? Math.max(0, tl - cue.effTime) : Math.max(0, cue.effTime - tl);
    setter(d.toFixed(1));
    absSetter(toAbsStr(d, cue.effTime, isRemain));
    commit({ [field]: d } as CueChanges);
  }

  function clearDuration(field: DurationField, setter: (v: string) => void, absSetter: (v: string) => void) {
    setter('');
    absSetter('');
    commit({ [field]: null } as CueChanges);
  }

  function handleVarsBlur() {
    commit({ sets: parseSetsFromRaw(varsText, '') });
  }

  // Annotation: effective time relative to offset
  const rawTime = parseTime(timeStr) ?? cue.raw;
  const effDisplay = fmtClean(rawTime - offsetSec);

  const TYPE_OPTIONS: { value: Cue['type']; label: string }[] = [
    { value: 'call', label: 'Call' },
    { value: 'note', label: 'Note' },
    { value: 'event', label: 'Event' },
    { value: 'cast', label: 'Cast' },
    { value: 'phase', label: 'Phase' },
  ];

  interface DurationRowConfig {
    field: DurationField;
    label: string;
    val: string;
    setter: (v: string) => void;
    absVal: string;
    absSetter: (v: string) => void;
    isRemain: boolean;
    nowTitle: string;
  }

  const durationRows: DurationRowConfig[] = [
    { field: 'standby', label: 'Standby', val: standby, setter: setStandby, absVal: absStandby, absSetter: setAbsStandby, isRemain: false, nowTitle: 'Set to seconds remaining until this cue fires' },
    { field: 'warn',    label: 'Ready',   val: ready,   setter: setReady,   absVal: absReady,   absSetter: setAbsReady,   isRemain: false, nowTitle: 'Set ready to time remaining until this cue fires' },
    { field: 'remain',  label: 'Remain',  val: remain,  setter: setRemain,  absVal: absRemain,  absSetter: setAbsRemain,  isRemain: true,  nowTitle: 'Set remain to time elapsed since this cue fired' },
  ];

  return (
    <div className="re-panel">
      {/* Editing header */}
      <div className="re-header">Editing · {fmtClean(cue.effTime)}</div>

      {/* Type segmented selector */}
      <div className="re-row">
        <span className="re-lbl">Type</span>
        <div className="re-type-seg">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={type === opt.value ? 'on' : ''}
              onClick={() => handleTypeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Text */}
      <div className="re-row">
        <span className="re-lbl">Text</span>
        <textarea
          className="re-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => commit({ text })}
          spellCheck={false}
          rows={2}
        />
      </div>

      {/* Time — input + Now on first line, nudge buttons on second line */}
      <div className="re-row">
        <span className="re-lbl">Time</span>
        <input
          className="re-inp re-mono"
          value={timeStr}
          onChange={e => setTimeStr(e.target.value)}
          onBlur={handleTimeBlur}
          spellCheck={false}
        />
        {offsetSec !== 0 && (
          <span className="re-ann">→ {effDisplay} effective</span>
        )}
        <button className="ghost re-now" onClick={setTimeNow} title="Set to current clock time">Now</button>
      </div>
      <div className="re-row re-nudge-row">
        <span className="re-lbl" />
        <button className="ghost re-nudge" onClick={() => nudgeTime(-1)}>−1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(-0.1)}>−0.1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(0.1)}>+0.1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(1)}>+1s</button>
      </div>

      {/* Standby / Ready / Remain — relative input + absolute time input */}
      {durationRows.map(({ field, label, val, setter, absVal, absSetter, isRemain, nowTitle }) => (
        <div key={field} className="re-row">
          <span className="re-lbl">{label}</span>
          <input
            className="re-inp re-mono"
            value={val}
            onChange={e => handleDuration(field, e.target.value, setter, absSetter, isRemain)}
            placeholder="—"
          />
          <input
            className="re-inp re-mono re-abs"
            value={absVal}
            onChange={e => handleAbsDuration(field, e.target.value, setter, absSetter, isRemain)}
            onBlur={() => handleAbsDurationBlur(absVal, val, absSetter, isRemain)}
            placeholder="—"
            title="Absolute timeline time — edit to update the relative value"
          />
          <button className="ghost re-fromnow" title={nowTitle} onClick={() => durationFromNow(field, setter, absSetter, isRemain)}>↓ now</button>
          <button className="ghost re-x" title="Clear" onClick={() => clearDuration(field, setter, absSetter)}>×</button>
        </div>
      ))}

      {/* Vars (unified) */}
      <div className="re-row">
        <span className="re-lbl">Vars</span>
        <input
          className="re-txt re-mono"
          value={varsText}
          onChange={e => setVarsText(e.target.value)}
          onBlur={handleVarsBlur}
          placeholder="{name:opt1,opt2}  or  {name|Label:val=Display,...}"
          spellCheck={false}
        />
      </div>

      {/* Row operations — footer */}
      <div className="re-ops">
        <button className="ghost" disabled={!onMoveUp} onClick={() => onMoveUp?.(i)}>↑ Up</button>
        <button className="ghost" onClick={() => onAddCue?.(i, false)}>⊕ Above</button>
        <button className="ghost re-del" onClick={() => onDeleteCue?.(i)}>✕ Delete</button>
        <button className="ghost" onClick={() => onAddCue?.(i, true)}>⊕ Below</button>
        <button className="ghost" disabled={!onMoveDown} onClick={() => onMoveDown?.(i)}>↓ Down</button>
      </div>
    </div>
  );
}
