// ── Data model ────────────────────────────────────────────────────────────────

export type CueType = 'call' | 'note' | 'phase' | 'event' | 'cast';

export interface VarSet {
  name: string;
  displayLabel: string;
  options: string[];
  labels: string[];
}

export interface VarState {
  name: string;
  label: string;
  options: string[];
  labels: string[];
  value: string | null;
  first: number;
  last: number;
  defIdx: number;
  lastIdx: number;
}

export type VarsRecord = Record<string, VarState>;

export interface Cue {
  raw: number;
  effTime: number;
  type: CueType;
  text: string;
  standby: number | null;
  warn: number | null;
  remain: number | null;
  sets: VarSet[];
  skipped: boolean;
  disabled: boolean;
  syncPoint: boolean;
  castbarDuration: number | null;
  _tok: boolean;
  varRefs: string[];
}

export interface BuildCuesResult {
  cues: Cue[];
  vars: VarsRecord;
  errs: number[];
}

export interface ParsedFlags {
  disabled: boolean;
  syncPoint: boolean;
  castbarDuration: number | null;
}

// ── Engine state ──────────────────────────────────────────────────────────────

export interface SyncPoint {
  videoTime: number;
  timelineTime: number;
}

export interface EngineRef {
  started: boolean;
  paused: boolean;
  phaseHold: boolean;
  phaseHoldIdx: number;
  syncTime: number;
  syncPerf: number;
  frozenClock: number;
  prevClock: number;
  raf: number;
  running: boolean;
  videoSynced: boolean;
  syncPoints: SyncPoint[];
}

export interface EngStateSnapshot {
  started: boolean;
  paused: boolean;
  phaseHold: boolean;
}

export interface ParseStatus {
  ok: boolean;
  msg: string;
}

// ── Paint state ───────────────────────────────────────────────────────────────

export type CueState = 'gray' | 'standby' | 'ready' | 'now' | 'pending' | 'retired' | 'phase';
export type VarDisplayState = 'gone' | 'active';

export interface CardDomRefs {
  slot: HTMLDivElement | null;
  card: HTMLDivElement | null;
  cd: HTMLDivElement | null;
  bar: HTMLDivElement | null;
  barwrap: HTMLDivElement | null;
  stateEl: HTMLDivElement | null;
  gbEl: HTMLButtonElement | null;
  doneBtn: HTMLButtonElement | null;
}

export interface CardRef extends CardDomRefs {
  i: number;
  _st: CueState | null;
  _tmr: string | null;
  _lbl: string | null;
  _sel: boolean;
  _hov: boolean;
}

export interface VarCardDomRefs {
  slot: HTMLDivElement | null;
  card: HTMLDivElement | null;
  v: VarState;
}

export interface VarCardRef extends VarCardDomRefs {
  _st: VarDisplayState | null;
}

export interface RenderRowRef {
  row: HTMLDivElement | null;
}

// ── Editing ───────────────────────────────────────────────────────────────────

export interface CueChanges {
  type?: CueType;
  text?: string;
  rawTime?: string;
  standby?: number | null;
  warn?: number | null;
  remain?: number | null;
  sets?: VarSet[];
}
