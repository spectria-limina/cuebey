import { useState, useRef, useEffect } from 'react';
import { fmtClean, fmtHMS, trimNum, parseTime } from '../format.ts';
import { renderText, parseSetsFromRaw } from '../parser.ts';
import type { Cue, VarsRecord, ParseStatus, CueChanges, RenderRowRef } from '../types.ts';

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
      if (!e.shiftKey) return;
      e.preventDefault();
      onNudgeRef.current?.(e.deltaY / 100);
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
    setExpandedSet(() => {
      const next = new Set<number>();
      next.add(i);
      return next;
    });
  };

  function toggleRow(i: number, shift: boolean) {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        if (!shift) next.clear();
        next.add(i);
      }
      return next;
    });
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
        <div className="source-col-headers" ref={colHeaderRef}>
          {COL_HEADERS.map(h => (
            <span key={h} className="source-col-header">{h}</span>
          ))}
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
              onCsvChange(next);
              requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
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
              onDeleteCue={locked ? null : onDeleteCue}
              onAddCue={locked ? null : onAddCue}
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
              onDrop={j => { if (dragIdx !== null && !locked) onReorder?.(dragIdx, j); setDragIdx(null); setDragOverIdx(null); }}
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
    cue.type === 'event' ? ' t-event' : cue.type === 'cast' ? ' t-cast' : '';

  return (
    <div
      className={'rrow-wrap' + typeClass + (isDragOver ? ' drag-over' : '')}
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
        <div className="row-pills">
          {cue.standby != null && (
            <span className="rpill sb" title={'Standby at ' + fmtClean(cue.effTime - cue.standby)}>
              {trimNum(cue.standby)}s
            </span>
          )}
          {cue.warn != null && (
            <span className="rpill rd" title={'Ready at ' + fmtClean(cue.effTime - cue.warn)}>
              {trimNum(cue.warn)}s
            </span>
          )}
          {cue.remain != null && (
            <span className="rpill rm" title={'Hold for ' + trimNum(cue.remain) + 's'}>
              {trimNum(cue.remain)}s
            </span>
          )}
        </div>
        {cue.type !== 'call' && <div className="rtag">{cue.type.toUpperCase()}</div>}
        {cue.disabled && <div className="rtag rtag-off">OFF</div>}
        {cue.sets.length > 0 && (
          <div className="rvtag">set {cue.sets.map(s => s.displayLabel || s.name).join(', ')}</div>
        )}
        <button
          className={'rrow-expand ghost' + (expanded ? ' open' : '')}
          title="Edit row"
          onClick={e => { e.stopPropagation(); onToggle(e.shiftKey); }}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      {expanded && onEditCue && (
        <RowEditor
          i={i}
          cue={cue}
          offsetSec={offsetSec}
          getCurrentTime={getCurrentTime}
          onEditCue={onEditCue}
          onDeleteCue={onDeleteCue}
          onAddCue={onAddCue}
        />
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
}

function RowEditor({ i, cue, offsetSec, getCurrentTime, onEditCue, onDeleteCue, onAddCue }: RowEditorProps) {
  const [type, setType] = useState(cue.type);
  const [text, setText] = useState(cue.text);
  const [timeStr, setTimeStr] = useState(() => fmtHMS(cue.raw));
  const [standby, setStandby] = useState(() => cue.standby == null ? '' : trimNum(cue.standby));
  const [ready, setReady] = useState(() => cue.warn == null ? '' : trimNum(cue.warn));
  const [remain, setRemain] = useState(() => cue.remain == null ? '' : trimNum(cue.remain));
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

  function handleDuration(field: DurationField, val: string, setter: (v: string) => void) {
    setter(val);
    const trimmed = val.trim();
    const n = trimmed === '' ? null : parseFloat(trimmed);
    if (trimmed === '' || (n != null && isFinite(n) && n >= 0)) commit({ [field]: n } as CueChanges);
  }

  function durationFromNow(field: DurationField, setter: (v: string) => void, isRemain: boolean) {
    const tl = getCurrentTime();
    const d = isRemain ? Math.max(0, tl - cue.effTime) : Math.max(0, cue.effTime - tl);
    const s = trimNum(d);
    setter(s);
    commit({ [field]: d } as CueChanges);
  }

  function clearDuration(field: DurationField, setter: (v: string) => void) {
    setter('');
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
    isRemain: boolean;
    nowTitle: string;
  }

  const durationRows: DurationRowConfig[] = [
    { field: 'standby', label: 'Standby', val: standby, setter: setStandby, isRemain: false, nowTitle: 'Set to seconds remaining until this cue fires' },
    { field: 'warn',    label: 'Ready',   val: ready,   setter: setReady,   isRemain: false, nowTitle: 'Set ready to time remaining until this cue fires' },
    { field: 'remain',  label: 'Remain',  val: remain,  setter: setRemain,  isRemain: true,  nowTitle: 'Set remain to time elapsed since this cue fired' },
  ];

  return (
    <div className="re-panel">
      {/* Row operations */}
      <div className="re-row re-ops">
        <button className="ghost" onClick={() => onAddCue?.(i, false)}>+ Add ↑</button>
        <button className="ghost re-del" onClick={() => onDeleteCue?.(i)}>✕ Delete</button>
        <button className="ghost" onClick={() => onAddCue?.(i, true)}>+ Add ↓</button>
      </div>

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
          rows={text.length > 60 ? 2 : 1}
        />
      </div>

      {/* Time */}
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
        <button className="ghost re-nudge" onClick={() => nudgeTime(-1)}>−1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(-0.1)}>−0.1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(0.1)}>+0.1s</button>
        <button className="ghost re-nudge" onClick={() => nudgeTime(1)}>+1s</button>
      </div>

      {/* Standby / Ready / Remain */}
      {durationRows.map(({ field, label, val, setter, isRemain, nowTitle }) => (
        <div key={field} className="re-row">
          <span className="re-lbl">{label}</span>
          <input
            className="re-inp re-mono"
            value={val}
            onChange={e => handleDuration(field, e.target.value, setter)}
            placeholder="—"
          />
          <span className="re-unit">s</span>
          <button className="ghost re-fromnow" title={nowTitle} onClick={() => durationFromNow(field, setter, isRemain)}>↓ now</button>
          <button className="ghost re-x" title="Clear" onClick={() => clearDuration(field, setter)}>×</button>
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
    </div>
  );
}
